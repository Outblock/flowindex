package api

import (
	"encoding/json"
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

type apiEnvelope struct {
	Links map[string]string      `json:"_links,omitempty"`
	Meta  map[string]interface{} `json:"_meta,omitempty"`
	Data  interface{}            `json:"data,omitempty"`
	Error interface{}            `json:"error,omitempty"`
}

func writeAPIResponse(w http.ResponseWriter, data interface{}, meta map[string]interface{}, links map[string]string) {
	resp := apiEnvelope{
		Links: links,
		Meta:  meta,
		Data:  data,
	}
	json.NewEncoder(w).Encode(resp)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(apiEnvelope{
		Error: map[string]string{"message": message},
	})
}

func parseLimitOffset(r *http.Request) (int, int) {
	limit := 20
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

func parseHeightParam(val string) (*uint64, error) {
	if val == "" {
		return nil, nil
	}
	n, err := strconv.ParseUint(val, 10, 64)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func normalizeAddr(addr string) string {
	addr = strings.TrimSpace(addr)
	addr = strings.TrimPrefix(strings.ToLower(addr), "0x")
	return addr
}

func formatAddressV1(addr string) string {
	addr = normalizeAddr(addr)
	if addr == "" {
		return ""
	}
	return "0x" + addr
}

func formatAddressListV1(addrs []string) []string {
	if len(addrs) == 0 {
		return addrs
	}
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		out = append(out, formatAddressV1(a))
	}
	return out
}

func collectTxIDs(txs []models.Transaction) []string {
	out := make([]string, 0, len(txs))
	for _, t := range txs {
		out = append(out, t.ID)
	}
	return out
}

func formatTime(ts time.Time) string {
	if ts.IsZero() {
		return ""
	}
	return ts.UTC().Format(time.RFC3339)
}

func parseFloatOrZero(val string) float64 {
	if val == "" {
		return 0
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return 0
	}
	return f
}

func splitContractIdentifier(value string) (address, name, identifier string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", "", ""
	}
	identifier = value
	parts := strings.Split(value, ".")
	if len(parts) >= 3 && parts[0] == "A" {
		address = strings.ToLower(parts[1])
		name = parts[2]
		return address, name, identifier
	}
	if len(parts) == 2 {
		address = strings.ToLower(parts[0])
		name = parts[1]
		identifier = "A." + address + "." + name
		return address, name, identifier
	}
	address = strings.ToLower(strings.TrimPrefix(value, "0x"))
	identifier = address
	return address, "", identifier
}

func formatTokenIdentifier(address, name string) string {
	address = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(address), "0x"))
	name = strings.TrimSpace(name)
	if address == "" {
		return name
	}
	if name == "" {
		return address
	}
	return "A." + address + "." + name
}

func formatTokenVaultIdentifier(address, name string) string {
	base := formatTokenIdentifier(address, name)
	if base == "" {
		return ""
	}
	if strings.Contains(base, ".") && !strings.HasSuffix(base, ".Vault") {
		return base + ".Vault"
	}
	return base
}

func vaultPathForContract(contractName string) string {
	if contractName == "" {
		return ""
	}
	if contractName == "FlowToken" {
		return "/storage/flowTokenVault"
	}
	return "/storage/" + contractName + "Vault"
}

func normalizeTokenParam(token string) string {
	address, _, _ := splitContractIdentifier(token)
	return address
}

func toFlowBlockOutput(b models.Block) map[string]interface{} {
	return map[string]interface{}{
		"id":                 b.ID,
		"height":             b.Height,
		"timestamp":          b.Timestamp.UTC().Format(time.RFC3339),
		"tx":                 b.TxCount,
		"system_event_count": b.EventCount,
		"total_gas_used":     b.TotalGasUsed,
		"evm_tx_count":       0,
		"fees":               0,
		"surge_factor":       0,
	}
}

func toFlowEventOutput(e models.Event) map[string]interface{} {
	return map[string]interface{}{
		"type":         e.Type,
		"transaction":  e.TransactionID,
		"event_index":  e.EventIndex,
		"block_height": e.BlockHeight,
		"timestamp":    e.Timestamp.UTC().Format(time.RFC3339),
		"payload":      e.Payload,
	}
}

