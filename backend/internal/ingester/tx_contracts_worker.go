package ingester

import (
	"context"
	"regexp"
	"strings"
	"sync"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// TxContractsWorker extracts contract imports/tags from transaction scripts/events.
// It caches parsed imports by script_hash so each unique Cadence template is
// only regex-parsed once across all chunks.
type TxContractsWorker struct {
	repo *repository.Repository

	// importCache maps script_hash -> list of contract identifiers extracted from that script.
	// Since many transactions share the same Cadence template, this avoids redundant regex parsing.
	importCache sync.Map // map[string][]contractImport
}

type contractImport struct {
	Identifier   string // e.g. "A.1654653399040a61.FlowToken"
	IsScheduled  bool   // contains FlowTransactionScheduler
}

func NewTxContractsWorker(repo *repository.Repository) *TxContractsWorker {
	return &TxContractsWorker{repo: repo}
}

func (w *TxContractsWorker) Name() string {
	return "tx_contracts_worker"
}

var importRe = regexp.MustCompile(`(?m)^\s*import\s+([A-Za-z0-9_]+)(?:\s+from\s+0x([0-9a-fA-F]+))?`)

// parseImports extracts contract identifiers from a Cadence script.
func parseImports(script string) []contractImport {
	matches := importRe.FindAllStringSubmatch(script, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]contractImport, 0, len(matches))
	for _, m := range matches {
		name := strings.TrimSpace(m[1])
		addr := strings.ToLower(strings.TrimSpace(m[2]))
		identifier := name
		if addr != "" {
			identifier = "A." + addr + "." + name
		}
		out = append(out, contractImport{
			Identifier:  identifier,
			IsScheduled: strings.Contains(identifier, "FlowTransactionScheduler"),
		})
	}
	return out
}

