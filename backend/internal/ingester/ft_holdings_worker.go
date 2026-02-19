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

	// Collect all deltas in a slice — DB-side aggregation handles dedup.
	deltas := make([]repository.FTHoldingDelta, 0, len(events)*2)
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

		if addr := normalizeAddressLower(t.FromAddress); addr != "" {
			deltas = append(deltas, repository.FTHoldingDelta{
				Address: addr, Contract: contract, ContractName: contractName,
				Delta: negate(amount), Height: t.BlockHeight,
			})
		}
		if addr := normalizeAddressLower(t.ToAddress); addr != "" {
			deltas = append(deltas, repository.FTHoldingDelta{
				Address: addr, Contract: contract, ContractName: contractName,
				Delta: amount, Height: t.BlockHeight,
			})
		}
	}

	return w.repo.BulkUpsertFTHoldingsDeltas(ctx, deltas)
}

func negate(amount string) string {
	if strings.HasPrefix(amount, "-") {
		return strings.TrimPrefix(amount, "-")
	}
	return "-" + amount
}
