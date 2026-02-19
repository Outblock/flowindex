package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
	"github.com/onflow/cadence"
	cadjson "github.com/onflow/cadence/encoding/json"
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
	// Normalize sort_by to internal names
	repoSort := "recent"
	switch sortBy {
	case "tx_count":
		repoSort = "tx_count"
	case "storage":
		repoSort = "storage"
	case "flow_balance":
		meta["warning"] = "sort_by=flow_balance is not supported yet; falling back to block_height"
	}
	if sortBy == "" {
		sortBy = "block_height"
	}
	meta["sort_by"] = sortBy

	cursor := height
	if cursor == nil {
		if tip, err := s.repo.GetIndexedTipHeight(r.Context()); err == nil && tip > 0 {
			cursor = &tip
		}
	}
	if cursor != nil {
		meta["height"] = *cursor
	}

	accounts, err := s.repo.ListAccountsForAPI(r.Context(), cursor, limit, offset, repoSort)
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
			"tx_count":          a.TxCount,
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
		log.Printf("[WARN] GetAccount(%s) RPC error: %v", addr.Hex(), err)
		// Fallback: build a degraded account response from DB data
		data := s.buildAccountFallback(r.Context(), addr)
		if data != nil {
			writeAPIResponse(w, []interface{}{data}, nil, nil)
			return
		}
		writeAPIError(w, http.StatusNotFound, "account not found")
		return
	}

	keys := make([]map[string]interface{}, 0, len(acc.Keys))
	var dbKeys []models.AccountKey
	addrHex := normalizeAddr(acc.Address.Hex())
	for _, key := range acc.Keys {
		pubKeyHex := strings.TrimPrefix(strings.ToLower(key.PublicKey.String()), "0x")
		keys = append(keys, map[string]interface{}{
			"index":              strconv.FormatUint(uint64(key.Index), 10),
			"key":                pubKeyHex,
			"signatureAlgorithm": key.SigAlgo.String(),
			"hashAlgorithm":      key.HashAlgo.String(),
			"weight":             key.Weight,
			"revoked":            key.Revoked,
		})
		dbKeys = append(dbKeys, models.AccountKey{
			Address:          addrHex,
			KeyIndex:         int(key.Index),
			PublicKey:        pubKeyHex,
			SigningAlgorithm: sigAlgoToNum(key.SigAlgo.String()),
			HashingAlgorithm: hashAlgoToNum(key.HashAlgo.String()),
			Weight:           key.Weight,
			Revoked:          key.Revoked,
		})
	}
	// Opportunistically upsert keys so public-key search works for recently-created accounts
	if s.repo != nil && len(dbKeys) > 0 {
		_ = s.repo.UpsertAccountKeys(r.Context(), dbKeys)
	}
	contractNames := make([]string, 0, len(acc.Contracts))
	for name := range acc.Contracts {
		contractNames = append(contractNames, name)
	}
	// Opportunistically upsert contracts so contract search works
	if s.repo != nil && len(contractNames) > 0 {
		contracts := make([]models.SmartContract, 0, len(contractNames))
		for _, name := range contractNames {
			contracts = append(contracts, models.SmartContract{
				Address: addrHex,
				Name:    name,
			})
		}
		_ = s.repo.UpsertSmartContracts(r.Context(), contracts)
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

// buildAccountFallback returns a degraded account response from DB when RPC fails.
// Returns nil if we have no data at all for this address.
func (s *Server) buildAccountFallback(ctx context.Context, addr flowsdk.Address) map[string]interface{} {
	if s.repo == nil {
		return nil
	}
	addressNorm := normalizeAddr(addr.Hex())

	// Check if we have any indexed data for this address (transactions, keys, etc.)
	hasTxs := false
	if count, err := s.repo.CountAddressTransactions(ctx, addressNorm); err == nil && count > 0 {
		hasTxs = true
	}

	// Also check account_keys
	dbKeys, _ := s.repo.GetAccountKeysByAddress(ctx, addressNorm)
	keys := make([]map[string]interface{}, 0, len(dbKeys))
	for _, k := range dbKeys {
		keys = append(keys, map[string]interface{}{
			"index":              strconv.Itoa(k.KeyIndex),
			"key":                k.PublicKey,
			"signatureAlgorithm": numToSigAlgo(k.SigningAlgorithm),
			"hashAlgorithm":      numToHashAlgo(k.HashingAlgorithm),
			"weight":             k.Weight,
			"revoked":            k.Revoked,
		})
	}

	if !hasTxs && len(keys) == 0 {
		return nil // no data at all
	}

	// Build degraded response
	storageUsed := uint64(0)
	storageCapacity := uint64(0)
	storageAvailable := uint64(0)
	if snap, err := s.repo.GetAccountStorageSnapshot(ctx, addressNorm); err == nil && snap != nil {
		storageUsed = snap.StorageUsed
		storageCapacity = snap.StorageCapacity
		storageAvailable = snap.StorageAvailable
	}
	const bytesPerMB = 1024 * 1024

	log.Printf("[INFO] Serving fallback account data for %s (RPC unavailable)", addr.Hex())

	return map[string]interface{}{
		"address":          formatAddressV1(addr.Hex()),
		"flowBalance":      float64(-1), // -1 signals "unavailable" to frontend
		"contracts":        []string{},
		"keys":             keys,
		"flowStorage":      float64(storageCapacity) / bytesPerMB,
		"storageUsed":      float64(storageUsed) / bytesPerMB,
		"storageAvailable": float64(storageAvailable) / bytesPerMB,
		"_rpcUnavailable":  true,
	}
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
	// The repo fetches limit+1 rows; trim to detect hasMore.
	hasMore := len(txs) > limit
	if hasMore {
		txs = txs[:limit]
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
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), txIDs)
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), txIDs)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), txIDs)
	eventsByTx := make(map[string][]models.Event)
	if includeEvents {
		events, _ := s.repo.GetEventsByTransactionIDs(r.Context(), txIDs)
		for _, e := range events {
			eventsByTx[e.TransactionID] = append(eventsByTx[e.TransactionID], e)
		}
	}

	// Fetch transfer summaries for expand preview
	transferSummaries, tsErr := s.repo.GetTransferSummariesByTxIDs(r.Context(), txIDs, address)
	if tsErr != nil {
		log.Printf("[WARN] GetTransferSummariesByTxIDs failed for address=%s txIDs=%d: %v", address, len(txIDs), tsErr)
	}
	ftIDs, nftIDs := collectTokenIdentifiers(transferSummaries)
	ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)
	nftMeta, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), nftIDs)

	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		ts := transferSummaries[t.ID]
		out = append(out, toFlowTransactionOutputWithTransfers(t, eventsByTx[t.ID], contracts[t.ID], tags[t.ID], feesByTx[t.ID], &ts, ftMeta, nftMeta))
	}
	meta := map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}
	// Include pre-computed total from address_stats if available.
	if total, err := s.repo.GetAddressTxCount(r.Context(), address); err == nil && total > 0 {
		meta["total"] = total
	}
	writeAPIResponse(w, out, meta, nil)
}

