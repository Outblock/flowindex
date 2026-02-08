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
	for {
		select {
		case <-ctx.Done():
			log.Printf("[live_deriver] Stopping")
			return
		case <-d.wakeCh:
		}

		for {
			rng := d.takePending()
			if rng == nil {
				break
			}
			d.processRange(ctx, rng.from, rng.to)
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

		for _, p := range d.processors {
			if ctx.Err() != nil {
				return
			}
			began := time.Now()
			if err := p.ProcessRange(ctx, start, end); err != nil {
				log.Printf("[live_deriver] %s range [%d,%d) failed: %v", p.Name(), start, end, err)
				_ = d.repo.LogIndexingError(ctx, p.Name(), start, "", "LIVE_DERIVER_ERROR", err.Error(), nil)
				continue
			}
			if dur := time.Since(began); dur > 2*time.Second {
				log.Printf("[live_deriver] %s range [%d,%d) took %s", p.Name(), start, end, dur)
			}
		}
	}
}
