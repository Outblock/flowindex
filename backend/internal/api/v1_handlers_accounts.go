package api

import (
	"net/http"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"

	"github.com/gorilla/mux"
	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func (s *Server) handleFlowListAccounts(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}

	sortBy := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort_by")))
	meta := map[string]interface{}{"limit": limit, "offset": offset}
	if sortBy == "" {
		sortBy = "block_height"
	}
	meta["sort_by"] = sortBy
	if sortBy == "flow_balance" {
		// We do not maintain historical balances in DB yet.
		meta["warning"] = "sort_by=flow_balance is not supported yet; falling back to block_height"
	}

	cursor := height
	if cursor == nil {
		if tip, err := s.repo.GetIndexedTipHeight(r.Context()); err == nil && tip > 0 {
			cursor = &tip
		}
	}
	if cursor != nil {
		meta["height"] = *cursor
	}

	accounts, err := s.repo.ListAccountsForAPI(r.Context(), cursor, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	const bytesPerMB = 1024 * 1024
	out := make([]map[string]interface{}, 0, len(accounts))
	for _, a := range accounts {
		out = append(out, map[string]interface{}{
			"address":           formatAddressV1(a.Address),
			"creator":           "",
			"data":              map[string]interface{}{},
			"find_name":         "",
			"flow_balance":      0,
			"flow_storage":      float64(a.StorageCapacity) / bytesPerMB,
			"storage_used":      float64(a.StorageUsed) / bytesPerMB,
			"storage_available": float64(a.StorageAvailable) / bytesPerMB,
			"height":            a.LastSeenHeight,
			"timestamp":         formatTime(a.UpdatedAt),
			"transaction_hash":  "",
		})
	}
	if total, err := s.repo.GetTotalAddresses(r.Context()); err == nil && total > 0 {
		meta["count"] = total
	} else {
		meta["count"] = len(out)
	}
	writeAPIResponse(w, out, meta, nil)
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
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, address, "", "", "", height, limit, offset)
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
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), true, address, "", "", "", height, limit, offset)
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

func (s *Server) handleFlowAccountFTHoldings(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByAddress(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	total := int64(0)
	if len(holdings) > 0 {
		if t, err := s.repo.CountFTHoldingsByAddress(r.Context(), address); err == nil {
			total = t
		} else {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
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
				ContractAddress: c.Address,
				ContractName:    c.Name,
				Balance:         "0",
			})
		}
		total = int64(len(holdings))
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
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
	total, err := s.repo.CountNFTCollectionSummariesByOwner(r.Context(), address)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(collections))
	for _, c := range collections {
		out = append(out, toNFTCollectionOutput(c))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowAccountFTToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	tokenAddr, tokenName := parseTokenParam(mux.Vars(r)["token"])
	holding, err := s.repo.GetFTHolding(r.Context(), address, tokenAddr, tokenName)
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
	tokenAddr, tokenName := parseTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, address, tokenAddr, tokenName, "", height, limit, offset)
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
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	items, err := s.repo.ListNFTOwnershipByOwnerAndCollection(r.Context(), address, collectionAddr, collectionName, limit, offset)
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
