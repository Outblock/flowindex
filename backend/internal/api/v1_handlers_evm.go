package api

import (
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

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
	meta := map[string]interface{}{"limit": limit, "offset": offset}
	if total, err := s.repo.GetTotalEVMTransactions(r.Context()); err == nil && total > 0 {
		meta["count"] = total
	} else {
		meta["count"] = len(out)
	}
	writeAPIResponse(w, out, meta, nil)
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
