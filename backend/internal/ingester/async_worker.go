package ingester

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"flowscan-clone/internal/repository"
)

// Processor is the interface that specific workers (Token, EVM, etc.) must implement.
type Processor interface {
	// ProcessRange handles the business logic for the given range.
	// It should check ctx.Done() frequently.
	ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error
	// Name returns the worker type name (e.g. "token_worker")
	Name() string
}

// AsyncWorker manages the lifecycle of an async worker: leasing, processing, error handling.
type AsyncWorker struct {
	processor Processor
	repo      *repository.Repository
	rangeSize uint64
	workerID  string // e.g. hostname-pid
	stopCh    chan struct{}
}

// Config holds configuration for the AsyncWorker
type WorkerConfig struct {
	RangeSize uint64
	WorkerID  string
}

func NewAsyncWorker(p Processor, repo *repository.Repository, cfg WorkerConfig) *AsyncWorker {
	if cfg.RangeSize == 0 {
		cfg.RangeSize = 50000 // Default
	}
	if cfg.WorkerID == "" {
		hostname, _ := os.Hostname()
		cfg.WorkerID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}

	return &AsyncWorker{
		processor: p,
		repo:      repo,
		rangeSize: cfg.RangeSize,
		workerID:  cfg.WorkerID,
		stopCh:    make(chan struct{}),
	}
}

// Start begins the worker loop
func (w *AsyncWorker) Start(ctx context.Context) {
	log.Printf("[%s] Starting Async Worker (Range: %d)", w.processor.Name(), w.rangeSize)
	go w.runLoop(ctx)
}

func (w *AsyncWorker) runLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second) // Poll interval
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[%s] Stopping...", w.processor.Name())
			return
		case <-w.stopCh:
			return
		case <-ticker.C:
			w.tryProcessNextRange(ctx)
		}
	}
}

func (w *AsyncWorker) tryProcessNextRange(ctx context.Context) {
	workerType := w.processor.Name()

	// 0. Check Raw Ingestion Tip (Prevent Race Ahead)
	rawTip, err := w.repo.GetLastIndexedHeight(ctx, "main_ingester")
	if err != nil {
		log.Printf("[%s] Failed to get raw tip: %v", workerType, err)
		return
	}

	// 1. Determine Candidate Range
	// Strategy: Get last committed checkpoint. Start from aligned next range.
	// NOTE: This assumes Checkpoint is the source of truth for "where to start looking".
	checkpointH, err := w.repo.GetLastIndexedHeight(ctx, workerType)
	if err != nil {
		log.Printf("[%s] Failed to get checkpoint: %v", workerType, err)
		return
	}

	// Alignment: floor(checkpoint / range) * range
	// If checkpoint is 0 (start), we start at 0.
	// If checkpoint is 50000, we start at 50000.
	// Make sure we don't re-process compelted range if checkpoint is exactly on boundary?
	// Actually, last_height usually implies "processed up to X".
	// So next range starts at `last_height`?
	// The plan says: "Start at floor(checkpoint / RANGE_SIZE) * RANGE_SIZE" and then "Priority: Reclaim FAILED" or "Fallback: Increment".

	baseHeight := (checkpointH / w.rangeSize) * w.rangeSize

	// Candidate List:
	// A. Failed Ranges (Priority) - We don't have a quick query for this yet,
	//    so we might just rely on the fallback logic or add a query.
	//    For simplicity in V1: check current baseHeight, then baseHeight + RangeSize...

	// Let's try to acquire baseHeight first (maybe it failed or was never done)
	if baseHeight+w.rangeSize <= rawTip {
		if w.attemptRange(ctx, baseHeight) {
			return // Work done, return to loop immediately to pick up next (or wait ticker)
		}
	}

	// If baseHeight is already done (or taken by someone else active), try next
	// Limit lookahead to avoid infinite loop scanning
	lookahead := 5
	for i := 1; i <= lookahead; i++ {
		nextH := baseHeight + (uint64(i) * w.rangeSize)
		if nextH+w.rangeSize > rawTip {
			break // Don't look ahead past raw tip
		}
		if w.attemptRange(ctx, nextH) {
			return
		}
	}
}

func (w *AsyncWorker) attemptRange(ctx context.Context, fromHeight uint64) bool {
	toHeight := fromHeight + w.rangeSize
	workerType := w.processor.Name()

	// Step A: Try Insert (New Range)
	leaseID, err := w.repo.AcquireLease(ctx, workerType, fromHeight, toHeight, w.workerID)
	if err != nil {
		log.Printf("[%s] DB Error acquiring lease %d: %v", workerType, fromHeight, err)
		return false
	}

	// Step B: If Insert failed (leaseID==0), Try Reclaim FAILED range
	if leaseID == 0 {
		leaseID, err = w.repo.ReclaimLease(ctx, workerType, fromHeight, toHeight, w.workerID)
		if err != nil {
			log.Printf("[%s] DB Error reclaiming lease %d: %v", workerType, fromHeight, err)
			return false
		}
	}

	if leaseID == 0 {
		// Could not acquire or reclaim. Range is taken or completed.
		return false
	}

	// Got Lease!
	log.Printf("[%s] Acquired Lease %d [%d, %d)", workerType, leaseID, fromHeight, toHeight)

	// Process
	processErr := w.processor.ProcessRange(ctx, fromHeight, toHeight)

	if processErr != nil {
		log.Printf("[%s] Error processing range [%d, %d): %v", workerType, fromHeight, toHeight, processErr)
		// Mark Failed
		// Optionally log detailed error to raw.indexing_errors
		w.repo.LogIndexingError(ctx, workerType, fromHeight, "", "PROCESS_ERROR", processErr.Error(), nil)
		w.repo.FailLease(ctx, leaseID, processErr.Error())
		return true // We consumed the cycle, even if failed
	}

	// Success
	if err := w.repo.CompleteLease(ctx, leaseID); err != nil {
		log.Printf("[%s] Failed to mark lease %d complete: %v", workerType, leaseID, err)
		return true // Valid work done, just DB update failed
	}

	// Try to advance checkpoint immediately? Or wait for Committer?
	// Plan says "Committer or Leader process".
	// For V1 simple implementation, let's try to update checkpoint optimistically
	// if we just finished the "next" expected range.
	// This is optional but helpful for non-distributed small setups.
	// But strict plan says "Contiguous Only".
	// We'll leave it to the separate Committer to enforce strictness.

	log.Printf("[%s] Completed Range [%d, %d)", workerType, fromHeight, toHeight)
	return true
}
