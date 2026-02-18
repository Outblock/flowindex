package ingester

import (
	"context"
	"log"
	"sync"
	"time"

	"flowscan-clone/internal/repository"
)

type LiveDeriverConfig struct {
	// ChunkSize is the number of blocks processed per callback.
	// Keep this small so the head stays "real-time" even during bursts.
	ChunkSize uint64
}

type heightRange struct {
	from uint64
	to   uint64
}

// retryItem tracks a failed processor+range for retry.
type retryItem struct {
	processor Processor
	from      uint64
	to        uint64
	attempts  int
	nextRetry time.Time
}

const maxLiveRetries = 3

// LiveDeriver runs a set of idempotent processors on newly indexed raw.* ranges.
//
// This is the "Blockscout-style" approach: keep the chain head derived tables fresh
// even while large-range backfill workers run in the background.
//
// IMPORTANT: processors used here must be safe to run repeatedly, because head ranges
// may overlap with backfills and restarts.
type LiveDeriver struct {
	repo       *repository.Repository
	processors []Processor
	chunkSize  uint64

	mu      sync.Mutex
	pending *heightRange
	wakeCh  chan struct{}

	retryMu    sync.Mutex
	retryQueue []retryItem
}

func NewLiveDeriver(repo *repository.Repository, processors []Processor, cfg LiveDeriverConfig) *LiveDeriver {
	if cfg.ChunkSize == 0 {
		cfg.ChunkSize = 10
	}
	return &LiveDeriver{
		repo:       repo,
		processors: processors,
		chunkSize:  cfg.ChunkSize,
		wakeCh:     make(chan struct{}, 1),
	}
}

func (d *LiveDeriver) Start(ctx context.Context) {
	if len(d.processors) == 0 {
		log.Printf("[live_deriver] Disabled: no processors configured")
		return
	}
	log.Printf("[live_deriver] Starting (processors=%d chunk=%d)", len(d.processors), d.chunkSize)
	go d.run(ctx)
}

// NotifyRange schedules a half-open height range [fromHeight, toHeight) for derivation.
// Calls are cheap and will coalesce into a single pending range.
func (d *LiveDeriver) NotifyRange(fromHeight, toHeight uint64) {
	if toHeight <= fromHeight {
		return
	}

	d.mu.Lock()
	if d.pending == nil {
		d.pending = &heightRange{from: fromHeight, to: toHeight}
	} else {
		if fromHeight < d.pending.from {
			d.pending.from = fromHeight
		}
		if toHeight > d.pending.to {
			d.pending.to = toHeight
		}
	}
	d.mu.Unlock()

	// Wake without blocking ingestion if already signaled.
	select {
	case d.wakeCh <- struct{}{}:
	default:
	}
}

func (d *LiveDeriver) run(ctx context.Context) {
	retryTicker := time.NewTicker(5 * time.Second)
	defer retryTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[live_deriver] Stopping")
			return
		case <-d.wakeCh:
			for {
				rng := d.takePending()
				if rng == nil {
					break
				}
				d.processRange(ctx, rng.from, rng.to)
			}
		case <-retryTicker.C:
			d.processRetries(ctx)
		}
	}
}

func (d *LiveDeriver) takePending() *heightRange {
	d.mu.Lock()
	rng := d.pending
	d.pending = nil
	d.mu.Unlock()
	return rng
}

func (d *LiveDeriver) processRange(ctx context.Context, fromHeight, toHeight uint64) {
	if toHeight <= fromHeight {
		return
	}

	for start := fromHeight; start < toHeight; start += d.chunkSize {
		if ctx.Err() != nil {
			return
		}
		end := start + d.chunkSize
		if end > toHeight {
			end = toHeight
		}

		// Run processors concurrently in two phases (same as history_deriver):
		// Phase 1: independent processors
		// Phase 2: processors that depend on token_worker output
		dependsOnToken := map[string]bool{
			"ft_holdings_worker":   true,
			"nft_ownership_worker": true,
			"daily_balance_worker": true,
		}
		var phase1, phase2 []Processor
		for _, p := range d.processors {
			if dependsOnToken[p.Name()] {
				phase2 = append(phase2, p)
			} else {
				phase1 = append(phase1, p)
			}
		}

		runPhase := func(processors []Processor) {
			var wg sync.WaitGroup
			for _, p := range processors {
				wg.Add(1)
				go func(proc Processor) {
					defer wg.Done()
					if ctx.Err() != nil {
						return
					}
					began := time.Now()
					if err := proc.ProcessRange(ctx, start, end); err != nil {
						log.Printf("[live_deriver] %s range [%d,%d) failed: %v", proc.Name(), start, end, err)
						_ = d.repo.LogIndexingError(ctx, proc.Name(), start, "", "LIVE_DERIVER_ERROR", err.Error(), nil)
						d.enqueueRetry(proc, start, end)
						return
					}
					if dur := time.Since(began); dur > 2*time.Second {
						log.Printf("[live_deriver] %s range [%d,%d) took %s", proc.Name(), start, end, dur)
					}
				}(p)
			}
			wg.Wait()
		}
		runPhase(phase1)
		runPhase(phase2)
	}
}

// enqueueRetry adds a failed processor+range to the retry queue.
func (d *LiveDeriver) enqueueRetry(p Processor, from, to uint64) {
	d.retryMu.Lock()
	defer d.retryMu.Unlock()

	// Cap the retry queue to prevent unbounded growth
	if len(d.retryQueue) >= 100 {
		log.Printf("[live_deriver] Retry queue full, dropping oldest entry")
		d.retryQueue = d.retryQueue[1:]
	}

	d.retryQueue = append(d.retryQueue, retryItem{
		processor: p,
		from:      from,
		to:        to,
		attempts:  1,
		nextRetry: time.Now().Add(5 * time.Second),
	})
}

// processRetries runs any pending retries that are due.
func (d *LiveDeriver) processRetries(ctx context.Context) {
	d.retryMu.Lock()
	if len(d.retryQueue) == 0 {
		d.retryMu.Unlock()
		return
	}

	// Take items that are ready for retry
	now := time.Now()
	var ready []retryItem
	var remaining []retryItem
	for _, item := range d.retryQueue {
		if now.After(item.nextRetry) {
			ready = append(ready, item)
		} else {
			remaining = append(remaining, item)
		}
	}
	d.retryQueue = remaining
	d.retryMu.Unlock()

	for _, item := range ready {
		if ctx.Err() != nil {
			return
		}
		err := item.processor.ProcessRange(ctx, item.from, item.to)
		if err != nil {
			log.Printf("[live_deriver] Retry %d/%d failed for %s [%d,%d): %v",
				item.attempts+1, maxLiveRetries, item.processor.Name(), item.from, item.to, err)
			if item.attempts+1 < maxLiveRetries {
				// Re-enqueue with exponential backoff
				backoff := time.Duration(1<<uint(item.attempts)) * 5 * time.Second
				d.retryMu.Lock()
				d.retryQueue = append(d.retryQueue, retryItem{
					processor: item.processor,
					from:      item.from,
					to:        item.to,
					attempts:  item.attempts + 1,
					nextRetry: time.Now().Add(backoff),
				})
				d.retryMu.Unlock()
			} else {
				log.Printf("[live_deriver] Giving up on %s [%d,%d) after %d attempts — async worker will backfill",
					item.processor.Name(), item.from, item.to, maxLiveRetries)
			}
		} else {
			log.Printf("[live_deriver] Retry succeeded for %s [%d,%d)", item.processor.Name(), item.from, item.to)
		}
	}
}
