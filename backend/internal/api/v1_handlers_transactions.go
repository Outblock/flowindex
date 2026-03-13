package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
	cadjson "github.com/onflow/cadence/encoding/json"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func (s *Server) buildCanonicalTransferSummariesByTxRefs(ctx context.Context, refs []repository.TxRef, address string) (map[string]repository.TransferSummary, error) {
	if len(refs) == 0 {
		return map[string]repository.TransferSummary{}, nil
	}

	ftTransfersByTx, err := s.repo.GetFTTransfersByTxRefs(ctx, refs)
	if err != nil {
		return nil, err
	}
	evmExecsByTx, err := s.repo.GetEVMTransactionsByCadenceTxRefs(ctx, refs)
	if err != nil {
		return nil, err
	}

	coaAddress := ""
	if address != "" {
		if coa, coaErr := s.repo.GetCOAByFlowAddress(ctx, address); coaErr == nil && coa != nil {
			coaAddress = coa.COAAddress
		}
	}

	out := make(map[string]repository.TransferSummary, len(refs))
	for _, ref := range refs {
		transfers := canonicalizeFTTransfers(ftTransfersByTx[ref.ID], evmExecsByTx[ref.ID])
		if len(transfers) == 0 {
			continue
		}
		summary := buildCanonicalTransferSummaryForContext(transfers, address, coaAddress)
		if len(summary.FT) == 0 {
			continue
		}
		out[ref.ID] = summary
	}
	return out, nil
}

