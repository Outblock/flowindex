package ingester

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
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
//
// Uses reverse-verification: instead of fetching ALL chain IDs (which hits the 20MB
// storage limit for large collections), we take the DB's known IDs and ask the chain
// "which of these still exist?" via borrowNFT(id) — each call only touches one NFT's
// storage, so it never exceeds limits.
type NFTOwnershipReconciler struct {
	repo          *repository.Repository
	flow          *flowclient.Client
	pairsPerCycle int
	verifyBatch   int
	scriptTimeout time.Duration
}

func NewNFTOwnershipReconciler(repo *repository.Repository, flow *flowclient.Client) *NFTOwnershipReconciler {
	pairsPerCycle := getEnvIntDefault("NFT_RECONCILER_PAIRS_PER_CYCLE", 3)
	timeoutMs := getEnvIntDefault("NFT_RECONCILER_SCRIPT_TIMEOUT_MS", 30000)
	verifyBatch := getEnvIntDefault("NFT_RECONCILER_VERIFY_BATCH", 200)
	return &NFTOwnershipReconciler{
		repo:          repo,
		flow:          flow,
		pairsPerCycle: pairsPerCycle,
		verifyBatch:   verifyBatch,
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
			pairKey := pair.Owner + "/" + pair.ContractAddress + "." + pair.ContractName
			log.Printf("[nft_ownership_reconciler] error reconciling %s (%d in DB): %v",
				pairKey, pair.Count, err)
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
		publicPath, err = w.resolvePublicPath(ctx, pair.ContractAddress, pair.ContractName)
		if err != nil || publicPath == "" {
			log.Printf("[nft_ownership_reconciler] no public path for %s.%s, skipping", pair.ContractAddress, pair.ContractName)
			return nil
		}
	}

	// Strip /public/ prefix — PublicPath(identifier:) needs just the identifier.
	publicPath = strings.TrimPrefix(publicPath, "/public/")

	// 2. Get our DB's view of what this owner holds.
	dbIDs, err := w.repo.ListNFTIDsByOwnerCollection(ctx, pair.Owner, pair.ContractAddress, pair.ContractName)
	if err != nil {
		return fmt.Errorf("list db ids: %w", err)
	}
	if len(dbIDs) == 0 {
		return nil
	}

	// 3. Reverse-verify: ask chain which of our DB IDs still exist, in batches.
	var staleIDs []string
	for i := 0; i < len(dbIDs); i += w.verifyBatch {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		end := i + w.verifyBatch
		if end > len(dbIDs) {
			end = len(dbIDs)
		}
		batch := dbIDs[i:end]
		missing, err := w.verifyNFTIDsOnChain(ctx, pair.Owner, publicPath, batch)
		if err != nil {
			return fmt.Errorf("verify batch [%d:%d]: %w", i, end, err)
		}
		staleIDs = append(staleIDs, missing...)
	}

	if len(staleIDs) == 0 {
		log.Printf("[nft_ownership_reconciler] %s/%s.%s: OK (%d DB, 0 stale)",
			pair.Owner, pair.ContractAddress, pair.ContractName, len(dbIDs))
		return nil
	}

	// 4. Delete stale records in batches.
	const deleteBatch = 1000
	var totalDeleted int64
	for i := 0; i < len(staleIDs); i += deleteBatch {
		end := i + deleteBatch
		if end > len(staleIDs) {
			end = len(staleIDs)
		}
		deleted, err := w.repo.DeleteNFTOwnershipBatch(ctx, pair.ContractAddress, pair.ContractName, staleIDs[i:end])
		if err != nil {
			return fmt.Errorf("delete batch: %w", err)
		}
		totalDeleted += deleted
	}

	log.Printf("[nft_ownership_reconciler] %s/%s.%s: removed %d stale records (%d DB)",
		pair.Owner, pair.ContractAddress, pair.ContractName, totalDeleted, len(dbIDs))
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

// verifyNFTIDsOnChain takes a batch of NFT IDs from our DB and asks the chain
// which ones the owner NO LONGER holds. Uses borrowNFT(id) per-ID which only
// reads one NFT's storage — never hits the 20MB interaction limit.
// Returns the list of IDs that are missing on-chain (stale).
func (w *NFTOwnershipReconciler) verifyNFTIDsOnChain(ctx context.Context, owner, publicPathID string, nftIDs []string) ([]string, error) {
	ownerAddr := flowsdk.HexToAddress(owner)
	pathVal, _ := cadence.NewString(publicPathID)

	// Convert string IDs to Cadence UInt64 array.
	cadenceIDs := make([]cadence.Value, 0, len(nftIDs))
	for _, idStr := range nftIDs {
		n, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil {
			continue // skip non-numeric IDs
		}
		cadenceIDs = append(cadenceIDs, cadence.NewUInt64(n))
	}
	if len(cadenceIDs) == 0 {
		return nil, nil
	}

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimeout)
	defer cancel()

	nftAddr := getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", "1d7e57aa55817448")
	script := fmt.Sprintf(`
		import NonFungibleToken from 0x%s

		access(all) fun main(owner: Address, publicPathID: String, ids: [UInt64]): [UInt64] {
			let account = getAccount(owner)
			let path = PublicPath(identifier: publicPathID)!
			let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection}>(path)
			if collectionRef == nil { return ids }
			let missing: [UInt64] = []
			for id in ids {
				if collectionRef!.borrowNFT(id) == nil {
					missing.append(id)
				}
			}
			return missing
		}
	`, nftAddr)

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(script), []cadence.Value{
		cadence.NewAddress([8]byte(ownerAddr)),
		pathVal,
		cadence.NewArray(cadenceIDs).WithType(cadence.NewVariableSizedArrayType(cadence.UInt64Type)),
	})
	if err != nil {
		return nil, err
	}

	arr, ok := v.(cadence.Array)
	if !ok {
		return nil, fmt.Errorf("expected array, got %T", v)
	}

	missing := make([]string, 0, len(arr.Values))
	for _, val := range arr.Values {
		switch n := val.(type) {
		case cadence.UInt64:
			missing = append(missing, strconv.FormatUint(uint64(n), 10))
		default:
			missing = append(missing, val.String())
		}
	}
	return missing, nil
}
