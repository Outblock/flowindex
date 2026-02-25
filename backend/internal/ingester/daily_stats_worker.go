package ingester

import (
	"context"
	"fmt"

	"flowscan-clone/internal/repository"
)

type DailyStatsWorker struct {
	repo *repository.Repository
}

func NewDailyStatsWorker(repo *repository.Repository) *DailyStatsWorker {
	return &DailyStatsWorker{repo: repo}
}

func (w *DailyStatsWorker) Name() string {
	return "daily_stats_worker"
}

func (w *DailyStatsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if toHeight <= fromHeight {
		return nil
	}

	if err := w.repo.RefreshDailyStatsRange(ctx, fromHeight, toHeight); err != nil {
		return fmt.Errorf("refresh daily stats %d-%d: %w", fromHeight, toHeight, err)
	}
	return nil
}