func (s *Server) handleFlowAccountFTTransfers(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	transfers, hasMore, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, address, "", "", "", height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Batch lookup token metadata.
	ftIDs := collectTransferTokenIDs(transfers, false)
	ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		id := formatTokenVaultIdentifier(t.TokenContractAddress, t.ContractName)
		var m *repository.TokenMetadataInfo
		if meta, ok := ftMeta[id]; ok {
			m = &meta
		}
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, address, m))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

func (s *Server) handleFlowAccountNFTTransfers(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	transfers, hasMore, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), true, address, "", "", "", height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Batch lookup collection metadata.
	nftIDs := collectTransferTokenIDs(transfers, true)
	nftMeta, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), nftIDs)
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		id := formatTokenIdentifier(t.TokenContractAddress, t.ContractName)
		var m *repository.TokenMetadataInfo
		if meta, ok := nftMeta[id]; ok {
			m = &meta
		}
		out = append(out, toNFTTransferOutput(t.TokenTransfer, t.ContractName, address, m))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
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

func (s *Server) handleFlowSearchByPublicKey(w http.ResponseWriter, r *http.Request) {
	publicKey := mux.Vars(r)["publicKey"]
	if publicKey == "" {
		writeAPIError(w, http.StatusBadRequest, "publicKey is required")
		return
	}
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	limit, offset := parseLimitOffset(r)
	keys, hasMore, err := s.repo.ListAccountsByPublicKey(r.Context(), publicKey, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(keys))
	for _, k := range keys {
		out = append(out, map[string]interface{}{
			"address":            formatAddressV1(k.Address),
			"key_index":          k.KeyIndex,
			"public_key":         k.PublicKey,
			"signing_algorithm":  k.SigningAlgorithm,
			"hashing_algorithm":  k.HashingAlgorithm,
			"weight":             k.Weight,
			"revoked":            k.Revoked,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

func (s *Server) handleFlowAccountFTHoldings(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])

	// Primary: query on-chain via Cadence script for accurate real-time balances.
	holdings, err := s.queryFTHoldingsOnChain(r.Context(), address)
	if err != nil {
		log.Printf("on-chain FT holdings query failed for %s: %v, falling back to DB", address, err)
		// Fallback to DB if chain query fails.
		s.handleFlowAccountFTHoldingsFromDB(w, r, address)
		return
	}

	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		token := "A." + h.ContractAddress + "." + h.ContractName
		out = append(out, map[string]interface{}{
			"address":    formatAddressV1(address),
			"token":      token,
			"balance":    parseFloatOrZero(h.Balance),
			"percentage": 0,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

// handleFlowAccountFTHoldingsFromDB is the DB fallback when on-chain query fails.
func (s *Server) handleFlowAccountFTHoldingsFromDB(w http.ResponseWriter, r *http.Request, address string) {
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
	transfers, hasMore, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, address, tokenAddr, tokenName, "", height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ftIDs3 := collectTransferTokenIDs(transfers, false)
	ftMeta3, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs3)
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		id := formatTokenVaultIdentifier(t.TokenContractAddress, t.ContractName)
		var m *repository.TokenMetadataInfo
		if meta, ok := ftMeta3[id]; ok {
			m = &meta
		}
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, address, m))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

func (s *Server) handleFlowAccountScheduledTransactions(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	limit, offset := parseLimitOffset(r)
	txs, err := s.repo.GetScheduledTransactionsByAddress(r.Context(), address, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	txIDs := collectTxIDs(txs)
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), txIDs)
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), txIDs)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), txIDs)

	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, nil, contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowScheduledTransactions(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	txs, err := s.repo.GetScheduledTransactions(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	txIDs := collectTxIDs(txs)
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), txIDs)
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), txIDs)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), txIDs)

	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, nil, contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
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

