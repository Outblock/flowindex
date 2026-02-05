package ingester

import (
	"context"
	"fmt"

	"flowscan-clone/internal/repository"
)

type TxMetricsWorker struct {
	repo *repository.Repository
}

func NewTxMetricsWorker(repo *repository.Repository) *TxMetricsWorker {
	return &TxMetricsWorker{repo: repo}
}

func (w *TxMetricsWorker) Name() string {
	return "tx_metrics_worker"
}

func (w *TxMetricsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if fromHeight > toHeight {
		return nil
	}
	if err := w.repo.BackfillTxMetricsRange(ctx, int64(fromHeight), int64(toHeight)); err != nil {
		return fmt.Errorf("backfill tx metrics %d-%d: %w", fromHeight, toHeight, err)
	}
	return nil
}
