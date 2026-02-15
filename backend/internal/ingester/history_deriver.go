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
// It maintains two cursors:
//   - upCursor: scans upward from the initial min raw height to the async worker ceiling.
//     This handles the one-time backlog of already-indexed history blocks.
//   - downCursor: scans downward from the initial min raw height as the history ingester
//     fills new blocks below. This handles ongoing history backfill.
//
// Additionally, the backward ingester's OnIndexedRange callback triggers a LiveDeriver
// instance for real-time processing of new batches. The downward cursor serves as a
// safety net for restart gaps.
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

const (
	historyDeriverUpCheckpoint   = "history_deriver"
	historyDeriverDownCheckpoint = "history_deriver_down"
)

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

	scanTo := scanFrom + h.chunkSize
	if scanTo > ceiling {
		scanTo = ceiling
	}

	h.runProcessors(ctx, scanFrom, scanTo)

	if err := h.repo.UpdateCheckpoint(ctx, historyDeriverUpCheckpoint, scanTo); err != nil {
		log.Printf("[history_deriver] Failed to update up checkpoint: %v", err)
	}

	if scanTo%100000 < h.chunkSize {
		log.Printf("[history_deriver] Progress UP: processed to %d (ceiling=%d)", scanTo, ceiling)
	}

	return true, nil
}

// processDownward scans from the downCursor toward the current minRaw.
// As the history ingester fills blocks going backward, minRaw decreases.
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

	// Process the lowest unprocessed chunk: [minRaw, minRaw + chunkSize)
	// We scan upward from minRaw toward downCursor.
	scanFrom := minRaw
	scanTo := scanFrom + h.chunkSize
	if scanTo > downCursor {
		scanTo = downCursor
	}

	h.runProcessors(ctx, scanFrom, scanTo)

	// Advance by moving the downCursor toward minRaw.
	// Since we processed [minRaw, scanTo), the new floor becomes scanTo.
	// But minRaw might keep decreasing, so we track the "processed floor" as a
	// separate concept. Use a simple approach: update downCursor to be the new
	// lower bound of processed data.
	//
	// Actually, to keep it simple: the downCursor represents "everything from
	// downCursor upward has been processed". We process from minRaw upward,
	// so after processing [minRaw, scanTo), if scanTo == downCursor then the
	// full gap is closed. Otherwise we need to continue next tick.
	if scanTo >= downCursor {
		// Gap fully closed. Move downCursor to minRaw so next check picks up
		// any newly filled blocks below.
		if err := h.repo.UpdateCheckpoint(ctx, historyDeriverDownCheckpoint, minRaw); err != nil {
			log.Printf("[history_deriver] Failed to update down checkpoint: %v", err)
		}
	}
	// If gap not fully closed, don't update downCursor; next tick will
	// continue from minRaw (which may be even lower by then).

	if scanTo%100000 < h.chunkSize {
		log.Printf("[history_deriver] Progress DOWN: processed [%d,%d) (downCursor=%d)", scanFrom, scanTo, downCursor)
	}

	return true, nil
}

func (h *HistoryDeriver) runProcessors(ctx context.Context, from, to uint64) {
	for _, p := range h.processors {
		if ctx.Err() != nil {
			return
		}
		began := time.Now()
		if err := p.ProcessRange(ctx, from, to); err != nil {
			log.Printf("[history_deriver] %s range [%d,%d) failed: %v", p.Name(), from, to, err)
			_ = h.repo.LogIndexingError(ctx, p.Name(), from, "", "HISTORY_DERIVER_ERROR", err.Error(), nil)
			continue
		}
		if dur := time.Since(began); dur > 2*time.Second {
			log.Printf("[history_deriver] %s range [%d,%d) took %s", p.Name(), from, to, dur)
		}
	}
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
