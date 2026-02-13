package ingester

import (
	"context"
	"strings"

	"flowscan-clone/internal/repository"
)

// DailyBalanceWorker aggregates ft_transfers into daily deltas per (address, token, date).
// Run with concurrency=1 to preserve deterministic ordering.
type DailyBalanceWorker struct {
	repo *repository.Repository
}

func NewDailyBalanceWorker(repo *repository.Repository) *DailyBalanceWorker {
	return &DailyBalanceWorker{repo: repo}
}

func (w *DailyBalanceWorker) Name() string {
	return "daily_balance_worker"
}

func (w *DailyBalanceWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	events, err := w.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, false)
	if err != nil {
		return err
	}

	for _, t := range events {
		contract := strings.TrimSpace(t.TokenContractAddress)
		contractName := strings.TrimSpace(t.ContractName)
		if contract == "" || contractName == "" {
			continue
		}
		amount := strings.TrimSpace(t.Amount)
		if amount == "" {
			continue
		}

		date := t.Timestamp.Format("2006-01-02")

		if addr := normalizeAddressLower(t.ToAddress); addr != "" {
			if err := w.repo.UpsertDailyBalanceDelta(ctx, addr, contract, contractName, date, amount, t.BlockHeight); err != nil {
				return err
			}
		}
		if addr := normalizeAddressLower(t.FromAddress); addr != "" {
			if err := w.repo.UpsertDailyBalanceDelta(ctx, addr, contract, contractName, date, negate(amount), t.BlockHeight); err != nil {
				return err
			}
		}
	}
	return nil
}
