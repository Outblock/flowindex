package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"flowscan-clone/internal/models"
)

type coaBackfillRequest struct {
	FlowAddress string `json:"flow_address"`
	COAAddress  string `json:"coa_address"`
}

func (s *Server) handleFlowCOABackfill(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	var req coaBackfillRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	flowAddr := strings.TrimPrefix(strings.ToLower(req.FlowAddress), "0x")
	coaAddr := strings.TrimPrefix(strings.ToLower(req.COAAddress), "0x")
	if flowAddr == "" || coaAddr == "" {
		writeAPIError(w, http.StatusBadRequest, "flow_address and coa_address are required")
		return
	}

	if err := s.repo.UpsertCOAAccounts(r.Context(), []models.COAAccount{
		{FlowAddress: flowAddr, COAAddress: coaAddr},
	}); err != nil {
		log.Printf("[WARN] COA backfill upsert error: %v", err)
		writeAPIError(w, http.StatusInternalServerError, "failed to upsert COA mapping")
		return
	}

	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"flow_address": formatAddressV1(flowAddr),
		"coa_address":  coaAddr,
	}}, nil, nil)
}
