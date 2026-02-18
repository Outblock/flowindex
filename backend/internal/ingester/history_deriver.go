package ingester

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/repository"
)

// HistoryDeriver processes raw blocks that were backfilled by the history ingester
// but missed by async workers (whose checkpoints are already at the live tip).
//
// It maintains two cursors:
//   - upCursor: scans upward from the initial min raw height to the async worker ceiling.
//     This handles the one-time backlog of already-indexed history blocks.
//   - downCursor: scans downward from the initial min raw height as the history ingester
//     fills new blocks below. This handles ongoing history backfill.
//
// Additionally, the backward ingester's OnIndexedRange callback triggers a LiveDeriver
// instance for real-time processing of new batches. The downward cursor serves as a
// safety net for restart gaps.
//
// IMPORTANT: Both cursors verify that raw blocks actually exist in a range before
// advancing the checkpoint. This prevents silently skipping ranges that the backward
// ingester hasn't filled yet.
type HistoryDeriver struct {
	repo        *repository.Repository
	processors  []Processor
	chunkSize   uint64
	sleepMs     int
	concurrency int
}

type HistoryDeriverConfig struct {
	ChunkSize   uint64
	SleepMs     int // milliseconds between chunks (throttle DB load)
	Concurrency int // number of chunks to process concurrently (default 1)
}

func NewHistoryDeriver(repo *repository.Repository, processors []Processor, cfg HistoryDeriverConfig) *HistoryDeriver {
	if cfg.ChunkSize == 0 {
		cfg.ChunkSize = 1000
	}
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 1
	}
	return &HistoryDeriver{
		repo:        repo,
		processors:  processors,
		chunkSize:   cfg.ChunkSize,
		sleepMs:     cfg.SleepMs,
		concurrency: cfg.Concurrency,
	}
}

const (
	historyDeriverUpCheckpoint   = "history_deriver"
	historyDeriverDownCheckpoint = "history_deriver_down"
)

func (h *HistoryDeriver) Start(ctx context.Context) {
	if len(h.processors) == 0 {
		log.Printf("[history_deriver] Disabled: no processors configured")
		return
	}
	log.Printf("[history_deriver] Starting (processors=%d chunk=%d concurrency=%d)", len(h.processors), h.chunkSize, h.concurrency)
	go h.run(ctx)
}

func (h *HistoryDeriver) run(ctx context.Context) {
	// Wait for DB and ingesters to warm up.
	select {
	case <-ctx.Done():
		return
	case <-time.After(10 * time.Second):
	}

	for {
		if ctx.Err() != nil {
			return
		}

		advanced, err := h.processNext(ctx)
		if err != nil {
			log.Printf("[history_deriver] Error: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Second):
			}
			continue
		}

		if !advanced {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		if h.sleepMs > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(h.sleepMs) * time.Millisecond):
			}
		}
	}
}

func (h *HistoryDeriver) processNext(ctx context.Context) (bool, error) {
	// Try upward scan first (initial backlog), then downward (new history data).
	advanced, err := h.processUpward(ctx)
	if err != nil {
		return false, err
	}
	if advanced {
		return true, nil
	}
	return h.processDownward(ctx)
}

