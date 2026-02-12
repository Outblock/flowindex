package ingester

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/repository"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

// NFTOwnershipReconciler periodically checks the largest (owner, collection) pairs
// in nft_ownership against the chain. If the chain shows the owner no longer holds
// certain NFTs, those rows are deleted from nft_ownership.
//
// Strategy: check the top-N holders (by count) each cycle. These are most likely
// to be custodial/marketplace addresses with stale data.
type NFTOwnershipReconciler struct {
	repo          *repository.Repository
	flow          *flowclient.Client
	pairsPerCycle int
	scriptTimeout time.Duration
}

func NewNFTOwnershipReconciler(repo *repository.Repository, flow *flowclient.Client) *NFTOwnershipReconciler {
	pairsPerCycle := getEnvIntDefault("NFT_RECONCILER_PAIRS_PER_CYCLE", 3)
	timeoutMs := getEnvIntDefault("NFT_RECONCILER_SCRIPT_TIMEOUT_MS", 30000)
	return &NFTOwnershipReconciler{
		repo:          repo,
		flow:          flow,
		pairsPerCycle: pairsPerCycle,
		scriptTimeout: time.Duration(timeoutMs) * time.Millisecond,
	}
}

func (w *NFTOwnershipReconciler) Name() string { return "nft_ownership_reconciler" }

// ProcessRange is queue-based: ignores block heights, picks top holders to reconcile.
func (w *NFTOwnershipReconciler) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if w.flow == nil {
		return nil
	}

	pairs, err := w.repo.ListTopOwnerCollections(ctx, w.pairsPerCycle)
	if err != nil {
		return fmt.Errorf("list top owner collections: %w", err)
	}

	for _, pair := range pairs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := w.reconcilePair(ctx, pair); err != nil {
			log.Printf("[nft_ownership_reconciler] error reconciling %s/%s.%s (%d in DB): %v",
				pair.Owner, pair.ContractAddress, pair.ContractName, pair.Count, err)
		}
	}
	return nil
}

func (w *NFTOwnershipReconciler) reconcilePair(ctx context.Context, pair repository.OwnerCollectionCount) error {
	// 1. Resolve public path for this collection.
	publicPath, err := w.repo.GetCollectionPublicPath(ctx, pair.ContractAddress, pair.ContractName)
	if err != nil {
		return err
	}
	if publicPath == "" {
		// Try resolving it via the same script as nft_item_metadata_worker.
		publicPath, err = w.resolvePublicPath(ctx, pair.ContractAddress, pair.ContractName)
		if err != nil || publicPath == "" {
			log.Printf("[nft_ownership_reconciler] no public path for %s.%s, skipping", pair.ContractAddress, pair.ContractName)
			return nil
		}
	}

	// 2. Query chain for actual NFT IDs this owner holds.
	chainIDs, err := w.getChainNFTIDs(ctx, pair.Owner, publicPath)
	if err != nil {
		return fmt.Errorf("chain query: %w", err)
	}

	// 3. Get our DB's view of what this owner holds.
	dbIDs, err := w.repo.ListNFTIDsByOwnerCollection(ctx, pair.Owner, pair.ContractAddress, pair.ContractName)
	if err != nil {
		return fmt.Errorf("list db ids: %w", err)
	}

	// 4. Find stale IDs (in DB but not on chain).
	chainSet := make(map[string]bool, len(chainIDs))
	for _, id := range chainIDs {
		chainSet[id] = true
	}
	var staleIDs []string
	for _, id := range dbIDs {
		if !chainSet[id] {
			staleIDs = append(staleIDs, id)
		}
	}

	if len(staleIDs) == 0 {
		log.Printf("[nft_ownership_reconciler] %s/%s.%s: OK (%d chain, %d DB, 0 stale)",
			pair.Owner, pair.ContractAddress, pair.ContractName, len(chainIDs), len(dbIDs))
		return nil
	}

	// 5. Delete stale records in batches.
	const batchSize = 1000
	var totalDeleted int64
	for i := 0; i < len(staleIDs); i += batchSize {
		end := i + batchSize
		if end > len(staleIDs) {
			end = len(staleIDs)
		}
		deleted, err := w.repo.DeleteNFTOwnershipBatch(ctx, pair.ContractAddress, pair.ContractName, staleIDs[i:end])
		if err != nil {
			return fmt.Errorf("delete batch: %w", err)
		}
		totalDeleted += deleted
	}

	log.Printf("[nft_ownership_reconciler] %s/%s.%s: removed %d stale records (%d chain, %d DB)",
		pair.Owner, pair.ContractAddress, pair.ContractName, totalDeleted, len(chainIDs), len(dbIDs))
	return nil
}

func (w *NFTOwnershipReconciler) resolvePublicPath(ctx context.Context, contractAddr, contractName string) (string, error) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimeout)
	defer cancel()

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(cadenceResolvePublicPathScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return "", err
	}

	v = unwrapOptional(v)
	if v == nil {
		return "", nil
	}

	path := cadenceToString(v)
	if path != "" {
		_ = w.repo.UpdateCollectionPublicPath(ctx, contractAddr, contractName, path)
	}
	return path, nil
}

func (w *NFTOwnershipReconciler) getChainNFTIDs(ctx context.Context, owner, publicPathID string) ([]string, error) {
	ownerAddr := flowsdk.HexToAddress(owner)
	pathVal, _ := cadence.NewString(publicPathID)

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimeout)
	defer cancel()

	nftAddr := getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", "1d7e57aa55817448")
	script := fmt.Sprintf(`
		import NonFungibleToken from 0x%s

		access(all) fun main(owner: Address, publicPathID: String): [UInt64] {
			let account = getAccount(owner)
			let path = PublicPath(identifier: publicPathID)!
			let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection}>(path)
			if collectionRef == nil { return [] }
			return collectionRef!.getIDs()
		}
	`, nftAddr)

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(script), []cadence.Value{
		cadence.NewAddress([8]byte(ownerAddr)),
		pathVal,
	})
	if err != nil {
		return nil, err
	}

	arr, ok := v.(cadence.Array)
	if !ok {
		return nil, fmt.Errorf("expected array, got %T", v)
	}

	ids := make([]string, 0, len(arr.Values))
	for _, val := range arr.Values {
		switch n := val.(type) {
		case cadence.UInt64:
			ids = append(ids, strconv.FormatUint(uint64(n), 10))
		default:
			ids = append(ids, val.String())
		}
	}
	return ids, nil
}
