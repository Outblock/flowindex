package ingester

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

type Service struct {
	client *flow.Client
	repo   *repository.Repository
	config Config

	// When using a non-historic access node, Flow will return NotFound for blocks
	// before the spork root height. We learn that boundary from the error message and
	// clamp history backfill to avoid getting stuck in an infinite retry loop.
	minAvailableHeight uint64
	loggedHistoryFloor bool
}

// Callback type for real-time updates
type BlockCallback func(models.Block)
type TxCallback func(models.Transaction)
type RangeCallback func(fromHeight, toHeight uint64)

type Config struct {
	BatchSize        int
	WorkerCount      int
	ServiceName      string
	StartBlock       uint64
	Mode             string // "forward" (default) or "backward"
	MaxReorgDepth    uint64
	OnNewBlock       BlockCallback
	OnNewTransaction TxCallback
	// OnIndexedRange is invoked after a batch has been persisted to raw.* tables.
	// It is intended for lightweight, real-time derived materialization at the chain head.
	// Range is half-open: [fromHeight, toHeight).
	OnIndexedRange RangeCallback
}

func NewService(client *flow.Client, repo *repository.Repository, cfg Config) *Service {
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 50
	}
	if cfg.WorkerCount == 0 {
		cfg.WorkerCount = 10
	}
	if cfg.Mode == "" {
		cfg.Mode = "forward"
	}
	if cfg.MaxReorgDepth == 0 {
		cfg.MaxReorgDepth = 1000
	}
	return &Service{
		client: client,
		repo:   repo,
		config: cfg,
	}
}

// Start runs the ingestion loop
func (s *Service) Start(ctx context.Context) error {
	log.Printf("Starting %s Ingester in %s mode...", s.config.ServiceName, s.config.Mode)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			// Run one processing cycle
			err := s.process(ctx)
			if err != nil {
				log.Printf("[%s] Error processing batch: %v", s.config.ServiceName, err)
				time.Sleep(10 * time.Second) // Increased backoff on error
				continue
			}

			// If process returns nil, it means we are up to date (live) or finished (history)
			// For Live, we poll every few seconds.
			// For History, if finished, we stop?
			// Checking process() return values... it returns nil when "Done! reached 0" (Backward)
			// or when "startHeight > latestHeight" (Forward).

			// We should sleep a bit to avoid hot loop when up to date.
			time.Sleep(1 * time.Second)
		}
	}
}

