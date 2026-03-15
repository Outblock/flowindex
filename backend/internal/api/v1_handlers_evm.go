package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

// --- EVM endpoints: proxy to Blockscout instance ---

func (s *Server) handleFlowListEVMTransactions(w http.ResponseWriter, r *http.Request) {
	s.proxyBlockscout(w, r, "/api/v2/transactions")
}

func (s *Server) handleFlowGetEVMTransaction(w http.ResponseWriter, r *http.Request) {
	hash := strings.TrimPrefix(strings.ToLower(mux.Vars(r)["hash"]), "0x")
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash)
}

func (s *Server) handleFlowListEVMTokens(w http.ResponseWriter, r *http.Request) {
	s.proxyBlockscout(w, r, "/api/v2/tokens")
}

func (s *Server) handleFlowGetEVMAddressTokens(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+address+"/tokens")
}

func (s *Server) handleFlowGetEVMToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	if len(address) != 40 {
		writeAPIError(w, http.StatusBadRequest, "invalid evm token address")
		return
	}
	s.proxyBlockscout(w, r, "/api/v2/tokens/0x"+address)
}

func (s *Server) handleFlowGetEVMTransactionInternalTxs(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(strings.TrimPrefix(mux.Vars(r)["hash"], "0x"))
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash+"/internal-transactions")
}

func (s *Server) handleFlowGetEVMTransactionLogs(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(strings.TrimPrefix(mux.Vars(r)["hash"], "0x"))
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash+"/logs")
}

func (s *Server) handleFlowGetEVMTransactionTokenTransfers(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(strings.TrimPrefix(mux.Vars(r)["hash"], "0x"))
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash+"/token-transfers")
}

func (s *Server) handleFlowGetEVMAddress(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])

	// Build upstream request manually so we can read + enrich the response body.
	target := s.blockscoutURL + "/api/v2/addresses/0x" + addr
	if q := r.URL.RawQuery; q != "" {
		target += "?" + q
	}
	if s.blockscoutAPIKey != "" {
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		target += sep + "apikey=" + s.blockscoutAPIKey
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to build upstream request")
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := blockscoutClient.Do(req)
	if err != nil {
		log.Printf("blockscout proxy error: %v", err)
		writeAPIError(w, http.StatusBadGateway, "upstream blockscout unavailable")
		return
	}
	defer resp.Body.Close()

	// Non-200: stream through unchanged.
	if resp.StatusCode != http.StatusOK {
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
		return
	}

	// Read full body for potential enrichment.
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to read upstream response")
		return
	}

	// Attempt COA enrichment; any failure falls through to returning original body.
	enriched := false
	if coaRow, coaErr := s.repo.GetFlowAddressByCOA(r.Context(), addr); coaErr == nil && coaRow != nil {
		var data map[string]interface{}
		if jsonErr := json.Unmarshal(body, &data); jsonErr == nil {
			data["flow_address"] = "0x" + coaRow.FlowAddress
			data["is_coa"] = true
			if out, marshalErr := json.Marshal(data); marshalErr == nil {
				body = out
				enriched = true
			}
		}
	}
	_ = enriched // not needed further; kept for clarity

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

func (s *Server) handleFlowGetEVMAddressTransactions(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr+"/transactions")
}

func (s *Server) handleFlowGetEVMAddressInternalTxs(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr+"/internal-transactions")
}

func (s *Server) handleFlowGetEVMAddressTokenTransfers(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr+"/token-transfers")
}

func (s *Server) handleFlowEVMSearch(w http.ResponseWriter, r *http.Request) {
	s.proxyBlockscout(w, r, "/api/v2/search")
}
