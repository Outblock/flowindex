package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/onflow/cadence"
	cadjson "github.com/onflow/cadence/encoding/json"
)

type apiEnvelope struct {
	Links map[string]string      `json:"_links,omitempty"`
	Meta  map[string]interface{} `json:"_meta,omitempty"`
	Data  interface{}            `json:"data,omitempty"`
	Error interface{}            `json:"error,omitempty"`
}

func safeRawJSON(b []byte) json.RawMessage {
	if len(b) == 0 || string(b) == "" || string(b) == "null" {
		return json.RawMessage(`null`)
	}
	return json.RawMessage(b)
}

// unquoteString strips surrounding JSON quotes from a string value that was
// stored as a JSON-encoded text (e.g. `"https://..."` → `https://...`).
func unquoteString(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}
	return s
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

func normalizeFlowAddr(addr string) string {
	addr = normalizeAddr(addr)
	if addr == "" {
		return ""
	}
	// Basic hex validation (avoid silently mapping invalid input to 0x0...).
	for _, r := range addr {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
			continue
		}
		return ""
	}
	if len(addr) > 16 {
		return ""
	}
	if len(addr)%2 == 1 {
		addr = "0" + addr
	}
	if len(addr) < 16 {
		addr = strings.Repeat("0", 16-len(addr)) + addr
	}
	return addr
}

