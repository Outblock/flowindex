package api

import (
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
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr)
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