func (s *Server) handleFlowListTransactions(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	includeEvents := strings.ToLower(r.URL.Query().Get("include_events")) == "true"
	f := repository.TransactionFilter{
		Height:        height,
		Payer:         normalizeAddr(r.URL.Query().Get("payer")),
		Proposer:      normalizeAddr(r.URL.Query().Get("proposer")),
		Authorizer:    normalizeAddr(r.URL.Query().Get("authorizers")),
		Status:        strings.TrimSpace(r.URL.Query().Get("status")),
		Limit:         limit,
		Offset:        offset,
		IncludeEvents: includeEvents,
	}
	txs, err := s.repo.ListTransactionsFiltered(r.Context(), f)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	txIDs := collectTxIDs(txs)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), txIDs)
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), txIDs)
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), txIDs)
	txRefs := collectTxRefs(txs)
	eventsByTx := make(map[string][]models.Event)
	if includeEvents {
		events, _ := s.repo.GetEventsByTxRefs(r.Context(), txRefs)
		for _, e := range events {
			eventsByTx[e.TransactionID] = append(eventsByTx[e.TransactionID], e)
		}
	}

	// Fetch transfer summaries for expand preview
	transferSummaries, tsErr := s.repo.GetTransferSummariesByTxRefs(r.Context(), txRefs, "")
	if tsErr != nil {
		log.Printf("[WARN] GetTransferSummariesByTxRefs (list) failed refs=%d: %v", len(txRefs), tsErr)
	}
	canonicalTransferSummaries, ctsErr := s.buildCanonicalTransferSummariesByTxRefs(r.Context(), txRefs, "")
	if ctsErr != nil {
		log.Printf("[WARN] buildCanonicalTransferSummariesByTxRefs (list) failed refs=%d: %v", len(txRefs), ctsErr)
	}
	ftIDs, nftIDs := collectTokenIdentifiers(transferSummaries)
	ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)
	nftMeta, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), nftIDs)

	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		ts := transferSummaries[t.ID]
		ftPrices := s.buildFTPrices(ftMeta, t.Timestamp)
		o := toFlowTransactionOutputWithTransfers(t, eventsByTx[t.ID], contracts[t.ID], tags[t.ID], feesByTx[t.ID], &ts, ftMeta, nftMeta, ftPrices)
		if fee := feesByTx[t.ID]; fee > 0 {
			if p, ok := s.priceCache.GetPriceAt("FLOW", t.Timestamp); ok {
				o["fee_usd"] = fee * p
			}
		}
		if canonical, ok := canonicalTransferSummaries[t.ID]; ok && len(canonical.FT) > 0 {
			o["canonical_transfer_summary"] = toTransferSummaryOutput(canonical, ftMeta, map[string]repository.TokenMetadataInfo{}, ftPrices)
		}
		out = append(out, o)
	}

	// Enrich with script template classification.
	// script_hash is already in each tx from the list query, so we skip the
	// expensive raw.transactions re-query and go straight to script_templates + script_imports.
	uniqueHashes := collectUniqueScriptHashes(txs)
	if len(uniqueHashes) > 0 {
		if templates, err := s.repo.GetScriptTemplatesByHashes(r.Context(), uniqueHashes); err == nil {
			enrichWithTemplates(out, templates)
		}
		if imports, err := s.repo.GetScriptImportsByHashes(r.Context(), uniqueHashes); err == nil {
			enrichWithScriptImports(out, imports)
		}
	}

	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetTransaction(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	tx, err := s.repo.GetTransactionByID(r.Context(), id)
	if err != nil || tx == nil {
		// DB miss — try RPC fallback
		if s.client != nil {
			if out, ok := s.fetchTransactionFromRPC(r.Context(), id); ok {
				writeAPIResponse(w, []interface{}{out}, nil, nil)
				return
			}
		}
		writeAPIError(w, http.StatusNotFound, "transaction not found")
		return
	}

	lite := strings.ToLower(r.URL.Query().Get("lite")) == "true"

	// Always fetch: events + tags (fast, needed for header/activity type)
	events, _ := s.repo.GetEventsByTransactionID(r.Context(), tx.ID)
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), []string{tx.ID})

	if lite {
		// Lite mode: only base tx + events + tags — skip all enrichments
		out := toFlowTransactionOutput(*tx, events, nil, tags[tx.ID], 0)
		out["ft_transfers"] = []interface{}{}
		out["nft_transfers"] = []interface{}{}
		out["defi_events"] = []interface{}{}
		out["evm_executions"] = []interface{}{}
		out["lite"] = true
		writeAPIResponse(w, []interface{}{out}, nil, nil)
		return
	}

	// Full mode (default): all queries
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), []string{tx.ID})
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), []string{tx.ID})
	var evmExecs []repository.EVMTransactionRecord
	if tx.IsEVM {
		evmExecs, _ = s.repo.GetEVMTransactionsByCadenceTx(r.Context(), tx.ID, tx.BlockHeight)
	}
	out := toFlowTransactionOutput(*tx, events, contracts[tx.ID], tags[tx.ID], feesByTx[tx.ID], evmExecs)
	if fee := feesByTx[tx.ID]; fee > 0 {
		if p, ok := s.priceCache.GetPriceAt("FLOW", tx.Timestamp); ok {
			out["fee_usd"] = fee * p
		}
	}

	// Enrich: script template classification using script_hash from the tx record directly
	if tx.ScriptHash != "" {
		if templates, err := s.repo.GetScriptTemplatesByHashes(r.Context(), []string{tx.ScriptHash}); err == nil {
			enrichWithTemplates([]map[string]interface{}{out}, templates)
		}
		if imports, err := s.repo.GetScriptImportsByHashes(r.Context(), []string{tx.ScriptHash}); err == nil {
			enrichWithScriptImports([]map[string]interface{}{out}, imports)
		}
	}

	s.enrichTransactionOutput(r, out, tx, evmExecs)

	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

// fetchTransactionFromRPC fetches a transaction and its result from the Flow access node.
// Returns the formatted output and true on success, or nil and false if the RPC call fails.
func (s *Server) fetchTransactionFromRPC(ctx context.Context, txID string) (map[string]interface{}, bool) {
	// Normalize: strip 0x prefix if present
	cleanID := strings.TrimPrefix(strings.ToLower(txID), "0x")
	if len(cleanID) != 64 {
		return nil, false
	}
	if _, err := hex.DecodeString(cleanID); err != nil {
		return nil, false
	}

	flowID := flowsdk.HexToID(cleanID)

	rpcCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	tx, err := s.client.GetTransaction(rpcCtx, flowID)
	if err != nil || tx == nil {
		return nil, false
	}

	result, err := s.client.GetTransactionResult(rpcCtx, flowID)
	if err != nil {
		result = nil // proceed with tx body only
	}

	out := rpcTransactionToOutput(tx, result)
	return out, true
}

