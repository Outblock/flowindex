package ingester

import (
	"context"
	"regexp"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// TxContractsWorker extracts contract imports/tags from transaction scripts/events.
type TxContractsWorker struct {
	repo *repository.Repository
}

func NewTxContractsWorker(repo *repository.Repository) *TxContractsWorker {
	return &TxContractsWorker{repo: repo}
}

func (w *TxContractsWorker) Name() string {
	return "tx_contracts_worker"
}

var importRe = regexp.MustCompile(`(?m)^\s*import\s+([A-Za-z0-9_]+)(?:\s+from\s+0x([0-9a-fA-F]+))?`)

func (w *TxContractsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	txs, err := w.repo.GetRawTransactionsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return err
	}

	contracts := make([]models.TxContract, 0)
	tags := make([]models.TxTag, 0)

	for _, tx := range txs {
		if tx.Script != "" {
			matches := importRe.FindAllStringSubmatch(tx.Script, -1)
			for _, m := range matches {
				name := strings.TrimSpace(m[1])
				addr := strings.ToLower(strings.TrimSpace(m[2]))
				identifier := name
				if addr != "" {
					identifier = "A." + addr + "." + name
				}
				contracts = append(contracts, models.TxContract{
					TransactionID:     tx.ID,
					ContractIdentifier: identifier,
					Source:            "script_import",
				})
			}
		}
	}

	// Tag transactions based on token transfers.
	transfers, err := w.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, false)
	if err == nil {
		seen := make(map[string]bool)
		for _, t := range transfers {
			if seen[t.TransactionID] {
				continue
			}
			seen[t.TransactionID] = true
			tags = append(tags, models.TxTag{TransactionID: t.TransactionID, Tag: "FT_TRANSFER"})
		}
	}
	nftTransfers, err := w.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, true)
	if err == nil {
		seen := make(map[string]bool)
		for _, t := range nftTransfers {
			if seen[t.TransactionID] {
				continue
			}
			seen[t.TransactionID] = true
			tags = append(tags, models.TxTag{TransactionID: t.TransactionID, Tag: "NFT_TRANSFER"})
		}
	}

	if err := w.repo.UpsertTxContracts(ctx, contracts); err != nil {
		return err
	}
	if err := w.repo.UpsertTxTags(ctx, tags); err != nil {
		return err
	}
	return nil
}