func (s *Server) executeCadenceScript(ctx context.Context, script string, args []cadence.Value) ([]byte, error) {
	ctxExec, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	v, err := s.client.ExecuteScriptAtLatestBlock(ctxExec, []byte(script), args)
	if err != nil {
		return nil, fmt.Errorf("failed to execute script: %w", err)
	}

	b, err := cadjson.Encode(v)
	if err != nil {
		return nil, fmt.Errorf("failed to encode cadence value: %w", err)
	}
	return b, nil
}

func cadenceStorageOverviewScript() string {
	return `
		access(all) fun main(address: Address): {String: AnyStruct} {
			let account = getAccount(address)

			var storagePaths: [StoragePath] = []
			for p in account.storage.storagePaths {
				storagePaths.append(p)
			}

			var publicPaths: [PublicPath] = []
			for p in account.storage.publicPaths {
				publicPaths.append(p)
			}

			return {
				"used": account.storage.used,
				"capacity": account.storage.capacity,
				"storagePaths": storagePaths,
				"publicPaths": publicPaths
			}
		}
	`
}

func (s *Server) handleFlowAccountBalanceHistory(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		token = "A.1654653399040a61.FlowToken"
	}
	tokenAddr, tokenName := parseTokenParam(token)

	daysStr := r.URL.Query().Get("days")
	days := 30
	if daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil && d > 0 && d <= 365 {
			days = d
		}
	}

	toDate := time.Now().UTC().Format("2006-01-02")
	fromDate := time.Now().UTC().AddDate(0, 0, -days).Format("2006-01-02")

	holding, err := s.repo.GetFTHolding(r.Context(), address, tokenAddr, tokenName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	currentBalance := "0"
	if holding != nil {
		currentBalance = holding.Balance
	}

	points, err := s.repo.GetBalanceHistory(r.Context(), address, tokenAddr, tokenName, currentBalance, fromDate, toDate)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeAPIResponse(w, points, map[string]interface{}{
		"token":           token,
		"days":            days,
		"current_balance": currentBalance,
	}, nil)
}

func sigAlgoToNum(name string) string {
	switch strings.ToUpper(name) {
	case "ECDSA_P256":
		return "1"
	case "ECDSA_SECP256K1":
		return "2"
	default:
		return name
	}
}

func hashAlgoToNum(name string) string {
	switch strings.ToUpper(name) {
	case "SHA2_256":
		return "1"
	case "SHA2_384":
		return "2"
	case "SHA3_256":
		return "3"
	case "SHA3_384":
		return "4"
	default:
		return name
	}
}

func numToSigAlgo(num string) string {
	switch num {
	case "1":
		return "ECDSA_P256"
	case "2":
		return "ECDSA_secp256k1"
	default:
		return num
	}
}

func numToHashAlgo(num string) string {
	switch num {
	case "1":
		return "SHA2_256"
	case "2":
		return "SHA2_384"
	case "3":
		return "SHA3_256"
	case "4":
		return "SHA3_384"
	default:
		return num
	}
}
