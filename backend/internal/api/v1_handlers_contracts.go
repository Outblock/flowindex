package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
	"github.com/onflow/flow-go-sdk"
)

func (s *Server) handleFlowListContracts(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	limit := 25
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	address := normalizeFlowAddr(r.URL.Query().Get("address"))
	nameSearch := "" // for keyword/name-only search
	identifierRaw := strings.TrimSpace(r.URL.Query().Get("identifier"))
	if identifierRaw != "" {
		addr2, name2, _ := splitContractIdentifier(identifierRaw)
		if addr2 != "" {
			address = addr2
		} else {
			// No address parsed — treat as a contract name keyword search
			nameSearch = identifierRaw
		}
		_ = name2
	}

	validFrom, err := parseHeightParam(r.URL.Query().Get("valid_from"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid valid_from")
		return
	}
	if validFrom == nil {
		if tip, err := s.repo.GetIndexedTipHeight(r.Context()); err == nil && tip > 0 {
			validFrom = &tip
		}
	}

	sort := strings.TrimSpace(r.URL.Query().Get("sort"))
	sortOrder := strings.TrimSpace(r.URL.Query().Get("sort_order"))
	body := r.URL.Query().Get("body")
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	validOnly := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("valid_only"))) == "true"

	meta := map[string]interface{}{
		"limit":      limit,
		"offset":     offset,
		"valid_from": 0,
	}
	if validFrom != nil {
		meta["valid_from"] = *validFrom
	}
	if sort != "" {
		meta["sort"] = sort
	}
	if sortOrder != "" {
		meta["sort_order"] = sortOrder
	}
	if status != "" || tag != "" || validOnly {
		meta["warning"] = "filters status/tag/valid_only are not supported yet"
	}

	name := ""
	if identifierRaw != "" && nameSearch == "" {
		_, name2, _ := splitContractIdentifier(identifierRaw)
		name = name2
	}

	contracts, err := s.repo.ListContractsFiltered(r.Context(), repository.ContractListFilter{
		Address:    address,
		Name:       name,
		NameSearch: nameSearch,
		Body:       body,
		Kind:       kind,
		ValidFrom:  validFrom,
		Sort:       sort,
		SortOrder:  sortOrder,
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// dependent_count is now pre-computed in smart_contracts, no need to batch-fetch
	out := make([]map[string]interface{}, 0, len(contracts))
	for _, c := range contracts {
		out = append(out, toContractOutput(c))
	}
	if total, err := s.repo.GetTotalContracts(r.Context()); err == nil && total > 0 {
		meta["count"] = total
	} else {
		meta["count"] = len(out)
	}
	writeAPIResponse(w, out, meta, nil)
}

func (s *Server) handleFlowGetContract(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	identifier := mux.Vars(r)["identifier"]

	limit := 25
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	validFrom, err := parseHeightParam(r.URL.Query().Get("valid_from"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid valid_from")
		return
	}
	if validFrom == nil {
		if tip, err := s.repo.GetIndexedTipHeight(r.Context()); err == nil && tip > 0 {
			validFrom = &tip
		}
	}

	address, name, _ := splitContractIdentifier(identifier)
	if address == "" {
		writeAPIResponse(w, []interface{}{}, map[string]interface{}{"limit": limit, "offset": offset, "count": 0}, nil)
		return
	}

	contracts, err := s.repo.ListContractsFiltered(r.Context(), repository.ContractListFilter{
		Address:   address,
		Name:      name,
		ValidFrom: validFrom,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Fallback: if contract not in DB at all but we have a specific name, try RPC
	if len(contracts) == 0 && name != "" && s.client != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		acc, rpcErr := s.client.GetAccount(ctx, flow.HexToAddress(address))
		cancel()
		if rpcErr == nil && acc != nil {
			if b, ok := acc.Contracts[name]; ok && len(b) > 0 {
				sc := models.SmartContract{Address: address, Name: name, Code: string(b)}
				contracts = append(contracts, sc)
				// Backfill to DB with height=0 so indexer can overwrite later
				_ = s.repo.UpsertSmartContracts(r.Context(), []models.SmartContract{sc})
			}
		}
	}

	out := make([]map[string]interface{}, 0, len(contracts))
	for _, c := range contracts {
		// If contract in DB but code is empty, fetch on-demand from RPC
		if c.Code == "" && s.client != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			acc, rpcErr := s.client.GetAccount(ctx, flow.HexToAddress(c.Address))
			cancel()
			if rpcErr == nil && acc != nil {
				if b, ok := acc.Contracts[c.Name]; ok && len(b) > 0 {
					c.Code = string(b)
					// Backfill code to DB
					_ = s.repo.UpsertSmartContracts(r.Context(), []models.SmartContract{
						{Address: c.Address, Name: c.Name, Code: c.Code, BlockHeight: c.BlockHeight},
					})
				}
			}
		}
		out = append(out, toContractOutput(c))
	}
	meta := map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}
	if validFrom != nil {
		meta["valid_from"] = *validFrom
	}
	writeAPIResponse(w, out, meta, nil)
}

func (s *Server) handleFlowGetContractVersion(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	identifier := mux.Vars(r)["identifier"]
	versionStr := mux.Vars(r)["id"]

	address, name, _ := splitContractIdentifier(identifier)
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	version, err := strconv.Atoi(versionStr)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid version number")
		return
	}

	v, err := s.repo.GetContractVersion(r.Context(), address, name, version)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if v == nil {
		writeAPIError(w, http.StatusNotFound, "version not found")
		return
	}

	// On-demand backfill: if code is empty, extract it from the deploy tx arguments.
	// Contract deploy/update transactions pass code as a hex-encoded String argument
	// with script like: code.decodeHex()
	if v.Code == "" && v.TransactionID != "" {
		if code := s.extractContractCodeFromTx(r.Context(), v.TransactionID, name); code != "" {
			v.Code = code
			_ = s.repo.BackfillContractVersionCode(r.Context(), address, name, v.Version, v.Code)
		}
	}

	out := map[string]interface{}{
		"address":        formatAddressV1(v.Address),
		"name":           v.Name,
		"version":        v.Version,
		"code":           v.Code,
		"block_height":   v.BlockHeight,
		"transaction_id": v.TransactionID,
		"created_at":     formatTime(v.CreatedAt),
	}
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

func (s *Server) handleContractTransactions(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	identifier := mux.Vars(r)["identifier"]
	limit, offset := parseLimitOffset(r)

	_, _, fullIdentifier := splitContractIdentifier(identifier)
	if fullIdentifier == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	txs, err := s.repo.GetTransactionsByContract(r.Context(), fullIdentifier, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	txIDs := collectTxIDs(txs)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), txIDs)
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), txIDs)
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), txIDs)

	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, nil, contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

