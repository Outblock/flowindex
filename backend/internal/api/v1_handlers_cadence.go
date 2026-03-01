package api

import (
	"encoding/json"
	"net/http"
)

func (s *Server) handleCadenceCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code    string `json:"code"`
		Network string `json:"network"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Placeholder - returns empty diagnostics for now
	// TODO: Forward to cadence-mcp cadence_check when MCP HTTP bridge is ready
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"diagnostics": []any{},
		"valid":       true,
	})
}
