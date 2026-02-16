package api

import (
	"net/http"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

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
	eventsByTx := make(map[string][]models.Event)
	if includeEvents {
		events, _ := s.repo.GetEventsByTransactionIDs(r.Context(), txIDs)
		for _, e := range events {
			eventsByTx[e.TransactionID] = append(eventsByTx[e.TransactionID], e)
		}
	}
	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, eventsByTx[t.ID], contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetTransaction(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	tx, err := s.repo.GetTransactionByID(r.Context(), id)
	if err != nil || tx == nil {
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

	// Enrich: script template classification
	if templates, err := s.repo.GetScriptTemplatesByTxIDs(r.Context(), []string{tx.ID}); err == nil {
		enrichWithTemplates([]map[string]interface{}{out}, templates)
	}

	s.enrichTransactionOutput(r, out, tx)

	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

// enrichTransactionOutput adds FT transfers, NFT transfers, and DeFi events to the output map.
func (s *Server) enrichTransactionOutput(r *http.Request, out map[string]interface{}, tx *models.Transaction) {
	// Enrich: FT transfers with token metadata
	ftTransfers, _ := s.repo.GetFTTransfersByTransactionID(r.Context(), tx.ID)
	if len(ftTransfers) > 0 {
		tokenIDSet := make(map[string]bool)
		for _, ft := range ftTransfers {
			tokenIDSet[ft.Token] = true
		}
		tokenIDs := make([]string, 0, len(tokenIDSet))
		for id := range tokenIDSet {
			tokenIDs = append(tokenIDs, id)
		}
		ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), tokenIDs)

		addrSet := make(map[string]bool)
		for _, ft := range ftTransfers {
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

		transfersOut := make([]map[string]interface{}, 0, len(ftTransfers))
		for _, ft := range ftTransfers {
			item := map[string]interface{}{
				"token":        ft.Token,
				"from_address": formatAddressV1(ft.FromAddress),
				"to_address":   formatAddressV1(ft.ToAddress),
				"amount":       ft.Amount,
				"event_index":  ft.EventIndex,
			}
			if meta, ok := ftMeta[ft.Token]; ok {
				item["token_name"] = meta.Name
				item["token_symbol"] = meta.Symbol
				item["token_logo"] = meta.Logo
				item["token_decimals"] = meta.Decimals
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
	}

	// Enrich: NFT transfers with item metadata
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

		collPublicPaths := make(map[string]string)
		for _, id := range collIDs {
			parts := strings.SplitN(id, ".", 3)
			if len(parts) >= 3 {
				addr := strings.TrimPrefix(parts[1], "0x")
				name := parts[2]
				if pp, err := s.repo.GetCollectionPublicPath(r.Context(), addr, name); err == nil && pp != "" {
					collPublicPaths[id] = pp
				}
			}
		}

		itemKeys := make([]repository.NFTItemKey, 0, len(nftTransfers))
		for _, nt := range nftTransfers {
			parts := strings.SplitN(nt.Token, ".", 3)
			if len(parts) >= 3 && nt.TokenID != "" {
				itemKeys = append(itemKeys, repository.NFTItemKey{
					ContractAddress: strings.TrimPrefix(parts[1], "0x"),
					ContractName:    parts[2],
					NFTID:           nt.TokenID,
				})
			}
		}
		itemMeta, _ := s.repo.GetNFTItemsBatch(r.Context(), itemKeys)

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
			if pp, ok := collPublicPaths[nt.Token]; ok {
				item["public_path"] = pp
			}
			parts := strings.SplitN(nt.Token, ".", 3)
			if len(parts) >= 3 && nt.TokenID != "" {
				key := repository.NFTItemKey{
					ContractAddress: strings.TrimPrefix(parts[1], "0x"),
					ContractName:    parts[2],
					NFTID:           nt.TokenID,
				}
				if nftItem, ok := itemMeta[key]; ok {
					item["nft_name"] = nftItem.Name
					item["nft_thumbnail"] = nftItem.Thumbnail
					item["nft_rarity"] = nftItem.RarityDescription
				}
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
