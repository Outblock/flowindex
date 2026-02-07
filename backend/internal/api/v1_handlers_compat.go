package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"flowscan-clone/internal/models"

	"github.com/gorilla/mux"
)

func (s *Server) handlePublicGetAccount(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	address := normalizeFlowAddr(mux.Vars(r)["address"])
	if address == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid address")
		return
	}

	firstSeen := uint64(0)
	if acc, err := s.repo.GetAccountCatalog(r.Context(), address); err == nil && acc != nil {
		firstSeen = acc.FirstSeenHeight
	}

	coa := ""
	coaHeight := uint64(0)
	if row, err := s.repo.GetCOAByFlowAddress(r.Context(), address); err == nil && row != nil {
		coa = formatAddressV1(row.COAAddress)
		coaHeight = row.BlockHeight
	}

	out := map[string]interface{}{
		"address":      formatAddressV1(address),
		"block_height": firstSeen,
		"coa_address":  coa,
		"coa_height":   coaHeight,
		"evmAccounts":  []interface{}{},
		"profile":      nil,
	}
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

func (s *Server) handleBulkListContracts(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	_ = strings.ToLower(strings.TrimSpace(r.URL.Query().Get("valid_only"))) == "true" // not modeled yet

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte("["))
	first := true
	err := s.repo.IterateContracts(r.Context(), nil, func(c models.SmartContract) error {
		item := map[string]interface{}{
			"identifier": formatTokenIdentifier(c.Address, c.Name),
			"body":       c.Code,
		}
		b, err := json.Marshal(item)
		if err != nil {
			return err
		}
		if !first {
			_, _ = w.Write([]byte(","))
		}
		first = false
		_, _ = w.Write(b)
		return nil
	})
	if err != nil {
		// Best-effort: close JSON array to keep response parseable when possible.
		_, _ = w.Write([]byte("]"))
		return
	}
	_, _ = w.Write([]byte("]"))
}
