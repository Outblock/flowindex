package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

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

	out := make([]map[string]interface{}, 0, len(contracts))
	for _, c := range contracts {
		// If we didn't persist contract code (storage pressure), we can still serve it on-demand
		// from Flow RPC for the detail view.
		if c.Code == "" && s.client != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			acc, err := s.client.GetAccount(ctx, flow.HexToAddress(c.Address))
			cancel()
			if err == nil && acc != nil {
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
	// TODO: versions are not modeled yet; reuse latest for now.
	s.handleFlowGetContract(w, r)
}