func toFlowTransactionOutput(t models.Transaction, events []models.Event, contracts []string, tags []string, fee float64) map[string]interface{} {
	evOut := make([]map[string]interface{}, 0, len(events))
	for _, e := range events {
		evOut = append(evOut, toFlowEventOutput(e))
	}
	return map[string]interface{}{
		"id":                t.ID,
		"block_height":      t.BlockHeight,
		"transaction_index": t.TransactionIndex,
		"timestamp":         t.Timestamp.UTC().Format(time.RFC3339),
		"payer":             formatAddressV1(t.PayerAddress),
		"proposer":          formatAddressV1(t.ProposerAddress),
		"authorizers":       formatAddressListV1(t.Authorizers),
		"status":            t.Status,
		"error":             t.ErrorMessage,
		"gas_used":          t.GasUsed,
		"event_count":       t.EventCount,
		"events":            evOut,
		"contract_imports":  contracts,
		"contract_outputs":  []string{},
		"tags":              tags,
		"fee":               fee,
	}
}

func toFTListOutput(token models.FTToken) map[string]interface{} {
	address, name, identifier := splitContractIdentifier(token.ContractAddress)
	if name == "" {
		name = token.Name
	}
	return map[string]interface{}{
		"id":            identifier,
		"address":       formatAddressV1(address),
		"contract_name": name,
		"name":          token.Name,
		"symbol":        token.Symbol,
		"decimals":      token.Decimals,
		"timestamp":     formatTime(token.UpdatedAt),
		"updated_at":    formatTime(token.UpdatedAt),
	}
}

func toFTHoldingOutput(holding models.FTHolding, percentage float64) map[string]interface{} {
	tokenIdentifier := holding.ContractAddress
	return map[string]interface{}{
		"address":    formatAddressV1(holding.Address),
		"token":      tokenIdentifier,
		"balance":    parseFloatOrZero(holding.Balance),
		"percentage": percentage,
	}
}

func toVaultOutput(holding models.FTHolding) map[string]interface{} {
	return map[string]interface{}{
		"id":           holding.Address + ":" + holding.ContractAddress,
		"vault_id":     0,
		"address":      formatAddressV1(holding.Address),
		"token":        holding.ContractAddress,
		"balance":      parseFloatOrZero(holding.Balance),
		"block_height": holding.LastHeight,
		"path":         "",
	}
}

func toNFTCollectionOutput(summary repository.NFTCollectionSummary) map[string]interface{} {
	address, name, identifier := splitContractIdentifier(summary.ContractAddress)
	if name == "" {
		name = summary.Name
	}
	return map[string]interface{}{
		"id":               identifier,
		"address":          formatAddressV1(address),
		"contract_name":    name,
		"name":             summary.Name,
		"display_name":     summary.Name,
		"number_of_tokens": summary.Count,
		"timestamp":        formatTime(summary.UpdatedAt),
		"updated_at":       formatTime(summary.UpdatedAt),
		"status":           "",
	}
}

func toNFTHoldingOutput(owner string, count int64, percentage float64, nftType string) map[string]interface{} {
	return map[string]interface{}{
		"owner":      formatAddressV1(owner),
		"nft_type":   nftType,
		"count":      count,
		"percentage": percentage,
	}
}

func toCombinedNFTDetails(ownership models.NFTOwnership) map[string]interface{} {
	return map[string]interface{}{
		"id":           ownership.NFTID,
		"nft_id":       ownership.NFTID,
		"owner":        formatAddressV1(ownership.Owner),
		"type":         ownership.ContractAddress,
		"block_height": ownership.LastHeight,
		"timestamp":    formatTime(ownership.UpdatedAt),
		"live":         false,
		"status":       "",
	}
}

func toContractOutput(contract models.SmartContract) map[string]interface{} {
	identifier := formatTokenIdentifier(contract.Address, contract.Name)
	return map[string]interface{}{
		"id":         identifier,
		"identifier": identifier,
		"address":    formatAddressV1(contract.Address),
		"name":       contract.Name,
		"body":       contract.Code,
		"created_at": formatTime(contract.CreatedAt),
		"valid_from": contract.BlockHeight,
		"valid_to":   0,
		"status":     "",
		"tags":       []string{},
	}
}

func parseStorageOverview(raw []byte) (used uint64, capacity uint64) {
	val, err := cadjson.Decode(nil, raw)
	if err != nil {
		return 0, 0
	}
	dict, ok := val.(cadence.Dictionary)
	if !ok {
		return 0, 0
	}
	for _, pair := range dict.Pairs {
		key, ok := pair.Key.(cadence.String)
		if !ok {
			continue
		}
		switch string(key) {
		case "used":
			used = cadenceToUint64(pair.Value)
		case "capacity":
			capacity = cadenceToUint64(pair.Value)
		}
	}
	return used, capacity
}