func (s *Service) process(ctx context.Context) error {
	lastIndexed, err := s.repo.GetLastIndexedHeight(ctx, s.config.ServiceName)
	if err != nil {
		return err
	}

	var startHeight, endHeight uint64
	var checkpointHeight uint64

	if s.config.Mode == "backward" {
		// --- Backward Mode ---
		// If lastIndexed is 0, we haven't started (or really just started from scratch).
		// We assume we start from Config.StartBlock - 1.
		// But wait, GetLastIndexedHeight returns 0 if no row.
		// If row exists with 0, it means we scanned down to 0 ?
		// For simplicity: If lastIndexed == 0, check if we have a row?
		// repo.GetLastIndexedHeight is simple scan.
		// Let's assume if 0, we start at StartBlock.

		currentTip := lastIndexed
		if currentTip == 0 {
			currentTip = s.config.StartBlock
		}

		if currentTip <= 1 {
			// Done! reached 0 (or 1)
			return nil
		}

		// Define batch: [currentTip - batch, currentTip - 1]
		// But practically: We want to fetch decreasing.
		// Let's settle on: range is [targetStart, targetEnd]
		// targetEnd = currentTip - 1

		targetEnd := currentTip - 1
		targetStart := uint64(0)
		if targetEnd >= uint64(s.config.BatchSize) {
			targetStart = targetEnd - uint64(s.config.BatchSize) + 1
		}

		startHeight = targetStart
		endHeight = targetEnd

		// If we've learned a spork root floor for this client, clamp the range.
		// This avoids retrying a range that contains heights the node cannot serve.
		if s.minAvailableHeight > 0 {
			if endHeight < s.minAvailableHeight {
				// Nothing left this node can serve.
				if !s.loggedHistoryFloor {
					log.Printf("[%s] History backfill reached spork root height %d. Configure FLOW_HISTORIC_ACCESS_NODES to continue indexing earlier history.", s.config.ServiceName, s.minAvailableHeight)
					s.loggedHistoryFloor = true
				}
				return nil
			}
			if startHeight < s.minAvailableHeight {
				startHeight = s.minAvailableHeight
			}
		}

		// Backward checkpoint is the lowest height we processed in this batch.
		checkpointHeight = startHeight

		log.Printf("[History] Backfilling range %d -> %d (%d blocks)", endHeight, startHeight, endHeight-startHeight+1)

	} else {
		// --- Forward Mode (Default) ---
		// 2. Determine Chain Tip
		latestHeight, err := s.client.GetLatestBlockHeight(ctx)
		if err != nil {
			return err
		}

		// 3. Decide Start Height
		if lastIndexed > 0 {
			startHeight = lastIndexed + 1
		} else if s.config.StartBlock > 0 {
			startHeight = s.config.StartBlock
		} else {
			startHeight = latestHeight - 100 // Fallback
		}

		// 4. Check if we need to run
		if startHeight > latestHeight {
			return nil
		}

		// 5. Define Batch
		behind := latestHeight - startHeight

		// Blockscout-style behavior: when we're close to the head, prefer small batches so
		// the UI (websocket) feels real-time. Use larger batches only when we're far behind.
		batchSize := uint64(s.config.BatchSize)
		switch {
		case behind == 0:
			batchSize = 1
		case behind <= 3:
			batchSize = 1
		case behind <= 20:
			if batchSize > 5 {
				batchSize = 5
			}
		case behind <= 100:
			if batchSize > 10 {
				batchSize = 10
			}
		}

		endHeight = startHeight + batchSize - 1
		if endHeight > latestHeight {
			endHeight = latestHeight
		}

		if startHeight == latestHeight {
			endHeight = startHeight // Real-time
		} else {
			log.Printf("[Live] Syncing range %d -> %d (%d blocks, behind: %d)", startHeight, endHeight, endHeight-startHeight+1, latestHeight-endHeight)
		}

		// Checkpoint is the highest block
		checkpointHeight = endHeight
	}

	// 6. Execute Batch Fetch
	fetchStart := time.Now()
	results, err := s.fetchBatchParallel(ctx, startHeight, endHeight)
	if err != nil {
		// Handle spork boundary errors in backward mode:
		// When a non-historic access node is used for history backfill, Flow returns a NotFound
		// error and includes the spork root block height in the message.
		if s.config.Mode == "backward" {
			if root, ok := extractSporkRootHeight(err); ok {
				if root > s.minAvailableHeight {
					s.minAvailableHeight = root
					s.loggedHistoryFloor = false
				}

				// If this batch crosses below the spork root, clamp and retry so we still
				// persist the blocks above the spork boundary.
				if endHeight < s.minAvailableHeight {
					if !s.loggedHistoryFloor {
						log.Printf("[%s] History backfill reached spork root height %d. Configure FLOW_HISTORIC_ACCESS_NODES to continue indexing earlier history.", s.config.ServiceName, s.minAvailableHeight)
						s.loggedHistoryFloor = true
					}
					return nil
				}

				if startHeight < s.minAvailableHeight {
					log.Printf("[History] Detected spork root height %d; retrying batch with floor clamped.", s.minAvailableHeight)
					startHeight = s.minAvailableHeight
					checkpointHeight = startHeight
					retryResults, retryErr := s.fetchBatchParallel(ctx, startHeight, endHeight)
					if retryErr == nil {
						results = retryResults
						err = nil
					} else {
						return retryErr
					}
				}
			}
		}
	}
	if err != nil {
		return err
	}

	// 7. Parent continuity check (forward only)
	if s.config.Mode == "forward" {
		if err := s.ensureContinuity(ctx, results, lastIndexed); err != nil {
			return err
		}
	}

	// 8. Save Batch
	fetchDuration := time.Since(fetchStart)
	saveStart := time.Now()
	if err := s.saveBatch(ctx, results, checkpointHeight); err != nil {
		return err
	}
	saveDuration := time.Since(saveStart)

	if s.config.Mode == "backward" {
		log.Printf("[History] Batch %d->%d: fetch=%s save=%s total=%s",
			endHeight, startHeight, fetchDuration.Round(time.Millisecond), saveDuration.Round(time.Millisecond), (fetchDuration + saveDuration).Round(time.Millisecond))
	}

	return nil
}