// processUpward scans from the upCursor toward the async worker ceiling.
// When concurrency > 1, it dispatches up to N chunks in parallel and
// advances the checkpoint to the highest contiguous success from scanFrom.
func (h *HistoryDeriver) processUpward(ctx context.Context) (bool, error) {
	upCursor, err := h.repo.GetLastIndexedHeight(ctx, historyDeriverUpCheckpoint)
	if err != nil {
		return false, err
	}

	minRaw, _, _, err := h.repo.GetBlockRange(ctx)
	if err != nil {
		return false, err
	}
	if minRaw == 0 {
		return false, nil
	}

	var scanFrom uint64
	if upCursor > 0 {
		scanFrom = upCursor
	} else {
		scanFrom = minRaw
	}

	ceiling, err := h.findWorkerFloor(ctx)
	if err != nil {
		return false, err
	}
	if ceiling == 0 {
		return false, nil
	}

	if scanFrom >= ceiling {
		return false, nil
	}

	// Build up to N chunk ranges.
	type chunkRange struct {
		from, to uint64
		index    int
	}
	var chunks []chunkRange
	cursor := scanFrom
	for i := 0; i < h.concurrency && cursor < ceiling; i++ {
		chunkTo := cursor + h.chunkSize
		if chunkTo > ceiling {
			chunkTo = ceiling
		}
		chunks = append(chunks, chunkRange{from: cursor, to: chunkTo, index: i})
		cursor = chunkTo
	}

	if len(chunks) == 0 {
		return false, nil
	}

	// Guard: verify raw blocks exist in the first chunk. If the backward
	// ingester hasn't filled this range yet, don't attempt any chunks.
	hasBlocks, err := h.repo.HasBlocksInRange(ctx, chunks[0].from, chunks[0].to)
	if err != nil {
		return false, err
	}
	if !hasBlocks {
		if scanFrom%100000 < h.chunkSize {
			log.Printf("[history_deriver] UP: no raw blocks in [%d,%d), waiting for backward ingester", chunks[0].from, chunks[0].to)
		}
		return false, nil
	}

	// Process chunks concurrently.
	results := make([]error, len(chunks))
	var wg sync.WaitGroup
	for _, c := range chunks {
		wg.Add(1)
		go func(cr chunkRange) {
			defer wg.Done()
			if ctx.Err() != nil {
				results[cr.index] = ctx.Err()
				return
			}
			// Check that raw blocks exist for non-first chunks too.
			if cr.index > 0 {
				has, err := h.repo.HasBlocksInRange(ctx, cr.from, cr.to)
				if err != nil {
					results[cr.index] = err
					return
				}
				if !has {
					results[cr.index] = fmt.Errorf("no raw blocks in [%d,%d)", cr.from, cr.to)
					return
				}
			}
			results[cr.index] = h.runProcessors(ctx, cr.from, cr.to)
		}(c)
	}
	wg.Wait()

	// Find highest contiguous success from the start.
	advanceTo := scanFrom
	for i, c := range chunks {
		if results[i] != nil {
			log.Printf("[history_deriver] UP: chunk [%d,%d) failed: %v — stopping at %d", c.from, c.to, results[i], advanceTo)
			break
		}
		advanceTo = c.to
	}

	if advanceTo > scanFrom {
		if err := h.repo.UpdateCheckpoint(ctx, historyDeriverUpCheckpoint, advanceTo); err != nil {
			log.Printf("[history_deriver] Failed to update up checkpoint: %v", err)
		}
		if advanceTo%100000 < h.chunkSize*uint64(h.concurrency) {
			log.Printf("[history_deriver] Progress UP: processed to %d (ceiling=%d, chunks=%d)", advanceTo, ceiling, len(chunks))
		}
		return true, nil
	}

	return false, nil
}

// processDownward scans from the downCursor toward the current minRaw.
// As the history ingester fills blocks going backward, minRaw decreases.
// When concurrency > 1, it dispatches up to N chunks in parallel.
func (h *HistoryDeriver) processDownward(ctx context.Context) (bool, error) {
	downCursor, err := h.repo.GetLastIndexedHeight(ctx, historyDeriverDownCheckpoint)
	if err != nil {
		return false, err
	}

	minRaw, _, _, err := h.repo.GetBlockRange(ctx)
	if err != nil {
		return false, err
	}
	if minRaw == 0 {
		return false, nil
	}

	if downCursor == 0 {
		// Not initialized yet. Set it to the upCursor's starting point.
		// Everything above this was (or will be) handled by processUpward.
		upCursor, _ := h.repo.GetLastIndexedHeight(ctx, historyDeriverUpCheckpoint)
		if upCursor == 0 {
			// Upward scan hasn't started; nothing to do downward yet.
			return false, nil
		}
		downCursor = upCursor
	}

	if minRaw >= downCursor {
		// No new data below our downward cursor.
		return false, nil
	}

	// Build up to N chunk ranges directly below downCursor.
	// This avoids repeatedly reprocessing [minRaw, minRaw+chunk) when the gap is large.
	type chunkRange struct {
		from, to uint64
		index    int
	}
	var chunks []chunkRange
	cursor := downCursor
	for i := 0; i < h.concurrency && cursor > minRaw; i++ {
		chunkFrom := minRaw
		if cursor > h.chunkSize {
			candidate := cursor - h.chunkSize
			if candidate > minRaw {
				chunkFrom = candidate
			}
		}
		chunks = append(chunks, chunkRange{from: chunkFrom, to: cursor, index: i})
		cursor = chunkFrom
	}

	if len(chunks) == 0 {
		return false, nil
	}

	// Guard: verify raw blocks exist in the first chunk.
	hasBlocks, err := h.repo.HasBlocksInRange(ctx, chunks[0].from, chunks[0].to)
	if err != nil {
		return false, err
	}
	if !hasBlocks {
		return false, nil
	}

	// Process chunks concurrently.
	results := make([]error, len(chunks))
	var wg sync.WaitGroup
	for _, c := range chunks {
		wg.Add(1)
		go func(cr chunkRange) {
			defer wg.Done()
			if ctx.Err() != nil {
				results[cr.index] = ctx.Err()
				return
			}
			if cr.index > 0 {
				has, err := h.repo.HasBlocksInRange(ctx, cr.from, cr.to)
				if err != nil {
					results[cr.index] = err
					return
				}
				if !has {
					results[cr.index] = fmt.Errorf("no raw blocks in [%d,%d)", cr.from, cr.to)
					return
				}
			}
			results[cr.index] = h.runProcessors(ctx, cr.from, cr.to)
		}(c)
	}
	wg.Wait()

	// Find lowest contiguous success from the top.
	advanceTo := downCursor
	for i, c := range chunks {
		if results[i] != nil {
			log.Printf("[history_deriver] DOWN: chunk [%d,%d) failed: %v — stopping at %d", c.from, c.to, results[i], advanceTo)
			break
		}
		advanceTo = c.from
	}

	if advanceTo < downCursor {
		if err := h.repo.UpdateCheckpoint(ctx, historyDeriverDownCheckpoint, advanceTo); err != nil {
			log.Printf("[history_deriver] Failed to update down checkpoint: %v", err)
		}

		if advanceTo%100000 < h.chunkSize*uint64(h.concurrency) || advanceTo == minRaw {
			log.Printf("[history_deriver] Progress DOWN: cursor %d -> %d (minRaw=%d, chunks=%d)", downCursor, advanceTo, minRaw, len(chunks))
		}
		return true, nil
	}

	return false, nil
}

