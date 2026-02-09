package ingester

import (
	"context"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// NFTOwnershipWorker updates app.nft_ownership from NFT transfer events.
// NOTE: Run with concurrency=1 to preserve deterministic ordering.
type NFTOwnershipWorker struct {
	repo *repository.Repository
}

func NewNFTOwnershipWorker(repo *repository.Repository) *NFTOwnershipWorker {
	return &NFTOwnershipWorker{repo: repo}
}

func (w *NFTOwnershipWorker) Name() string {
	return "nft_ownership_worker"
}

func (w *NFTOwnershipWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	transfers, err := w.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, true)
	if err != nil {
		return err
	}

	for _, t := range transfers {
		if t.TokenID == "" || t.TokenContractAddress == "" {
			continue
		}
		if t.ContractName == "" {
			continue
		}
		owner := normalizeAddressLower(t.ToAddress)
		ownership := models.NFTOwnership{
			ContractAddress: t.TokenContractAddress,
			ContractName:    t.ContractName,
			NFTID:           t.TokenID,
			Owner:           owner,
			LastHeight:      t.BlockHeight,
		}
		if err := w.repo.UpsertNFTOwnership(ctx, ownership); err != nil {
			return err
		}
	}
	return nil
}
