package ingester

import (
	"context"
	"fmt"
	"log"
	"os"
	"runtime/debug"
	"strconv"
	"sync"
	"time"

	"flowscan-clone/internal/repository"
)

type LiveDeriverConfig struct {
	// ChunkSize is the number of blocks processed per callback.
	// Keep this small so the head stays "real-time" even during bursts.
	ChunkSize uint64
	// ProcessorTimeoutMs is per-processor timeout (0 to disable).
	ProcessorTimeoutMs int
	// DisableRepair skips the background repairFailedRanges goroutine.
	// Use this for secondary LiveDeriver instances to avoid duplicate repair work.
	DisableRepair bool
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
	repo               *repository.Repository
	processors         []Processor
	chunkSize          uint64
	processorTimeoutMs int
	disableRepair      bool

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
	if cfg.ProcessorTimeoutMs == 0 {
		cfg.ProcessorTimeoutMs = getEnvIntDefaultLD("LIVE_DERIVER_PROCESSOR_TIMEOUT_MS", 120000)
	}
	return &LiveDeriver{
		repo:               repo,
		processors:         processors,
		chunkSize:          cfg.ChunkSize,
		processorTimeoutMs: cfg.ProcessorTimeoutMs,
		disableRepair:      cfg.DisableRepair,
		wakeCh:             make(chan struct{}, 1),
	}
}

func (d *LiveDeriver) Start(ctx context.Context) {
	if len(d.processors) == 0 {
		log.Printf("[live_deriver] Disabled: no processors configured")
		return
	}
	log.Printf(
		"[live_deriver] Starting (processors=%d chunk=%d timeout_ms=%d)",
		len(d.processors),
		d.chunkSize,
		d.processorTimeoutMs,
	)
	go d.run(ctx)
	if !d.disableRepair {
		go d.repairFailedRanges(ctx)
	} else {
		log.Printf("[live_deriver] Repair disabled for this instance")
	}
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

		// Track which processors failed so we skip their checkpoint update.
		var failedMu sync.Mutex
		failed := make(map[string]bool)

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
					procCtx := ctx
					cancel := func() {}
					if d.processorTimeoutMs > 0 {
						procCtx, cancel = context.WithTimeout(ctx, time.Duration(d.processorTimeoutMs)*time.Millisecond)
					}
					err := safeProcessRangeLive(procCtx, proc, start, end)
					cancel()
					if err != nil {
						log.Printf("[live_deriver] %s range [%d,%d) failed: %v", proc.Name(), start, end, err)
						_ = d.repo.LogIndexingError(ctx, proc.Name(), start, "", "LIVE_DERIVER_ERROR", err.Error(), nil)
						d.enqueueRetry(proc, start, end)
						failedMu.Lock()
						failed[proc.Name()] = true
						failedMu.Unlock()
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

		// Update checkpoints for successful processors only.
		// Failed processors get retried and their checkpoints remain behind,
		// but they no longer block progress of other processors.
		for _, p := range d.processors {
			if failed[p.Name()] {
				continue
			}
			if err := d.repo.UpdateCheckpoint(ctx, p.Name(), end); err != nil {
				log.Printf("[live_deriver] Failed to update checkpoint for %s: %v", p.Name(), err)
			}
		}
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
		procCtx := ctx
		cancel := func() {}
		if d.processorTimeoutMs > 0 {
			procCtx, cancel = context.WithTimeout(ctx, time.Duration(d.processorTimeoutMs)*time.Millisecond)
		}
		err := safeProcessRangeLive(procCtx, item.processor, item.from, item.to)
		cancel()
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
				log.Printf("[live_deriver] Giving up on %s [%d,%d) after %d attempts — logged as SKIPPED for reindex",
					item.processor.Name(), item.from, item.to, maxLiveRetries)
				// Persist the skipped range so it can be queried and reprocessed later.
				_ = d.repo.LogIndexingError(ctx, item.processor.Name(), item.from,
					fmt.Sprintf("range_end=%d", item.to),
					"LIVE_DERIVER_SKIPPED",
					fmt.Sprintf("gave up after %d retries: %v", maxLiveRetries, err),
					nil)
			}
		} else {
			log.Printf("[live_deriver] Retry succeeded for %s [%d,%d)", item.processor.Name(), item.from, item.to)
		}
	}
}

func safeProcessRangeLive(ctx context.Context, proc Processor, from, to uint64) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
			log.Printf("[live_deriver] PANIC in %s range [%d,%d): %v\n%s", proc.Name(), from, to, r, string(debug.Stack()))
		}
	}()
	return proc.ProcessRange(ctx, from, to)
}