func cadenceToUint64(val cadence.Value) uint64 {
	switch v := val.(type) {
	case cadence.UInt64:
		return uint64(v)
	case cadence.UInt32:
		return uint64(v)
	case cadence.UInt16:
		return uint64(v)
	case cadence.UInt8:
		return uint64(v)
	case cadence.UInt:
		n, _ := strconv.ParseUint(v.String(), 10, 64)
		return n
	case cadence.UInt128:
		n, _ := strconv.ParseUint(v.String(), 10, 64)
		return n
	case cadence.UFix64:
		f, _ := strconv.ParseFloat(v.String(), 64)
		if f < 0 {
			return 0
		}
		return uint64(f)
	default:
		n, _ := strconv.ParseUint(v.String(), 10, 64)
		return n
	}
}

func toEVMTransactionOutput(rec repository.EVMTransactionRecord) map[string]interface{} {
	return map[string]interface{}{
		"block_number": rec.BlockHeight,
		"hash":         rec.EVMHash,
		"from":         rec.FromAddress,
		"to":           rec.ToAddress,
		"timestamp":    formatTime(rec.Timestamp),
		"status":       "SEALED",
		"gas_used":     "0",
		"gas_limit":    "0",
		"gas_price":    "0",
		"value":        "0",
		"type":         0,
		"position":     0,
		"nonce":        0,
	}
}

func transferDirection(addrFilter, from, to string) string {
	if addrFilter != "" {
		if addrFilter == from {
			return "withdraw"
		}
		if addrFilter == to {
			return "deposit"
		}
	}
	if from == "" && to != "" {
		return "deposit"
	}
	if to == "" && from != "" {
		return "withdraw"
	}
	return "deposit"
}

func toFTTransferOutput(t models.TokenTransfer, contractName, addrFilter string) map[string]interface{} {
	tokenIdentifier := formatTokenVaultIdentifier(t.TokenContractAddress, contractName)
	tokenName := ""
	tokenSymbol := ""
	tokenLogo := ""
	if contractName == "FlowToken" {
		tokenName = "Flow"
		tokenSymbol = "FLOW"
		tokenLogo = "https://cdn.jsdelivr.net/gh/FlowFans/flow-token-list@main/token-registry/A.1654653399040a61.FlowToken/logo.svg"
	} else if contractName != "" {
		tokenName = contractName
	}
	return map[string]interface{}{
		"address":          formatAddressV1(addrFilter),
		"transaction_hash": t.TransactionID,
		"block_height":     t.BlockHeight,
		"timestamp":        formatTime(t.Timestamp),
		"amount":           parseFloatOrZero(t.Amount),
		"sender":           formatAddressV1(t.FromAddress),
		"receiver":         formatAddressV1(t.ToAddress),
		"direction":        transferDirection(addrFilter, t.FromAddress, t.ToAddress),
		"verified":         false,
		"is_primary":       false,
		"classifier":       "Coin Transfer",
		"approx_usd_price": 0,
		"receiver_balance": 0,
		"token": map[string]interface{}{
			"token":  tokenIdentifier,
			"name":   tokenName,
			"symbol": tokenSymbol,
			"logo":   tokenLogo,
		},
	}
}

func toNFTTransferOutput(t models.TokenTransfer, contractName, addrFilter string) map[string]interface{} {
	nftType := formatTokenIdentifier(t.TokenContractAddress, contractName)
	return map[string]interface{}{
		"transaction_hash": t.TransactionID,
		"block_height":     t.BlockHeight,
		"timestamp":        formatTime(t.Timestamp),
		"nft_type":         nftType,
		"nft_id":           t.TokenID,
		"sender":           formatAddressV1(t.FromAddress),
		"receiver":         formatAddressV1(t.ToAddress),
		"current_owner":    formatAddressV1(t.ToAddress),
		"direction":        transferDirection(addrFilter, t.FromAddress, t.ToAddress),
		"verified":         false,
		"is_primary":       false,
	}
}

// --- Accounting + Flow + Status Handlers ---

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
	events, _ := s.repo.GetEventsByTransactionIDs(r.Context(), []string{tx.ID})
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