// rpcTransactionToOutput converts a Flow SDK Transaction + TransactionResult into the
// same JSON shape as toFlowTransactionOutput, but without DB-derived enrichments.
func rpcTransactionToOutput(tx *flowsdk.Transaction, result *flowsdk.TransactionResult) map[string]interface{} {
	txID := tx.ID().Hex()

	// Build authorizers list
	authorizers := make([]string, 0, len(tx.Authorizers))
	for _, a := range tx.Authorizers {
		authorizers = append(authorizers, formatAddressV1(a.Hex()))
	}

	// Build arguments as JSON array
	args := make([]json.RawMessage, 0, len(tx.Arguments))
	for _, arg := range tx.Arguments {
		if len(arg) > 0 {
			args = append(args, json.RawMessage(arg))
		}
	}

	status := "UNKNOWN"
	errorMsg := ""
	var gasUsed uint64
	var blockHeight uint64
	var eventsOut []map[string]interface{}

	if result != nil {
		status = result.Status.String()
		blockHeight = result.BlockHeight
		gasUsed = result.ComputationUsage
		if result.Error != nil {
			errorMsg = result.Error.Error()
		}

		eventsOut = make([]map[string]interface{}, 0, len(result.Events))
		for _, e := range result.Events {
			ev := map[string]interface{}{
				"type":         e.Type,
				"transaction":  e.TransactionID.Hex(),
				"event_index":  e.EventIndex,
				"block_height": blockHeight,
			}
			// Encode event value as JSON-CDC
			if e.Value.EventType != nil {
				b, err := cadjson.Encode(e.Value)
				if err == nil {
					ev["payload"] = json.RawMessage(b)
				}
			}
			eventsOut = append(eventsOut, ev)
		}
	}

	if eventsOut == nil {
		eventsOut = []map[string]interface{}{}
	}

	out := map[string]interface{}{
		"id":                       txID,
		"block_height":             blockHeight,
		"transaction_index":        0,
		"timestamp":                "",
		"payer":                    formatAddressV1(tx.Payer.Hex()),
		"proposer":                 formatAddressV1(tx.ProposalKey.Address.Hex()),
		"proposer_key_index":       tx.ProposalKey.KeyIndex,
		"proposer_sequence_number": tx.ProposalKey.SequenceNumber,
		"authorizers":              authorizers,
		"status":                   status,
		"error":                    errorMsg,
		"gas_used":                 gasUsed,
		"event_count":              len(eventsOut),
		"events":                   eventsOut,
		"script":                   string(tx.Script),
		"contract_imports":         []string{},
		"contract_outputs":         []string{},
		"tags":                     []string{},
		"fee":                      0,
		"fee_usd":                  0.0,
		"ft_transfers":             []interface{}{},
		"nft_transfers":            []interface{}{},
		"defi_events":              []interface{}{},
		"evm_executions":           []interface{}{},
		"from_rpc":                 true,
	}

	if len(args) > 0 {
		out["arguments"] = args
	}

	return out
}