func extractSporkRootHeight(err error) (uint64, bool) {
	if err == nil {
		return 0, false
	}
	msg := err.Error()

	// Primary: explicit spork root height in error message
	const needle = "spork root block height "
	if idx := strings.Index(msg, needle); idx != -1 {
		rest := msg[idx+len(needle):]
		n := 0
		for n < len(rest) {
			ch := rest[n]
			if ch < '0' || ch > '9' {
				break
			}
			n++
		}
		if n > 0 {
			if v, parseErr := strconv.ParseUint(rest[:n], 10, 64); parseErr == nil && v > 0 {
				return v, true
			}
		}
	}

	// Fallback: "failed to get block <height>" with "key not found" or "NotFound"
	// indicates the node cannot serve this height (spork boundary).
	if strings.Contains(msg, "key not found") || strings.Contains(msg, "NotFound") {
		const blockNeedle = "failed to get block "
		if idx := strings.Index(msg, blockNeedle); idx != -1 {
			rest := msg[idx+len(blockNeedle):]
			n := 0
			for n < len(rest) {
				ch := rest[n]
				if ch < '0' || ch > '9' {
					break
				}
				n++
			}
			if n > 0 {
				if v, parseErr := strconv.ParseUint(rest[:n], 10, 64); parseErr == nil && v > 0 {
					// The failed height is below the spork root; return height+1 as the floor.
					return v + 1, true
				}
			}
		}
	}

	return 0, false
}

func (s *Service) ensureContinuity(ctx context.Context, results []*FetchResult, lastIndexed uint64) error {
	if len(results) == 0 {
		return nil
	}

	// Ensure results sorted by height
	sort.Slice(results, func(i, j int) bool {
		return results[i].Height < results[j].Height
	})

	first := results[0]
	if first == nil || first.Block == nil {
		return nil
	}

	// Check parent against DB for the first block in batch
	if first.Height > 0 {
		prevHeight := first.Height - 1
		prevID, err := s.repo.GetBlockIDByHeight(ctx, prevHeight)
		if err == nil && prevID != "" && first.Block.ParentID != prevID {
			return s.handleReorg(ctx, prevHeight, lastIndexed, "db-parent-mismatch")
		}
	}

	// Check continuity within fetched batch
	for i := 1; i < len(results); i++ {
		prev := results[i-1]
		cur := results[i]
		if prev == nil || cur == nil || prev.Block == nil || cur.Block == nil {
			continue
		}
		if cur.Block.ParentID != prev.Block.ID {
			return s.handleReorg(ctx, cur.Block.Height-1, lastIndexed, "batch-parent-mismatch")
		}
	}

	return nil
}

func (s *Service) handleReorg(ctx context.Context, rollbackHeight, lastIndexed uint64, reason string) error {
	if lastIndexed > rollbackHeight && (lastIndexed-rollbackHeight) > s.config.MaxReorgDepth {
		return fmt.Errorf("reorg depth exceeds max (%s): last=%d rollback=%d", reason, lastIndexed, rollbackHeight)
	}
	if err := s.repo.RollbackFromHeight(ctx, rollbackHeight); err != nil {
		return fmt.Errorf("rollback failed (%s): %w", reason, err)
	}
	return fmt.Errorf("reorg detected (%s): rolled back to %d", reason, rollbackHeight)
}