func (w *TxContractsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// Step 1: Fetch only (tx_id, script_hash) — no JOIN, no script text.
	txHashes, err := w.repo.GetTxScriptHashesInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return err
	}

	// Step 2: Collect unique script_hashes that aren't in cache yet.
	needFetch := make(map[string]bool)
	for _, tx := range txHashes {
		if tx.ScriptHash == "" {
			continue
		}
		if _, ok := w.importCache.Load(tx.ScriptHash); !ok {
			needFetch[tx.ScriptHash] = true
		}
	}

	// Step 3: Batch-fetch script texts for uncached hashes.
	if len(needFetch) > 0 {
		hashList := make([]string, 0, len(needFetch))
		for h := range needFetch {
			hashList = append(hashList, h)
		}
		scriptTexts, err := w.repo.GetScriptTextsByHashes(ctx, hashList)
		if err != nil {
			return err
		}
		// Parse and cache each script.
		for hash, text := range scriptTexts {
			imports := parseImports(text)
			w.importCache.Store(hash, imports)
		}
		// For hashes not found in raw.scripts (shouldn't happen but be safe), cache empty.
		for _, h := range hashList {
			if _, ok := scriptTexts[h]; !ok {
				w.importCache.Store(h, []contractImport(nil))
			}
		}
	}

	// Step 4: Build script_imports, tx_contracts, and tags from cached imports.
	seenImport := make(map[string]bool)
	scriptImports := make([]models.ScriptImport, 0)
	txContracts := make([]models.TxContract, 0)
	seenContract := make(map[string]bool)
	tags := make([]models.TxTag, 0)
	seenTag := make(map[string]bool)
	addTag := func(txID, tag string) {
		if txID == "" || tag == "" {
			return
		}
		k := txID + "|" + tag
		if seenTag[k] {
			return
		}
		seenTag[k] = true
		tags = append(tags, models.TxTag{TransactionID: txID, Tag: tag})
	}

	for _, tx := range txHashes {
		if tx.ScriptHash == "" {
			continue
		}
		cached, ok := w.importCache.Load(tx.ScriptHash)
		if !ok {
			continue
		}
		imports, _ := cached.([]contractImport)
		for _, imp := range imports {
			// Only add one script_import row per unique (hash, identifier).
			key := tx.ScriptHash + "|" + imp.Identifier
			if !seenImport[key] {
				seenImport[key] = true
				scriptImports = append(scriptImports, models.ScriptImport{
					ScriptHash:         tx.ScriptHash,
					ContractIdentifier: imp.Identifier,
				})
			}
			// Build tx_contracts row (one per unique tx+contract).
			cKey := tx.ID + "|" + imp.Identifier
			if !seenContract[cKey] {
				seenContract[cKey] = true
				txContracts = append(txContracts, models.TxContract{
					TransactionID:      tx.ID,
					ContractIdentifier: imp.Identifier,
					Source:             "import",
					BlockHeight:        tx.BlockHeight,
				})
			}
			if imp.IsScheduled {
				addTag(tx.ID, "SCHEDULED_TX")
			}
		}
	}

	// Fetch tag sources in parallel: FT transfers, NFT transfers, event types.
	type tagResult struct {
		ftTxIDs    []string
		nftTxIDs   []string
		eventTypes []repository.EventTypeRow
	}
	var tr tagResult
	var tagWg sync.WaitGroup
	var tagMu sync.Mutex
	var tagErr error
	setTagErr := func(e error) {
		tagMu.Lock()
		if tagErr == nil {
			tagErr = e
		}
		tagMu.Unlock()
	}

	tagWg.Add(3)
	go func() {
		defer tagWg.Done()
		ids, e := w.repo.GetTransferTxIDsInRange(ctx, fromHeight, toHeight, false)
		if e != nil {
			setTagErr(e)
			return
		}
		tagMu.Lock()
		tr.ftTxIDs = ids
		tagMu.Unlock()
	}()
	go func() {
		defer tagWg.Done()
		ids, e := w.repo.GetTransferTxIDsInRange(ctx, fromHeight, toHeight, true)
		if e != nil {
			setTagErr(e)
			return
		}
		tagMu.Lock()
		tr.nftTxIDs = ids
		tagMu.Unlock()
	}()
	go func() {
		defer tagWg.Done()
		evts, e := w.repo.GetEventTypesInRange(ctx, fromHeight, toHeight)
		if e != nil {
			setTagErr(e)
			return
		}
		tagMu.Lock()
		tr.eventTypes = evts
		tagMu.Unlock()
	}()
	tagWg.Wait()
	if tagErr != nil {
		return tagErr
	}

	for _, txID := range tr.ftTxIDs {
		addTag(txID, "FT_TRANSFER")
	}
	for _, txID := range tr.nftTxIDs {
		addTag(txID, "NFT_TRANSFER")
	}

	// Additional tags derived from raw event types (no payload needed).
	for _, evt := range tr.eventTypes {
		evtType := evt.Type
		switch {
		case isEVMTransactionExecutedEvent(evtType):
			addTag(evt.TransactionID, "EVM")
		case strings.Contains(evtType, "EVM.FLOWTokensWithdrawn") ||
			strings.Contains(evtType, "EVM.FLOWTokensDeposited") ||
			strings.Contains(evtType, "FlowEVMBridge"):
			addTag(evt.TransactionID, "EVM_BRIDGE")
		case strings.Contains(evtType, "NFTStorefront"):
			addTag(evt.TransactionID, "MARKETPLACE")
		case strings.Contains(evtType, "AccountContractAdded") || strings.Contains(evtType, "AccountContractUpdated"):
			addTag(evt.TransactionID, "CONTRACT_DEPLOY")
		case evtType == "flow.AccountCreated":
			addTag(evt.TransactionID, "ACCOUNT_CREATED")
		case strings.Contains(evtType, "AccountKeyAdded") || strings.Contains(evtType, "AccountKeyRemoved"):
			addTag(evt.TransactionID, "KEY_UPDATE")
		case strings.Contains(evtType, "FlowTransactionScheduler"):
			addTag(evt.TransactionID, "SCHEDULED_TX")
		case strings.Contains(evtType, ".SwapPair.Swap") ||
			strings.Contains(evtType, ".BloctoSwapPair.Swap") ||
			strings.Contains(evtType, ".MetaPierSwapPair.Swap"):
			addTag(evt.TransactionID, "SWAP")
		case strings.Contains(evtType, ".SwapPair.AddLiquidity") ||
			strings.Contains(evtType, ".SwapPair.RemoveLiquidity"):
			addTag(evt.TransactionID, "LIQUIDITY")
		case strings.Contains(evtType, ".FlowIDTableStaking.TokensStaked") ||
			strings.Contains(evtType, ".FlowIDTableStaking.TokensUnstaked") ||
			strings.Contains(evtType, ".FlowIDTableStaking.TokensCommitted") ||
			strings.Contains(evtType, ".FlowIDTableStaking.RewardsPaid") ||
			strings.Contains(evtType, ".FlowIDTableStaking.DelegatorRewardsPaid") ||
			strings.Contains(evtType, "FlowStakingCollection"):
			addTag(evt.TransactionID, "STAKING")
		case strings.Contains(evtType, "LiquidStaking") ||
			strings.Contains(evtType, "stFlowToken"):
			addTag(evt.TransactionID, "LIQUID_STAKING")
		case strings.Contains(evtType, ".TokensMinted") && !strings.Contains(evtType, "FlowToken.TokensMinted"):
			addTag(evt.TransactionID, "TOKEN_MINT")
		case strings.Contains(evtType, ".TokensBurned") && !strings.Contains(evtType, "FlowToken.TokensBurned"):
			addTag(evt.TransactionID, "TOKEN_BURN")
		}
	}

	if err := w.repo.BulkUpsertTxContracts(ctx, txContracts); err != nil {
		return err
	}
	if err := w.repo.BulkUpsertScriptImports(ctx, scriptImports); err != nil {
		return err
	}
	if err := w.repo.BulkUpsertTxTags(ctx, tags); err != nil {
		return err
	}
	return nil
}
