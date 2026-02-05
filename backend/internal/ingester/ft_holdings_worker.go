package ingester

import (
	"context"
	"strings"

	"flowscan-clone/internal/repository"
)

// FTHoldingsWorker incrementally updates app.ft_holdings from token transfers.
// NOTE: Run with concurrency=1 to preserve deterministic ordering.
type FTHoldingsWorker struct {
	repo *repository.Repository
}

func NewFTHoldingsWorker(repo *repository.Repository) *FTHoldingsWorker {
	return &FTHoldingsWorker{repo: repo}
}

func (w *FTHoldingsWorker) Name() string {
	return "ft_holdings_worker"
}

func (w *FTHoldingsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	events, err := w.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, false)
	if err != nil {
		return err
	}

	for _, t := range events {
		contract := strings.TrimSpace(t.TokenContractAddress)
		if contract == "" {
			continue
		}
		amount := strings.TrimSpace(t.Amount)
		if amount == "" {
			continue
		}

		if addr := normalizeAddressLower(t.FromAddress); addr != "" {
			if err := w.repo.UpsertFTHoldingsDelta(ctx, addr, contract, negate(amount), t.BlockHeight); err != nil {
				return err
			}
		}
		if addr := normalizeAddressLower(t.ToAddress); addr != "" {
			if err := w.repo.UpsertFTHoldingsDelta(ctx, addr, contract, amount, t.BlockHeight); err != nil {
				return err
			}
		}
	}
	return nil
}

func negate(amount string) string {
	if strings.HasPrefix(amount, "-") {
		return strings.TrimPrefix(amount, "-")
	}
	return "-" + amount
}