func getEnvIntDefaultLD(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// repairFailedRanges scans raw.indexing_errors for unresolved processor failures
// and re-runs the corresponding processor to fill data gaps. This handles gaps
// caused by deploys, restarts, and transient timeouts.
func (d *LiveDeriver) repairFailedRanges(ctx context.Context) {
	// Wait a bit after startup to let the system stabilize before doing repair work.
	select {
	case <-ctx.Done():
		return
	case <-time.After(30 * time.Second):
	}

	// Configurable concurrency per worker (default 4).
	repairConcurrency := 4
	if v := os.Getenv("REPAIR_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			repairConcurrency = n
		}
	}
	// Configurable batch size (default 2000).
	repairBatch := 2000
	if v := os.Getenv("REPAIR_BATCH"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			repairBatch = n
		}
	}

	// Build processor lookup map.
	procMap := make(map[string]Processor)
	for _, p := range d.processors {
		procMap[p.Name()] = p
	}

	log.Printf("[repair] Starting with concurrency=%d batch=%d", repairConcurrency, repairBatch)

	for {
		if ctx.Err() != nil {
			return
		}

		// Run all workers in parallel, each with its own concurrency pool.
		// Workers that do heavy upserts (accounts_worker) use lower concurrency to avoid deadlocks.
		var wg sync.WaitGroup
		totalRepaired := make([]int64, len(d.processors))
		i := 0
		for name, proc := range procMap {
			wg.Add(1)
			workerConc := repairConcurrency
			if name == "accounts_worker" || name == "token_worker" {
				workerConc = 1 // serialize to avoid deadlocks on upsert
			}
			go func(name string, proc Processor, idx, conc int) {
				defer wg.Done()
				totalRepaired[idx] = d.repairWorker(ctx, name, proc, conc, repairBatch)
			}(name, proc, i, workerConc)
			i++
		}
		wg.Wait()

		var sum int64
		for _, n := range totalRepaired {
			sum += n
		}
		if sum == 0 {
			log.Printf("[repair] No unresolved errors found, sleeping 2 minutes")
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Minute):
			}
		} else {
			log.Printf("[repair] Cycle done: repaired %d error(s) total, continuing...", sum)
			time.Sleep(2 * time.Second)
		}
	}
}

// repairWorker repairs errors for a single processor with concurrency.
func (d *LiveDeriver) repairWorker(ctx context.Context, name string, proc Processor, concurrency, batchSize int) int64 {
	blocks, err := d.repo.ListUnresolvedErrorsByWorker(ctx, name, batchSize)
	if err != nil {
		log.Printf("[repair] Failed to list errors for %s: %v", name, err)
		return 0
	}
	if len(blocks) == 0 {
		return 0
	}
	log.Printf("[repair] %s: found %d failed block(s) to repair (%d..%d)",
		name, len(blocks), blocks[0].BlockHeight, blocks[len(blocks)-1].BlockHeight)

	ranges := groupConsecutiveBlocks(blocks, 100, d.chunkSize)

	var repaired int64
	sem := make(chan struct{}, concurrency)
	var mu sync.Mutex

	var wg sync.WaitGroup
	for _, rng := range ranges {
		if ctx.Err() != nil {
			break
		}
		rng := rng
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			procCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			err := safeProcessRangeLive(procCtx, proc, rng[0], rng[1])
			cancel()
			if err != nil {
				log.Printf("[repair] %s range [%d,%d) failed: %v", name, rng[0], rng[1], err)
				return
			}
			resolved, _ := d.repo.ResolveErrorsInRange(ctx, name, rng[0], rng[1])
			mu.Lock()
			repaired += resolved
			mu.Unlock()
			if resolved > 0 {
				log.Printf("[repair] %s range [%d,%d) repaired (%d errors resolved)", name, rng[0], rng[1], resolved)
			}
		}()
	}
	wg.Wait()
	return repaired
}

// groupConsecutiveBlocks groups failed blocks into [from, to) ranges.
// maxGap controls how far apart two blocks can be to still be grouped together.
func groupConsecutiveBlocks(blocks []repository.FailedBlock, maxGap, chunkSize uint64) [][2]uint64 {
	if len(blocks) == 0 {
		return nil
	}
	if chunkSize == 0 {
		chunkSize = 10
	}
	var ranges [][2]uint64
	from := blocks[0].BlockHeight
	prev := blocks[0].BlockHeight
	for _, b := range blocks[1:] {
		if b.BlockHeight-prev > maxGap {
			// End current range, start new one.
			ranges = append(ranges, [2]uint64{from, prev + chunkSize})
			from = b.BlockHeight
		}
		prev = b.BlockHeight
	}
	ranges = append(ranges, [2]uint64{from, prev + chunkSize})
	return ranges
}
