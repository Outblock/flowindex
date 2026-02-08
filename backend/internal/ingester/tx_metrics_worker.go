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
	// All workers use half-open ranges: [fromHeight, toHeight).
	// BackfillTxMetricsRange uses inclusive bounds (BETWEEN), so we convert.
	if toHeight <= fromHeight {
		return nil
	}

	endInclusive := toHeight - 1
	if err := w.repo.BackfillTxMetricsRange(ctx, int64(fromHeight), int64(endInclusive)); err != nil {
		return fmt.Errorf("backfill tx metrics %d-%d: %w", fromHeight, endInclusive, err)
	}
	return nil
}
