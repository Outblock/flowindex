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
	processor         Processor
	repo              *repository.Repository
	rangeSize         uint64
	workerID          string // e.g. hostname-pid
	stopCh            chan struct{}
	minStartHeight    uint64
	minStartCheckedAt time.Time
	// Dependencies lists upstream worker checkpoint names that must reach toHeight
	// before this worker processes a range. Prevents silent data loss from race conditions.
	dependencies []string
}

// Config holds configuration for the AsyncWorker
type WorkerConfig struct {
	RangeSize    uint64
	WorkerID     string
	Dependencies []string
}

func NewAsyncWorker(p Processor, repo *repository.Repository, cfg WorkerConfig) *AsyncWorker {
	if cfg.RangeSize == 0 {
		cfg.RangeSize = 1000 // Default
	}
	if cfg.WorkerID == "" {
		hostname, _ := os.Hostname()
		cfg.WorkerID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}

	return &AsyncWorker{
		processor:    p,
		repo:         repo,
		rangeSize:    cfg.RangeSize,
		workerID:     cfg.WorkerID,
		stopCh:       make(chan struct{}),
		dependencies: cfg.Dependencies,
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

	baseHeight := (checkpointH / w.rangeSize) * w.rangeSize
	if minStart, err := w.getMinStartHeight(ctx); err == nil && minStart > 0 && checkpointH < minStart {
		aligned := (minStart / w.rangeSize) * w.rangeSize
		if aligned > baseHeight {
			log.Printf("[%s] Fast-forwarding base height from %d to %d (min raw height %d)", workerType, baseHeight, aligned, minStart)
			baseHeight = aligned
		}
	}

	// Dependency gate: check that all upstream workers have progressed past our candidate range.
	// This prevents silent data loss (e.g. FTHoldingsWorker running before TokenWorker).
	candidateEnd := baseHeight + w.rangeSize
	if len(w.dependencies) > 0 && candidateEnd > 0 {
		for _, dep := range w.dependencies {
			depH, depErr := w.repo.GetLastIndexedHeight(ctx, dep)
			if depErr != nil {
				log.Printf("[%s] Failed to check dependency %s: %v", workerType, dep, depErr)
				return
			}
			if depH < candidateEnd {
				// Upstream hasn't reached our range yet, wait.
				return
			}
		}
	}

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

func (w *AsyncWorker) getMinStartHeight(ctx context.Context) (uint64, error) {
	if w.minStartHeight > 0 && time.Since(w.minStartCheckedAt) < 30*time.Second {
		return w.minStartHeight, nil
	}
	minH, _, _, err := w.repo.GetBlockRange(ctx)
	if err != nil {
		return 0, err
	}
	w.minStartHeight = minH
	w.minStartCheckedAt = time.Now()
	return minH, nil
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