func (s *Service) fetchBatchParallel(ctx context.Context, start, end uint64) ([]*FetchResult, error) {
	total := int(end - start + 1)
	results := make([]*FetchResult, total)

	var wg sync.WaitGroup
	sem := make(chan struct{}, s.config.WorkerCount) // Semaphore for concurrency control

	worker := NewWorker(s.client)

	// Track whether ALL blocks in the batch failed with spork-related errors,
	// which signals we should propagate the error so the spork-boundary handler
	// in process() can adjust the floor.
	var sporkErr error
	var sporkErrOnce sync.Once
	var skippedCount int64

	for i := 0; i < total; i++ {
		height := start + uint64(i)
		idx := i

		sem <- struct{}{} // Acquire
		wg.Add(1)

		go func() {
			defer wg.Done()
			defer func() { <-sem }() // Release

			res := worker.FetchBlockData(ctx, height)
			if res.Error != nil {
				// Spork boundary errors should still propagate so the service can
				// adjust the floor height. Detect and capture them.
				errMsg := res.Error.Error()
				if strings.Contains(errMsg, "no suitable access node available") ||
					strings.Contains(errMsg, "spork root block height") {
					sporkErrOnce.Do(func() { sporkErr = res.Error })
					return
				}

				// Non-spork errors: log and skip this block, continue the batch.
				log.Printf("[%s] Warn: skipping block %d due to fetch error: %v", s.config.ServiceName, height, res.Error)
				atomic.AddInt64(&skippedCount, 1)
				// Record error in the result so saveBatch can log it to indexing_errors.
				res.Block = nil
				res.Warnings = append(res.Warnings, FetchWarning{
					Message: fmt.Sprintf("block fetch failed: %v", res.Error),
				})
				results[idx] = res
				return
			}
			results[idx] = res // Safe because idx is unique per goroutine
		}()
	}

	wg.Wait()

	// If we got spork boundary errors, propagate so the caller can handle the floor.
	if sporkErr != nil {
		return nil, sporkErr
	}

	skipped := atomic.LoadInt64(&skippedCount)
	if skipped > 0 {
		log.Printf("[%s] Batch %d->%d: skipped %d/%d blocks due to errors (will retry later)",
			s.config.ServiceName, start, end, skipped, total)
	}

	return results, nil
}

func (s *Service) saveBatch(ctx context.Context, results []*FetchResult, checkpointHeight uint64) error {
	// Filter out any nils (shouldn't be any if no error)
	var blocks []*models.Block
	var txs []models.Transaction
	var events []models.Event

	// Ensure sorted by height (should be already, but safety first)
	sort.Slice(results, func(i, j int) bool {
		if results[i] == nil {
			return true
		}
		if results[j] == nil {
			return false
		}
		return results[i].Height < results[j].Height
	})

	broadcastRealtime := s.config.Mode == "forward"

	for _, res := range results {
		if res == nil {
			continue
		}

		// Log warnings (including from skipped/failed blocks) to indexing_errors for later revisit.
		for _, w := range res.Warnings {
			if logErr := s.repo.LogIndexingError(ctx, s.config.ServiceName, res.Height, w.TxID, "fetch_warning", w.Message, nil); logErr != nil {
				log.Printf("[%s] failed to log indexing warning: %v", s.config.ServiceName, logErr)
			}
		}

		if res.Block == nil {
			continue
		}

		// Trigger Callbacks (Real-time updates)
		// Only trigger for forward mode to avoid expensive broadcasts during history backfill.
		if broadcastRealtime {
			if s.config.OnNewBlock != nil {
				s.config.OnNewBlock(*res.Block)
			}
			if s.config.OnNewTransaction != nil {
				for _, tx := range res.Transactions {
					if isSystemFlowTransaction(tx) {
						continue
					}
					s.config.OnNewTransaction(tx)
				}
			}
		}

		blocks = append(blocks, res.Block)
		txs = append(txs, res.Transactions...)
		events = append(events, res.Events...)

	}

	// Use the atomic batch save
	if err := s.repo.SaveBatch(ctx, blocks, txs, events, s.config.ServiceName, checkpointHeight); err != nil {
		return err
	}

	// Notify downstream derivers once raw.* writes are committed.
	// OnIndexedRange fires for BOTH forward and backward modes so that
	// the history deriver can process newly backfilled blocks immediately.
	if len(blocks) > 0 {
		fromHeight := blocks[0].Height
		toHeight := blocks[len(blocks)-1].Height + 1

		if s.config.OnIndexedRange != nil {
			s.config.OnIndexedRange(fromHeight, toHeight)
		} else if broadcastRealtime && os.Getenv("ENABLE_LIVE_ADDRESS_INDEX") != "false" {
			// Backwards-compatible fallback to keep account pages fresh.
			if err := s.repo.BackfillAddressTransactionsAndStatsRange(ctx, fromHeight, toHeight); err != nil {
				log.Printf("[%s] live address index (tx+stats) update failed: %v", s.config.ServiceName, err)
			}
		}
	}

	return nil
}

func isSystemFlowTransaction(tx models.Transaction) bool {
	return strings.EqualFold(strings.TrimSpace(tx.PayerAddress), "0000000000000000") &&
		strings.EqualFold(strings.TrimSpace(tx.ProposerAddress), "0000000000000000")
}