// extractContractCodeFromTx extracts contract code from a deploy/update transaction's arguments.
// Contract deploy txs pass the code as a hex-encoded String argument (decoded via code.decodeHex()).
func (s *Server) extractContractCodeFromTx(ctx context.Context, txID, _ string) string {
	if s.repo == nil {
		return ""
	}
	tx, err := s.repo.GetTransactionByID(ctx, txID)
	if err != nil || tx == nil || len(tx.Arguments) == 0 {
		return ""
	}

	// Parse arguments: [{type: "String", value: "name"}, {type: "String", value: "hexcode"}]
	var args []struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	}
	if err := json.Unmarshal(tx.Arguments, &args); err != nil || len(args) < 2 {
		return ""
	}

	// The code argument is typically a long hex-encoded string (second arg).
	for i, arg := range args {
		if arg.Type != "String" || i == 0 {
			continue
		}
		if len(arg.Value) > 100 {
			decoded, err := hex.DecodeString(arg.Value)
			if err != nil {
				continue
			}
			return string(decoded)
		}
	}
	return ""
}

func (s *Server) handleContractEventTypes(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address, name, _ := splitContractIdentifier(vars["identifier"])
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	events, err := s.repo.GetContractEventTypes(r.Context(), address, name, limit)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to query event types")
		return
	}
	data := make([]map[string]interface{}, len(events))
	for i, e := range events {
		data[i] = map[string]interface{}{
			"type": e.Type, "event_name": e.EventName, "count": e.Count, "last_seen": e.LastSeen,
		}
	}
	writeAPIResponse(w, data, map[string]interface{}{"count": len(data)}, nil)
}

