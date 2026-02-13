package api

import (
	"context"
	"net/http"
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
	identifierRaw := strings.TrimSpace(r.URL.Query().Get("identifier"))
	if identifierRaw != "" {
		addr2, name2, _ := splitContractIdentifier(identifierRaw)
		if addr2 != "" {
			address = addr2
		}
		// name2 can be empty (address-only identifier).
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
	if identifierRaw != "" {
		_, name2, _ := splitContractIdentifier(identifierRaw)
		name = name2
	}

	contracts, err := s.repo.ListContractsFiltered(r.Context(), repository.ContractListFilter{
		Address:   address,
		Name:      name,
		Body:      body,
		ValidFrom: validFrom,
		Sort:      sort,
		SortOrder: sortOrder,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
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
				contracts = append(contracts, models.SmartContract{
					Address: address,
					Name:    name,
					Code:    string(b),
				})
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