func formatAddressV1(addr string) string {
	addr = normalizeFlowAddr(addr)
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
	if len(parts) >= 3 && strings.EqualFold(parts[0], "A") {
		address = normalizeFlowAddr(parts[1])
		name = parts[2]
		return address, name, identifier
	}
	if len(parts) == 2 {
		address = normalizeFlowAddr(parts[0])
		name = parts[1]
		identifier = "A." + address + "." + name
		return address, name, identifier
	}
	address = normalizeFlowAddr(value)
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

func parseTokenParam(token string) (address, name string) {
	address, name, _ = splitContractIdentifier(token)
	return address, name
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

func toFlowTransactionOutput(t models.Transaction, events []models.Event, contracts []string, tags []string, fee float64, evmExecs ...[]repository.EVMTransactionRecord) map[string]interface{} {
	evOut := make([]map[string]interface{}, 0, len(events))
	for _, e := range events {
		evOut = append(evOut, toFlowEventOutput(e))
	}
	out := map[string]interface{}{
		"id":                         t.ID,
		"block_height":               t.BlockHeight,
		"transaction_index":          t.TransactionIndex,
		"timestamp":                  t.Timestamp.UTC().Format(time.RFC3339),
		"payer":                      formatAddressV1(t.PayerAddress),
		"proposer":                   formatAddressV1(t.ProposerAddress),
		"proposer_key_index":         t.ProposerKeyIndex,
		"proposer_sequence_number":   t.ProposerSequenceNumber,
		"authorizers":                formatAddressListV1(t.Authorizers),
		"status":                     t.Status,
		"error":                      t.ErrorMessage,
		"gas_used":                   t.GasUsed,
		"event_count":                t.EventCount,
		"events":                     evOut,
		"contract_imports":           contracts,
		"contract_outputs":           []string{},
		"tags":                       tags,
		"fee":                        fee,
	}
	if t.Script != "" {
		out["script"] = t.Script
	}
	if len(t.Arguments) > 0 && string(t.Arguments) != "null" {
		out["arguments"] = t.Arguments
	}
	if t.IsEVM {
		out["is_evm"] = true
	}
	if t.EVMHash != "" {
		out["evm_hash"] = formatAddressV1(t.EVMHash)
	}
	if t.EVMFrom != "" {
		out["evm_from"] = formatAddressV1(t.EVMFrom)
	}
	if t.EVMTo != "" {
		out["evm_to"] = formatAddressV1(t.EVMTo)
	}
	if t.EVMValue != "" {
		out["evm_value"] = t.EVMValue
	}
	if len(evmExecs) > 0 && len(evmExecs[0]) > 0 {
		execs := make([]map[string]interface{}, 0, len(evmExecs[0]))
		for _, rec := range evmExecs[0] {
			execs = append(execs, toEVMTransactionOutput(rec))
		}
		out["evm_executions"] = execs
	}
	return out
}

func toFTListOutput(token models.FTToken) map[string]interface{} {
	address := token.ContractAddress
	name := token.ContractName
	if address == "" || name == "" {
		addr, nm, _ := splitContractIdentifier(token.ContractAddress)
		if address == "" {
			address = addr
		}
		if name == "" {
			name = nm
		}
	}
	if name == "" {
		name = token.Name
	}
	identifier := formatTokenIdentifier(address, name)
	out := map[string]interface{}{
		"id":            identifier,
		"address":       formatAddressV1(address),
		"contract_name": name,
		"name":          token.Name,
		"symbol":        token.Symbol,
		"decimals":      token.Decimals,
		"holder_count":    token.HolderCount,
		"transfer_count":  token.TransferCount,
		"evm_address":     token.EVMAddress,
		"evm_bridged":     token.EVMAddress != "",
	}
	if token.Description != "" {
		out["description"] = token.Description
	}
	if token.ExternalURL != "" {
		out["external_url"] = token.ExternalURL
	}
	if token.Logo != "" {
		out["logo"] = token.Logo
	}
	if token.VaultPath != "" {
		out["vault_path"] = token.VaultPath
	}
	if token.ReceiverPath != "" {
		out["receiver_path"] = token.ReceiverPath
	}
	if token.BalancePath != "" {
		out["balance_path"] = token.BalancePath
	}
	if len(token.Socials) > 0 && string(token.Socials) != "null" {
		out["socials"] = json.RawMessage(token.Socials)
	}
	return out
}

func toFTHoldingOutput(holding models.FTHolding, percentage float64) map[string]interface{} {
	tokenIdentifier := formatTokenIdentifier(holding.ContractAddress, holding.ContractName)
	return map[string]interface{}{
		"address":    formatAddressV1(holding.Address),
		"token":      tokenIdentifier,
		"balance":    parseFloatOrZero(holding.Balance),
		"percentage": percentage,
	}
}

func toVaultOutput(holding models.FTHolding) map[string]interface{} {
	return map[string]interface{}{
		"id":           holding.Address + ":" + formatTokenIdentifier(holding.ContractAddress, holding.ContractName),
		"vault_id":     0,
		"address":      formatAddressV1(holding.Address),
		"token":        formatTokenIdentifier(holding.ContractAddress, holding.ContractName),
		"balance":      parseFloatOrZero(holding.Balance),
		"block_height": holding.LastHeight,
		"path":         "",
	}
}

func toNFTCollectionOutput(summary repository.NFTCollectionSummary) map[string]interface{} {
	address := summary.ContractAddress
	name := summary.ContractName
	if address == "" || name == "" {
		addr, nm, _ := splitContractIdentifier(summary.ContractAddress)
		if address == "" {
			address = addr
		}
		if name == "" {
			name = nm
		}
	}
	if name == "" {
		name = summary.Name
	}
	identifier := formatTokenIdentifier(address, name)
	return map[string]interface{}{
		"id":               identifier,
		"address":          formatAddressV1(address),
		"contract_name":    name,
		"name":             summary.Name,
		"display_name":     summary.Name,
		"description":      summary.Description,
		"external_url":     summary.ExternalURL,
		"square_image":     unquoteString(summary.SquareImage),
		"banner_image":     unquoteString(summary.BannerImage),
		"socials":          safeRawJSON(summary.Socials),
		"number_of_tokens": summary.Count,
		"holder_count":     summary.HolderCount,
		"transfer_count":   summary.TransferCount,
		"evm_address":      summary.EVMAddress,
		"evm_bridged":      summary.EVMAddress != "",
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
		"id":                 identifier,
		"identifier":         identifier,
		"address":            formatAddressV1(contract.Address),
		"name":               contract.Name,
		"body":               contract.Code,
		"created_at":         formatTime(contract.CreatedAt),
		"valid_from":         contract.BlockHeight,
		"valid_to":           0,
		"status":             "",
		"tags":               []string{},
		"deployments":        0,
		"diff":               "",
		"import_count":       0,
		"imported_by":        []string{},
		"imported_count":     0,
		"parent_contract_id": "",
		"transaction_hash":   "",
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
	gasPrice := rec.GasPrice
	if gasPrice == "" {
		gasPrice = "0"
	}
	value := rec.Value
	if value == "" {
		value = "0"
	}
	status := rec.Status
	if status == "" {
		status = "SEALED"
	}
	return map[string]interface{}{
		"block_number": rec.BlockHeight,
		"hash":         rec.EVMHash,
		"from":         rec.FromAddress,
		"to":           rec.ToAddress,
		"timestamp":    formatTime(rec.Timestamp),
		"status":       status,
		"gas_used":     strconv.FormatUint(rec.GasUsed, 10),
		"gas_limit":    strconv.FormatUint(rec.GasLimit, 10),
		"gas_price":    gasPrice,
		"value":        value,
		"type":         rec.TxType,
		"position":     rec.Position,
		"event_index":  rec.EventIndex,
		"nonce":        rec.Nonce,
	}
}

func toEVMTokenOutput(rec repository.EVMTokenSummary) map[string]interface{} {
	return map[string]interface{}{
		"address":        formatAddressV1(rec.Address),
		"name":           rec.Name,
		"symbol":         rec.Symbol,
		"decimals":       rec.Decimals,
		"holder_count":   rec.HolderCount,
		"transfer_count": rec.TransferCount,
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

func toFTTransferOutput(t models.TokenTransfer, contractName, addrFilter string, meta *repository.TokenMetadataInfo) map[string]interface{} {
	tokenIdentifier := formatTokenVaultIdentifier(t.TokenContractAddress, contractName)
	tokenName := ""
	tokenSymbol := ""
	var tokenLogo interface{} = ""
	if meta != nil && meta.Name != "" {
		tokenName = meta.Name
		tokenSymbol = meta.Symbol
		if meta.Logo != "" {
			tokenLogo = meta.Logo
		}
	} else if contractName == "FlowToken" {
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

func toNFTTransferOutput(t models.TokenTransfer, contractName, addrFilter string, meta *repository.TokenMetadataInfo) map[string]interface{} {
	nftType := formatTokenIdentifier(t.TokenContractAddress, contractName)
	out := map[string]interface{}{
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
	if meta != nil {
		collection := map[string]interface{}{}
		if meta.Name != "" {
			collection["name"] = meta.Name
		}
		if meta.Symbol != "" {
			collection["symbol"] = meta.Symbol
		}
		if meta.Logo != "" {
			collection["image"] = meta.Logo
		}
		if meta.Description != "" {
			collection["description"] = meta.Description
		}
		out["collection"] = collection
	}
	return out
}

func toTransferSummaryOutput(s repository.TransferSummary, ftMeta, nftMeta map[string]repository.TokenMetadataInfo) map[string]interface{} {
	ft := make([]map[string]interface{}, 0, len(s.FT))
	for _, f := range s.FT {
		item := map[string]interface{}{
			"token":     f.Token,
			"amount":    f.Amount,
			"direction": f.Direction,
		}
		if f.Counterparty != "" {
			item["counterparty"] = formatAddressV1(f.Counterparty)
		}
		if m, ok := ftMeta[f.Token]; ok {
			if m.Symbol != "" {
				item["symbol"] = m.Symbol
			}
			if m.Name != "" {
				item["name"] = m.Name
			}
			if m.Logo != "" {
				item["logo"] = m.Logo
			}
		}
		ft = append(ft, item)
	}
	nft := make([]map[string]interface{}, 0, len(s.NFT))
	for _, n := range s.NFT {
		item := map[string]interface{}{
			"collection": n.Collection,
			"count":      n.Count,
			"direction":  n.Direction,
		}
		if n.Counterparty != "" {
			item["counterparty"] = formatAddressV1(n.Counterparty)
		}
		if m, ok := nftMeta[n.Collection]; ok {
			if m.Name != "" {
				item["name"] = m.Name
			}
			if m.Logo != "" {
				item["logo"] = m.Logo
			}
		}
		nft = append(nft, item)
	}
	return map[string]interface{}{
		"ft":  ft,
		"nft": nft,
	}
}

func toFlowTransactionOutputWithTransfers(t models.Transaction, events []models.Event, contracts []string, tags []string, fee float64, transfers *repository.TransferSummary, ftMeta, nftMeta map[string]repository.TokenMetadataInfo) map[string]interface{} {
	out := toFlowTransactionOutput(t, events, contracts, tags, fee)
	if transfers != nil {
		out["transfer_summary"] = toTransferSummaryOutput(*transfers, ftMeta, nftMeta)
	} else {
		out["transfer_summary"] = map[string]interface{}{"ft": []interface{}{}, "nft": []interface{}{}}
	}
	return out
}

// collectTransferTokenIDs extracts unique token identifiers from a transfer list.
func collectTransferTokenIDs(transfers []repository.TokenTransferWithContract, isNFT bool) []string {
	seen := make(map[string]bool)
	var ids []string
	for _, t := range transfers {
		var id string
		if isNFT {
			id = formatTokenIdentifier(t.TokenContractAddress, t.ContractName)
		} else {
			id = formatTokenVaultIdentifier(t.TokenContractAddress, t.ContractName)
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

// collectTokenIdentifiers extracts all unique FT and NFT token identifiers from a set of transfer summaries.
func collectTokenIdentifiers(summaries map[string]repository.TransferSummary) (ftIDs, nftIDs []string) {
	ftSet := make(map[string]bool)
	nftSet := make(map[string]bool)
	for _, s := range summaries {
		for _, f := range s.FT {
			if !ftSet[f.Token] {
				ftSet[f.Token] = true
				ftIDs = append(ftIDs, f.Token)
			}
		}
		for _, n := range s.NFT {
			if !nftSet[n.Collection] {
				nftSet[n.Collection] = true
				nftIDs = append(nftIDs, n.Collection)
			}
		}
	}
	return
}

func toNFTItemOutput(item models.NFTItem) map[string]interface{} {
	nftType := formatTokenIdentifier(item.ContractAddress, item.ContractName)
	out := map[string]interface{}{
		"id":            item.NFTID,
		"nft_id":        item.NFTID,
		"nft_type":      nftType,
		"name":          item.Name,
		"description":   item.Description,
		"thumbnail":     item.Thumbnail,
		"external_url":  item.ExternalURL,
		"updated_at":    formatTime(item.UpdatedAt),
	}
	if item.SerialNumber != nil {
		out["serial_number"] = *item.SerialNumber
	}
	if item.EditionName != "" {
		out["edition_name"] = item.EditionName
	}
	if item.EditionNumber != nil {
		out["edition_number"] = *item.EditionNumber
	}
	if item.EditionMax != nil {
		out["edition_max"] = *item.EditionMax
	}
	if item.RarityScore != "" {
		out["rarity_score"] = item.RarityScore
	}
	if item.RarityDescription != "" {
		out["rarity_description"] = item.RarityDescription
	}
	if len(item.Traits) > 0 && string(item.Traits) != "null" {
		out["traits"] = json.RawMessage(item.Traits)
	}
	return out
}

func enrichNFTItemOutput(out map[string]interface{}, meta *models.NFTItem) {
	if meta.Name != "" {
		out["name"] = meta.Name
	}
	if meta.Description != "" {
		out["description"] = meta.Description
	}
	if meta.Thumbnail != "" {
		out["thumbnail"] = meta.Thumbnail
	}
	if meta.ExternalURL != "" {
		out["external_url"] = meta.ExternalURL
	}
	if meta.SerialNumber != nil {
		out["serial_number"] = *meta.SerialNumber
	}
	if meta.EditionName != "" {
		out["edition_name"] = meta.EditionName
	}
	if meta.EditionNumber != nil {
		out["edition_number"] = *meta.EditionNumber
	}
	if meta.EditionMax != nil {
		out["edition_max"] = *meta.EditionMax
	}
	if meta.RarityScore != "" {
		out["rarity_score"] = meta.RarityScore
	}
	if meta.RarityDescription != "" {
		out["rarity_description"] = meta.RarityDescription
	}
	if len(meta.Traits) > 0 && string(meta.Traits) != "null" {
		out["traits"] = json.RawMessage(meta.Traits)
	}
}

// --- Accounting + Flow + Status Handlers ---
