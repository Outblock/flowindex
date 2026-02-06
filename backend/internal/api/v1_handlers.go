package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func (s *Server) handleFlowListBlocks(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	if heightParam := r.URL.Query().Get("height"); heightParam != "" {
		height, err := strconv.ParseUint(heightParam, 10, 64)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid height")
			return
		}
		block, err := s.repo.GetBlockByHeight(r.Context(), height)
		if err != nil {
			writeAPIResponse(w, []interface{}{}, map[string]interface{}{"limit": limit, "offset": offset}, nil)
			return
		}
		writeAPIResponse(w, []interface{}{toFlowBlockOutput(*block)}, map[string]interface{}{"limit": 1, "offset": 0}, nil)
		return
	}

	blocks, err := s.repo.ListBlocks(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(blocks))
	for _, b := range blocks {
		out = append(out, toFlowBlockOutput(b))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetBlock(w http.ResponseWriter, r *http.Request) {
	heightStr := mux.Vars(r)["height"]
	height, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	block, err := s.repo.GetBlockByHeight(r.Context(), height)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "block not found")
		return
	}
	writeAPIResponse(w, []interface{}{toFlowBlockOutput(*block)}, nil, nil)
}

func (s *Server) handleFlowBlockTransactions(w http.ResponseWriter, r *http.Request) {
	heightStr := mux.Vars(r)["height"]
	height, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	includeEvents := strings.ToLower(r.URL.Query().Get("include_events")) == "true"
	txs, err := s.repo.ListTransactionsByBlock(r.Context(), height, includeEvents)
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
		for _, tx := range txs {
			eventsByTx[tx.ID] = tx.Events
		}
	}
	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, eventsByTx[t.ID], contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
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
	events, _ := s.repo.GetEventsByTransactionID(r.Context(), tx.ID)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), []string{tx.ID})
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), []string{tx.ID})
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), []string{tx.ID})
	out := toFlowTransactionOutput(*tx, events, contracts[tx.ID], tags[tx.ID], feesByTx[tx.ID])
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