// enrichTransactionOutput adds FT transfers, NFT transfers, and DeFi events to the output map.
func (s *Server) enrichTransactionOutput(r *http.Request, out map[string]interface{}, tx *models.Transaction, evmExecs []repository.EVMTransactionRecord) {
	// Enrich: FT transfers with token metadata
	ftTransfers, _ := s.repo.GetFTTransfersByTransactionID(r.Context(), tx.ID)
	canonicalFTTransfers := canonicalizeFTTransfers(ftTransfers, evmExecs)
	ftMeta := map[string]repository.TokenMetadataInfo{}
	if len(canonicalFTTransfers) > 0 {
		tokenIDSet := make(map[string]bool)
		for _, ft := range canonicalFTTransfers {
			tokenIDSet[ft.Token] = true
		}
		tokenIDs := make([]string, 0, len(tokenIDSet))
		for id := range tokenIDSet {
			tokenIDs = append(tokenIDs, id)
		}
		ftMeta, _ = s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), tokenIDs)

		addrSet := make(map[string]bool)
		for _, ft := range canonicalFTTransfers {
			if ft.FromAddress != "" {
				addrSet[ft.FromAddress] = true
			}
			if ft.ToAddress != "" {
				addrSet[ft.ToAddress] = true
			}
		}
		addrs := make([]string, 0, len(addrSet))
		for a := range addrSet {
			addrs = append(addrs, a)
		}
		coaMap, _ := s.repo.CheckAddressesAreCOA(r.Context(), addrs)

		transfersOut := make([]map[string]interface{}, 0, len(canonicalFTTransfers))
		for _, ft := range canonicalFTTransfers {
			item := map[string]interface{}{
				"token":         ft.Token,
				"from_address":  formatAddressV1(ft.FromAddress),
				"to_address":    formatAddressV1(ft.ToAddress),
				"amount":        ft.Amount,
				"event_index":   ft.EventIndex,
				"transfer_type": ft.TransferType,
			}
			var usdPrice float64
			if meta, ok := ftMeta[ft.Token]; ok {
				item["token_name"] = meta.Name
				item["token_symbol"] = meta.Symbol
				item["token_logo"] = meta.Logo
				item["token_decimals"] = meta.Decimals
				if meta.MarketSymbol != "" {
					usdPrice, _ = s.priceCache.GetPriceAt(meta.MarketSymbol, tx.Timestamp)
				}
			}
			// Fallback: FlowToken always has a price even without metadata
			if usdPrice == 0 && ft.ContractName == "FlowToken" {
				usdPrice, _ = s.priceCache.GetPriceAt("FLOW", tx.Timestamp)
			}
			if usdPrice > 0 {
				item["usd_value"] = parseFloatOrZero(ft.Amount) * usdPrice
				item["approx_usd_price"] = usdPrice
			}
			if ft.EVMToAddress != "" {
				item["evm_to_address"] = formatAddressV1(ft.EVMToAddress)
			}
			if ft.EVMFromAddress != "" {
				item["evm_from_address"] = formatAddressV1(ft.EVMFromAddress)
			}
			if ft.IsCrossVM {
				item["is_cross_vm"] = true
			}
			fromIsCOA := false
			toIsCOA := false
			if ft.FromAddress != "" {
				if flowAddr, ok := coaMap[ft.FromAddress]; ok {
					fromIsCOA = true
					item["from_coa_flow_address"] = formatAddressV1(flowAddr)
				}
			}
			if ft.ToAddress != "" {
				if flowAddr, ok := coaMap[ft.ToAddress]; ok {
					toIsCOA = true
					item["to_coa_flow_address"] = formatAddressV1(flowAddr)
				}
			}
			if fromIsCOA || toIsCOA {
				item["is_cross_vm"] = true
			}
			transfersOut = append(transfersOut, item)
		}
		out["ft_transfers"] = transfersOut

		ftPrices := s.buildFTPrices(ftMeta, tx.Timestamp)
		summary := buildCanonicalTransferSummary(canonicalFTTransfers)
		summaryOutput := toTransferSummaryOutput(summary, ftMeta, map[string]repository.TokenMetadataInfo{}, ftPrices)
		out["transfer_summary"] = summaryOutput
		out["canonical_transfer_summary"] = summaryOutput
	}

	// Enrich: NFT transfers (lightweight — no public path or item metadata lookups,
	// frontend can query NFT details via Cadence script when needed)
	nftTransfers, _ := s.repo.GetNFTTransfersByTransactionID(r.Context(), tx.ID)
	if len(nftTransfers) > 0 {
		collIDSet := make(map[string]bool)
		for _, nt := range nftTransfers {
			collIDSet[nt.Token] = true
		}
		collIDs := make([]string, 0, len(collIDSet))
		for id := range collIDSet {
			collIDs = append(collIDs, id)
		}
		nftCollMeta, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), collIDs)

		nftAddrSet := make(map[string]bool)
		for _, nt := range nftTransfers {
			if nt.FromAddress != "" {
				nftAddrSet[nt.FromAddress] = true
			}
			if nt.ToAddress != "" {
				nftAddrSet[nt.ToAddress] = true
			}
		}
		nftAddrs := make([]string, 0, len(nftAddrSet))
		for a := range nftAddrSet {
			nftAddrs = append(nftAddrs, a)
		}
		nftCOAMap, _ := s.repo.CheckAddressesAreCOA(r.Context(), nftAddrs)

		nftTransfersOut := make([]map[string]interface{}, 0, len(nftTransfers))
		for _, nt := range nftTransfers {
			item := map[string]interface{}{
				"token":        nt.Token,
				"from_address": formatAddressV1(nt.FromAddress),
				"to_address":   formatAddressV1(nt.ToAddress),
				"token_id":     nt.TokenID,
				"event_index":  nt.EventIndex,
			}
			if meta, ok := nftCollMeta[nt.Token]; ok {
				item["collection_name"] = meta.Name
				item["collection_logo"] = meta.Logo
			}
			if nt.FromAddress != "" {
				if flowAddr, ok := nftCOAMap[nt.FromAddress]; ok {
					item["from_coa_flow_address"] = formatAddressV1(flowAddr)
					item["is_cross_vm"] = true
				}
			}
			if nt.ToAddress != "" {
				if flowAddr, ok := nftCOAMap[nt.ToAddress]; ok {
					item["to_coa_flow_address"] = formatAddressV1(flowAddr)
					item["is_cross_vm"] = true
				}
			}
			nftTransfersOut = append(nftTransfersOut, item)
		}
		out["nft_transfers"] = nftTransfersOut
	}
	if _, ok := out["transfer_summary"]; !ok {
		out["transfer_summary"] = map[string]interface{}{"ft": []interface{}{}, "nft": []interface{}{}}
	}
	if _, ok := out["canonical_transfer_summary"]; !ok {
		out["canonical_transfer_summary"] = map[string]interface{}{"ft": []interface{}{}, "nft": []interface{}{}}
	}

	// Enrich: DeFi swap events
	defiEvents, defiPairs, _ := s.repo.GetDefiEventsByTransactionID(r.Context(), tx.ID)
	if len(defiEvents) > 0 {
		assetIDSet := make(map[string]bool)
		for _, p := range defiPairs {
			if p.Asset0ID != "" {
				assetIDSet[p.Asset0ID] = true
			}
			if p.Asset1ID != "" {
				assetIDSet[p.Asset1ID] = true
			}
		}
		assetIDs := make([]string, 0, len(assetIDSet))
		for id := range assetIDSet {
			assetIDs = append(assetIDs, id)
		}
		assetMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), assetIDs)

		swapEvents := make([]map[string]interface{}, 0, len(defiEvents))
		for _, e := range defiEvents {
			pair := defiPairs[e.PairID]
			item := map[string]interface{}{
				"event_type":    e.EventType,
				"pair_id":       e.PairID,
				"dex":           pair.DexKey,
				"asset0_id":     pair.Asset0ID,
				"asset1_id":     pair.Asset1ID,
				"asset0_symbol": pair.Asset0Symbol,
				"asset1_symbol": pair.Asset1Symbol,
				"asset0_in":     e.Asset0In,
				"asset0_out":    e.Asset0Out,
				"asset1_in":     e.Asset1In,
				"asset1_out":    e.Asset1Out,
			}
			if meta, ok := assetMeta[pair.Asset0ID]; ok {
				item["asset0_name"] = meta.Name
				item["asset0_logo"] = meta.Logo
			}
			if meta, ok := assetMeta[pair.Asset1ID]; ok {
				item["asset1_name"] = meta.Name
				item["asset1_logo"] = meta.Logo
			}
			swapEvents = append(swapEvents, item)
		}
		out["defi_events"] = swapEvents
	}
}
