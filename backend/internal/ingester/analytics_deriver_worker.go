package ingester

import (
	"context"
	"fmt"

	"flowscan-clone/internal/repository"
)

type AnalyticsDeriverWorker struct {
	repo *repository.Repository
}

func NewAnalyticsDeriverWorker(repo *repository.Repository) *AnalyticsDeriverWorker {
	return &AnalyticsDeriverWorker{repo: repo}
}

func (w *AnalyticsDeriverWorker) Name() string {
	return "analytics_deriver_worker"
}

func (w *AnalyticsDeriverWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if toHeight <= fromHeight {
		return nil
	}
	// tx_core remains in app.daily_stats for compatibility.
	if err := w.repo.RefreshDailyStatsRange(ctx, fromHeight, toHeight); err != nil {
		return fmt.Errorf("refresh daily stats %d-%d: %w", fromHeight, toHeight, err)
	}
	// analytics module metrics are isolated in analytics.daily_metrics.
	if err := w.repo.RefreshAnalyticsDailyMetricsRange(ctx, fromHeight, toHeight); err != nil {
		return fmt.Errorf("refresh analytics daily metrics %d-%d: %w", fromHeight, toHeight, err)
	}
	return nil
}