func (s *Server) handleFlowListAccounts(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	accounts, err := s.repo.ListAccounts(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(accounts))
	for _, a := range accounts {
		out = append(out, map[string]interface{}{
			"address":           a.Address,
			"first_seen_height": a.FirstSeenHeight,
			"last_seen_height":  a.LastSeenHeight,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetAccount(w http.ResponseWriter, r *http.Request) {
	addr := flowsdk.HexToAddress(mux.Vars(r)["address"])
	acc, err := s.client.GetAccount(r.Context(), addr)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "account not found")
		return
	}

	keys := make([]map[string]interface{}, 0, len(acc.Keys))
	for _, key := range acc.Keys {
		keys = append(keys, map[string]interface{}{
			"index":              strconv.FormatUint(uint64(key.Index), 10),
			"key":                strings.TrimPrefix(strings.ToLower(key.PublicKey.String()), "0x"),
			"signatureAlgorithm": key.SigAlgo.String(),
			"hashAlgorithm":      key.HashAlgo.String(),
			"weight":             key.Weight,
			"revoked":            key.Revoked,
		})
	}
	contractNames := make([]string, 0, len(acc.Contracts))
	for name := range acc.Contracts {
		contractNames = append(contractNames, name)
	}

	storageUsed := uint64(0)
	storageCapacity := uint64(0)
	storageAvailable := uint64(0)
	addressNorm := normalizeAddr(acc.Address.Hex())
	if s.repo != nil {
		if snap, err := s.repo.GetAccountStorageSnapshot(r.Context(), addressNorm); err == nil && snap != nil {
			storageUsed = snap.StorageUsed
			storageCapacity = snap.StorageCapacity
			storageAvailable = snap.StorageAvailable
		}
	}
	if storageCapacity == 0 {
		if raw, err := s.executeCadenceScript(r.Context(), cadenceStorageOverviewScript(), []cadence.Value{
			cadence.NewAddress([8]byte(acc.Address)),
		}); err == nil {
			storageUsed, storageCapacity = parseStorageOverview(raw)
			if storageCapacity > storageUsed {
				storageAvailable = storageCapacity - storageUsed
			}
			if s.repo != nil && addressNorm != "" {
				_ = s.repo.UpsertAccountStorageSnapshot(r.Context(), addressNorm, storageUsed, storageCapacity, storageAvailable)
			}
		}
	}
	const bytesPerMB = 1024 * 1024
	storageCapacityMB := float64(storageCapacity) / bytesPerMB
	storageUsedMB := float64(storageUsed) / bytesPerMB
	storageAvailableMB := float64(storageAvailable) / bytesPerMB

	data := map[string]interface{}{
		"address":          formatAddressV1(acc.Address.Hex()),
		"flowBalance":      float64(acc.Balance) / 1e8,
		"contracts":        contractNames,
		"keys":             keys,
		"flowStorage":      storageCapacityMB,
		"storageUsed":      storageUsedMB,
		"storageAvailable": storageAvailableMB,
	}
	writeAPIResponse(w, []interface{}{data}, nil, nil)
}

func (s *Server) handleFlowAccountTransactions(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	includeEvents := strings.ToLower(r.URL.Query().Get("include_events")) == "true"
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	txs, err := s.repo.GetTransactionsByAddress(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Filter by height if provided
	if height != nil {
		filtered := make([]models.Transaction, 0, len(txs))
		for _, t := range txs {
			if t.BlockHeight == *height {
				filtered = append(filtered, t)
			}
		}
		txs = filtered
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

func (s *Server) handleFlowAccountFTTransfers(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, address, "", "", height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, address))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowAccountNFTTransfers(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), true, address, "", "", height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		out = append(out, toNFTTransferOutput(t.TokenTransfer, t.ContractName, address))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleGetCOAMapping(w http.ResponseWriter, r *http.Request) {
	coa := normalizeAddr(mux.Vars(r)["address"])
	if coa == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid coa address")
		return
	}
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	row, err := s.repo.GetFlowAddressByCOA(r.Context(), coa)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeAPIError(w, http.StatusNotFound, "mapping not found")
		return
	}
	out := map[string]interface{}{
		"coa_address":    row.COAAddress,
		"flow_address":   formatAddressV1(row.FlowAddress),
		"transaction_id": row.TransactionID,
		"block_height":   row.BlockHeight,
	}
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

func (s *Server) handleFlowFTTransfers(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	addrFilter := normalizeAddr(r.URL.Query().Get("address"))
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, addrFilter, normalizeTokenParam(r.URL.Query().Get("token")), r.URL.Query().Get("transaction_hash"), height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, addrFilter))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowNFTTransfers(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	addrFilter := normalizeAddr(r.URL.Query().Get("address"))
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), true, addrFilter, normalizeTokenParam(r.URL.Query().Get("nft_type")), r.URL.Query().Get("transaction_hash"), height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		out = append(out, toNFTTransferOutput(t.TokenTransfer, t.ContractName, addrFilter))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowAccountFTHoldings(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByAddress(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(holdings) == 0 {
		contracts, err := s.repo.ListFTTokenContractsByAddress(r.Context(), address, limit, offset)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, c := range contracts {
			holdings = append(holdings, models.FTHolding{
				Address:         address,
				ContractAddress: c,
				Balance:         "0",
			})
		}
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowAccountFTVaults(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	summaries, err := s.repo.ListFTVaultSummariesByAddress(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(summaries)+1)
	hasFlowToken := false
	for _, row := range summaries {
		contractName := row.ContractName
		if contractName == "FlowToken" {
			hasFlowToken = true
		}
		out = append(out, map[string]interface{}{
			"address":  formatAddressV1(address),
			"balance":  row.Balance,
			"path":     vaultPathForContract(contractName),
			"token":    formatTokenVaultIdentifier(row.ContractAddress, contractName),
			"vault_id": 0,
		})
	}
	if !hasFlowToken {
		if acc, err := s.client.GetAccount(r.Context(), flowsdk.HexToAddress(address)); err == nil {
			bal := strconv.FormatFloat(float64(acc.Balance)/1e8, 'f', -1, 64)
			out = append(out, map[string]interface{}{
				"address":  formatAddressV1(address),
				"balance":  bal,
				"path":     "/storage/flowTokenVault",
				"token":    formatTokenVaultIdentifier("1654653399040a61", "FlowToken"),
				"vault_id": 0,
			})
		}
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowAccountNFTCollections(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	collections, err := s.repo.ListNFTCollectionSummariesByOwner(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(collections))
	for _, c := range collections {
		out = append(out, toNFTCollectionOutput(c))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowAccountFTToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	token := normalizeTokenParam(mux.Vars(r)["token"])
	holding, err := s.repo.GetFTHolding(r.Context(), address, token)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if holding == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	out := []interface{}{toVaultOutput(*holding)}
	writeAPIResponse(w, out, nil, nil)
}

func (s *Server) handleFlowAccountFTTokenTransfers(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	token := normalizeTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, address, token, "", height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, address))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowAccountNFTByCollection(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	collection := normalizeTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	items, err := s.repo.ListNFTOwnershipByOwnerAndCollection(r.Context(), address, collection, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, toCombinedNFTDetails(item))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowListFTTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	tokens, err := s.repo.ListFTTokens(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(tokens) == 0 {
		contracts, err := s.repo.ListFTTokenContracts(r.Context(), limit, offset)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, addr := range contracts {
			tokens = append(tokens, models.FTToken{ContractAddress: addr})
		}
	}
	out := make([]map[string]interface{}, 0, len(tokens))
	for _, t := range tokens {
		out = append(out, toFTListOutput(t))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetFTToken(w http.ResponseWriter, r *http.Request) {
	token := normalizeTokenParam(mux.Vars(r)["token"])
	t, err := s.repo.GetFTToken(r.Context(), token)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeAPIResponse(w, []interface{}{toFTListOutput(models.FTToken{ContractAddress: token})}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toFTListOutput(*t)}, nil, nil)
}

func (s *Server) handleFlowFTHoldingsByToken(w http.ResponseWriter, r *http.Request) {
	token := normalizeTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByToken(r.Context(), token, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowTopFTAccounts(w http.ResponseWriter, r *http.Request) {
	token := normalizeTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByToken(r.Context(), token, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowAccountFTHoldingByToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	token := normalizeTokenParam(mux.Vars(r)["token"])
	holding, err := s.repo.GetFTHolding(r.Context(), address, token)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if holding == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toVaultOutput(*holding)}, nil, nil)
}

func (s *Server) handleFlowListNFTCollections(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	collections, err := s.repo.ListNFTCollectionSummaries(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(collections))
	for _, c := range collections {
		out = append(out, toNFTCollectionOutput(c))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetNFTCollection(w http.ResponseWriter, r *http.Request) {
	collection := normalizeTokenParam(mux.Vars(r)["nft_type"])
	summary, err := s.repo.GetNFTCollectionSummary(r.Context(), collection)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if summary == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toNFTCollectionOutput(*summary)}, nil, nil)
}

func (s *Server) handleFlowNFTHoldingsByCollection(w http.ResponseWriter, r *http.Request) {
	collection := normalizeTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	rows, total, err := s.repo.ListNFTOwnerCountsByCollection(r.Context(), collection, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		percentage := 0.0
		if total > 0 {
			percentage = float64(row.Count) / float64(total)
		}
		out = append(out, toNFTHoldingOutput(row.Owner, row.Count, percentage, collection))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowTopNFTAccounts(w http.ResponseWriter, r *http.Request) {
	collection := normalizeTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	rows, total, err := s.repo.ListNFTOwnerCountsByCollection(r.Context(), collection, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		percentage := 0.0
		if total > 0 {
			percentage = float64(row.Count) / float64(total)
		}
		out = append(out, toNFTHoldingOutput(row.Owner, row.Count, percentage, collection))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "total_nfts": total}, nil)
}

func (s *Server) handleFlowNFTItem(w http.ResponseWriter, r *http.Request) {
	collection := normalizeTokenParam(mux.Vars(r)["nft_type"])
	id := mux.Vars(r)["id"]
	item, err := s.repo.GetNFTOwnership(r.Context(), collection, id)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toCombinedNFTDetails(*item)}, nil, nil)
}

func (s *Server) handleFlowListContracts(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	address := normalizeAddr(r.URL.Query().Get("address"))
	identifier := strings.TrimSpace(r.URL.Query().Get("identifier"))
	if identifier != "" {
		contracts, err := s.repo.GetContractByIdentifier(r.Context(), identifier)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		out := make([]map[string]interface{}, 0, len(contracts))
		for _, c := range contracts {
			out = append(out, toContractOutput(c))
		}
		writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
		return
	}
	contracts, err := s.repo.ListContracts(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(contracts))
	for _, c := range contracts {
		out = append(out, toContractOutput(c))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetContract(w http.ResponseWriter, r *http.Request) {
	identifier := mux.Vars(r)["identifier"]
	contracts, err := s.repo.GetContractByIdentifier(r.Context(), identifier)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(contracts))
	for _, c := range contracts {
		out = append(out, toContractOutput(c))
	}
	writeAPIResponse(w, out, nil, nil)
}

func (s *Server) handleFlowGetContractVersion(w http.ResponseWriter, r *http.Request) {
	// TODO: versions are not modeled yet; reuse latest for now.
	s.handleFlowGetContract(w, r)
}

func (s *Server) handleFlowBlockServiceEvents(w http.ResponseWriter, r *http.Request) {
	heightStr := mux.Vars(r)["height"]
	height, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	events, err := s.repo.GetEventsByBlockHeight(r.Context(), height)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0)
	for _, e := range events {
		contractName := strings.ToLower(e.ContractName)
		if contractName == "" {
			parts := strings.SplitN(e.Type, ".", 2)
			if len(parts) > 0 {
				contractName = strings.ToLower(parts[0])
			}
		}
		if contractName != "flow" {
			continue
		}
		var fields interface{}
		_ = json.Unmarshal(e.Payload, &fields)
		out = append(out, map[string]interface{}{
			"block_height": e.BlockHeight,
			"name":         e.EventName,
			"timestamp":    formatTime(e.Timestamp),
			"fields":       fields,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

func (s *Server) handleFlowListEVMTransactions(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	rows, err := s.repo.ListEVMTransactions(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		out = append(out, toEVMTransactionOutput(row))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowListEVMTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	rows, err := s.repo.ListEVMTokenSummaries(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		out = append(out, toEVMTokenOutput(row))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetEVMToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	if len(address) != 40 {
		writeAPIError(w, http.StatusBadRequest, "invalid evm token address")
		return
	}

	rec, err := s.repo.GetEVMTokenSummary(r.Context(), address)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toEVMTokenOutput(*rec)}, nil, nil)
}

func (s *Server) handleFlowGetEVMTransaction(w http.ResponseWriter, r *http.Request) {
	hash := strings.TrimPrefix(strings.ToLower(mux.Vars(r)["hash"]), "0x")
	rec, err := s.repo.GetEVMTransactionByHash(r.Context(), hash)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toEVMTransactionOutput(*rec)}, nil, nil)
}

// Status endpoints
func (s *Server) handleStatusCount(w http.ResponseWriter, r *http.Request) {
	_, maxH, totalBlocks, _ := s.repo.GetBlockRange(r.Context())
	totalTxs, _ := s.repo.GetTotalTransactions(r.Context())
	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"block_count":       totalBlocks,
		"transaction_count": totalTxs,
		"max_height":        maxH,
	}}, nil, nil)
}

func (s *Server) handleStatusStat(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetDailyStats(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, map[string]interface{}{"count": len(stats)}, nil)
}

func (s *Server) handleStatusStatTrend(w http.ResponseWriter, r *http.Request) {
	// reuse daily stats for trend
	s.handleStatusStat(w, r)
}

func (s *Server) handleStatusFlowStat(w http.ResponseWriter, r *http.Request) {
	minH, maxH, totalBlocks, _ := s.repo.GetBlockRange(r.Context())
	totalTxs, _ := s.repo.GetTotalTransactions(r.Context())
	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"min_height":  minH,
		"max_height":  maxH,
		"block_count": totalBlocks,
		"tx_count":    totalTxs,
	}}, nil, nil)
}

func (s *Server) handleStatusEpochStatus(w http.ResponseWriter, r *http.Request) {
	snap, err := s.repo.GetStatusSnapshot(r.Context(), "epoch_status")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	var payload interface{}
	_ = json.Unmarshal(snap.Payload, &payload)
	writeAPIResponse(w, []interface{}{payload}, nil, nil)
}

func (s *Server) handleStatusEpochStat(w http.ResponseWriter, r *http.Request) {
	snap, err := s.repo.GetStatusSnapshot(r.Context(), "epoch_stat")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	var payload interface{}
	_ = json.Unmarshal(snap.Payload, &payload)
	writeAPIResponse(w, []interface{}{payload}, nil, nil)
}

func (s *Server) handleStatusTokenomics(w http.ResponseWriter, r *http.Request) {
	snap, err := s.repo.GetStatusSnapshot(r.Context(), "tokenomics")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	var payload interface{}
	_ = json.Unmarshal(snap.Payload, &payload)
	writeAPIResponse(w, []interface{}{payload}, nil, nil)
}

func (s *Server) handleNotImplemented(w http.ResponseWriter, r *http.Request) {
	writeAPIError(w, http.StatusNotImplemented, "endpoint not implemented yet; see /docs/api for status")
}
