package ingester

import (
	"context"
	"log"
	"time"

	"flowscan-clone/internal/repository"
)

// HistoryDeriver processes raw blocks that were backfilled by the history ingester
// but missed by async workers (whose checkpoints are already at the live tip).
//
// It scans upward from the lowest raw block height, running all configured processors
// in dependency order on each chunk. It maintains its own checkpoint
// ("history_deriver") and stops when it reaches the async workers' territory.
type HistoryDeriver struct {
	repo       *repository.Repository
	processors []Processor
	chunkSize  uint64
	sleepMs    int
}

type HistoryDeriverConfig struct {
	ChunkSize uint64
	SleepMs   int // milliseconds between chunks (throttle DB load)
}

func NewHistoryDeriver(repo *repository.Repository, processors []Processor, cfg HistoryDeriverConfig) *HistoryDeriver {
	if cfg.ChunkSize == 0 {
		cfg.ChunkSize = 1000
	}
	return &HistoryDeriver{
		repo:       repo,
		processors: processors,
		chunkSize:  cfg.ChunkSize,
		sleepMs:    cfg.SleepMs,
	}
}

const historyDeriverCheckpoint = "history_deriver"

func (h *HistoryDeriver) Start(ctx context.Context) {
	if len(h.processors) == 0 {
		log.Printf("[history_deriver] Disabled: no processors configured")
		return
	}
	log.Printf("[history_deriver] Starting (processors=%d chunk=%d)", len(h.processors), h.chunkSize)
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

		advanced, err := h.processNextChunk(ctx)
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
			// No work available; wait for history ingester to fill more blocks.
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		// Throttle between chunks to avoid overwhelming the DB.
		if h.sleepMs > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(h.sleepMs) * time.Millisecond):
			}
		}
	}
}

func (h *HistoryDeriver) processNextChunk(ctx context.Context) (bool, error) {
	// 1. Determine where we left off.
	checkpoint, err := h.repo.GetLastIndexedHeight(ctx, historyDeriverCheckpoint)
	if err != nil {
		return false, err
	}

	// 2. Determine the raw data boundaries.
	minRaw, maxRaw, _, err := h.repo.GetBlockRange(ctx)
	if err != nil {
		return false, err
	}
	if minRaw == 0 || maxRaw == 0 {
		return false, nil
	}

	// 3. Determine our scan start.
	var scanFrom uint64
	if checkpoint > 0 {
		scanFrom = checkpoint
	} else {
		// First run: start at the bottom of raw data.
		scanFrom = minRaw
	}

	// 4. Determine the ceiling: the lowest async worker checkpoint.
	// Workers above this height have already processed the data; we only need
	// to cover the gap below.
	ceiling, err := h.findWorkerFloor(ctx)
	if err != nil {
		return false, err
	}
	if ceiling == 0 {
		// Workers haven't started yet; use maxRaw as ceiling.
		ceiling = maxRaw
	}

	if scanFrom >= ceiling {
		// We've caught up to the async workers — nothing to derive.
		return false, nil
	}

	// 5. Process one chunk.
	scanTo := scanFrom + h.chunkSize
	if scanTo > ceiling {
		scanTo = ceiling
	}

	var anyFailed bool
	for _, p := range h.processors {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		began := time.Now()
		if err := p.ProcessRange(ctx, scanFrom, scanTo); err != nil {
			log.Printf("[history_deriver] %s range [%d,%d) failed: %v", p.Name(), scanFrom, scanTo, err)
			_ = h.repo.LogIndexingError(ctx, p.Name(), scanFrom, "", "HISTORY_DERIVER_ERROR", err.Error(), nil)
			anyFailed = true
			// Continue to next processor — don't block the entire chain.
			continue
		}
		if dur := time.Since(began); dur > 2*time.Second {
			log.Printf("[history_deriver] %s range [%d,%d) took %s", p.Name(), scanFrom, scanTo, dur)
		}
	}
	_ = anyFailed // Failures are logged; we still advance so we don't get stuck.

	// 6. Advance our checkpoint.
	if err := h.repo.UpdateCheckpoint(ctx, historyDeriverCheckpoint, scanTo); err != nil {
		log.Printf("[history_deriver] Failed to update checkpoint: %v", err)
	}

	if scanTo%100000 < h.chunkSize {
		log.Printf("[history_deriver] Progress: processed up to height %d (ceiling=%d)", scanTo, ceiling)
	}

	return true, nil
}

// findWorkerFloor returns the lowest checkpoint among the async workers that
// were running before history derivation. This represents the point below which
// async workers have NOT processed data.
func (h *HistoryDeriver) findWorkerFloor(ctx context.Context) (uint64, error) {
	// Use the first processor's name as a proxy. All core processors started
	// at the same time and have similar checkpoints.
	// We check a few key upstream workers and return the minimum.
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