// isDeadlock checks if an error is a PostgreSQL deadlock (SQLSTATE 40P01).
func isDeadlock(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "deadlock detected") || strings.Contains(msg, "40P01")
}

const maxDeadlockRetries = 3

// runProcessors executes processors concurrently for the given range.
// Processors that depend on others (ft_holdings_worker depends on token_worker,
// nft_ownership_worker depends on token_worker) run after their dependencies complete.
// Returns an error if any processor fails after retries.
func (h *HistoryDeriver) runProcessors(ctx context.Context, from, to uint64) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// Split processors into two phases:
	// Phase 1: all processors except those that depend on token_worker output
	// Phase 2: processors that need token_worker to finish first
	dependsOnToken := map[string]bool{
		"ft_holdings_worker":   true,
		"nft_ownership_worker": true,
		"daily_balance_worker": true,
	}

	var phase1, phase2 []Processor
	for _, p := range h.processors {
		if dependsOnToken[p.Name()] {
			phase2 = append(phase2, p)
		} else {
			phase1 = append(phase1, p)
		}
	}

	runParallel := func(processors []Processor) error {
		var mu sync.Mutex
		var errs []string

		var wg sync.WaitGroup
		for _, p := range processors {
			wg.Add(1)
			go func(proc Processor) {
				defer wg.Done()
				if ctx.Err() != nil {
					return
				}
				began := time.Now()

				var lastErr error
				for attempt := 1; attempt <= maxDeadlockRetries; attempt++ {
					lastErr = proc.ProcessRange(ctx, from, to)
					if lastErr == nil {
						break
					}
					if !isDeadlock(lastErr) {
						break // non-deadlock error, don't retry
					}
					if attempt < maxDeadlockRetries {
						log.Printf("[history_deriver] %s range [%d,%d) deadlock (attempt %d/%d), retrying...",
							proc.Name(), from, to, attempt, maxDeadlockRetries)
						select {
						case <-ctx.Done():
							return
						case <-time.After(time.Duration(attempt*500) * time.Millisecond):
						}
					}
				}

				if lastErr != nil {
					log.Printf("[history_deriver] %s range [%d,%d) failed: %v", proc.Name(), from, to, lastErr)
					_ = h.repo.LogIndexingError(ctx, proc.Name(), from, "", "HISTORY_DERIVER_ERROR", lastErr.Error(), nil)
					mu.Lock()
					errs = append(errs, fmt.Sprintf("%s: %v", proc.Name(), lastErr))
					mu.Unlock()
					return
				}

				if dur := time.Since(began); dur > 2*time.Second {
					log.Printf("[history_deriver] %s range [%d,%d) took %s", proc.Name(), from, to, dur)
				}
			}(p)
		}
		wg.Wait()

		if len(errs) > 0 {
			return fmt.Errorf("%d processor(s) failed: %s", len(errs), strings.Join(errs, "; "))
		}
		return nil
	}

	if err := runParallel(phase1); err != nil {
		return fmt.Errorf("phase1: %w", err)
	}
	if err := runParallel(phase2); err != nil {
		return fmt.Errorf("phase2: %w", err)
	}
	return nil
}

func (h *HistoryDeriver) findWorkerFloor(ctx context.Context) (uint64, error) {
	workerNames := []string{"token_worker", "evm_worker", "accounts_worker", "meta_worker"}

	var minCheckpoint uint64
	for _, name := range workerNames {
		wh, err := h.repo.GetLastIndexedHeight(ctx, name)
		if err != nil {
			continue
		}
		if wh > 0 && (minCheckpoint == 0 || wh < minCheckpoint) {
			minCheckpoint = wh
		}
	}
	return minCheckpoint, nil
}