func (s *Server) handleSearchEvents(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		writeAPIError(w, http.StatusBadRequest, "name parameter required")
		return
	}
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	events, err := s.repo.SearchEventsByName(r.Context(), name, limit)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to search events")
		return
	}
	data := make([]map[string]interface{}, len(events))
	for i, e := range events {
		data[i] = map[string]interface{}{
			"type": e.Type, "contract_address": formatAddressV1(e.ContractAddress),
			"contract_name": e.ContractName, "event_name": e.EventName, "count": e.Count,
		}
	}
	writeAPIResponse(w, data, map[string]interface{}{"count": len(data)}, nil)
}

func (s *Server) handleContractVersionList(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	identifier := mux.Vars(r)["identifier"]
	limit, offset := parseLimitOffset(r)

	address, name, _ := splitContractIdentifier(identifier)
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	versions, err := s.repo.ListContractVersions(r.Context(), address, name, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]map[string]interface{}, 0, len(versions))
	for _, v := range versions {
		out = append(out, map[string]interface{}{
			"version":        v.Version,
			"block_height":   v.BlockHeight,
			"transaction_id": v.TransactionID,
			"created_at":     formatTime(v.CreatedAt),
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleContractScripts(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	identifier := mux.Vars(r)["identifier"]
	limit, offset := parseLimitOffset(r)

	_, _, fullIdentifier := splitContractIdentifier(identifier)
	if fullIdentifier == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	scripts, err := s.repo.GetCommonScriptsByContract(r.Context(), fullIdentifier, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]map[string]interface{}, 0, len(scripts))
	for _, sc := range scripts {
		out = append(out, map[string]interface{}{
			"script_hash":    sc.ScriptHash,
			"tx_count":       sc.TxCount,
			"category":       sc.Category,
			"label":          sc.Label,
			"description":    sc.Description,
			"script_preview": sc.ScriptPreview,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleContractDependencies(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}
	identifier := mux.Vars(r)["identifier"]

	address, name, _ := splitContractIdentifier(identifier)
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	// Get contract code to parse imports
	contracts, err := s.repo.ListContractsFiltered(r.Context(), repository.ContractListFilter{
		Address: address,
		Name:    name,
		Limit:   1,
	})
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Parse imports from contract code
	var imports []map[string]interface{}
	if len(contracts) > 0 && contracts[0].Code != "" {
		re := regexp.MustCompile(`import\s+(\w+)\s+from\s+0x([0-9a-fA-F]+)`)
		matches := re.FindAllStringSubmatch(contracts[0].Code, -1)
		seen := make(map[string]bool)
		for _, m := range matches {
			importName := m[1]
			importAddr := strings.ToLower(m[2])
			key := importAddr + "." + importName
			if seen[key] {
				continue
			}
			seen[key] = true
			imports = append(imports, map[string]interface{}{
				"identifier": "A." + importAddr + "." + importName,
				"address":    formatAddressV1(importAddr),
				"name":       importName,
			})
		}
	}
	if imports == nil {
		imports = []map[string]interface{}{}
	}

	// Get dependents (contracts that import this one)
	depRefs, err := s.repo.GetContractDependents(r.Context(), address, name)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	dependents := make([]map[string]interface{}, 0, len(depRefs))
	for _, d := range depRefs {
		dependents = append(dependents, map[string]interface{}{
			"identifier": "A." + d.Address + "." + d.Name,
			"address":    formatAddressV1(d.Address),
			"name":       d.Name,
		})
	}

	result := map[string]interface{}{
		"imports":    imports,
		"dependents": dependents,
	}
	writeAPIResponse(w, []interface{}{result}, nil, nil)
}
