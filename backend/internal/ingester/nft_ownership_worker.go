package ingester

import (
	"context"
	"os"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// Known custodial/wrapper addresses that hold NFTs on behalf of users.
// These addresses show huge ownership counts but the actual NFTs are
// managed internally (e.g., Dapper custodial wallets for TopShot).
// Transfers TO these addresses are skipped to avoid inflated counts.
var defaultCustodialAddresses = map[string]bool{
	"e1f2a091f7bb5245": true, // Dapper TopShot custodial wallet
}

// NFTOwnershipWorker updates app.nft_ownership from NFT transfer events.
// NOTE: Run with concurrency=1 to preserve deterministic ordering.
type NFTOwnershipWorker struct {
	repo               *repository.Repository
	custodialAddresses map[string]bool
}

func NewNFTOwnershipWorker(repo *repository.Repository) *NFTOwnershipWorker {
	addrs := make(map[string]bool)
	for k, v := range defaultCustodialAddresses {
		addrs[k] = v
	}
	// Allow adding extra addresses via env: NFT_CUSTODIAL_ADDRESSES=addr1,addr2,...
	if extra := os.Getenv("NFT_CUSTODIAL_ADDRESSES"); extra != "" {
		for _, a := range strings.Split(extra, ",") {
			a = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(a), "0x"))
			if a != "" {
				addrs[a] = true
			}
		}
	}
	return &NFTOwnershipWorker{repo: repo, custodialAddresses: addrs}
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
		if t.ContractName == "" || t.ContractName == "NonFungibleToken" || t.ContractName == "FungibleToken" {
			continue
		}
		if t.ToAddress == "" {
			continue
		}
		owner := normalizeAddressLower(t.ToAddress)
		// Skip custodial/wrapper addresses to avoid inflated ownership counts.
		if w.custodialAddresses[owner] {
			continue
		}
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
