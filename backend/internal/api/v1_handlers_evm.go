package api

import (
	"encoding/json"
	"io"
	"log"
	"math/big"
	"net/http"
	"strings"

	"flowscan-clone/internal/repository"

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

func (s *Server) handleFlowGetEVMAddressNFTs(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+address+"/nft")
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

// handleFlowEVMAddressAllTransfers returns ERC-20/721 token transfers AND native FLOW
// value transfers for an EVM address, in the same unified format as the Cadence
// /flow/account/{address}/transfer endpoint.
func (s *Server) handleFlowEVMAddressAllTransfers(w http.ResponseWriter, r *http.Request) {
	if s.blockscoutDB == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "EVM transfer data not available")
		return
	}

	addr := normalizeAddr(mux.Vars(r)["address"])
	if addr == "" {
		writeAPIError(w, http.StatusBadRequest, "address is required")
		return
	}
	// EVM addresses are 20 bytes = 40 hex chars
	addr = strings.TrimPrefix(strings.ToLower(addr), "0x")

	limit, offset := parseLimitOffset(r)

	tokens, natives, tokenTotal, nativeTotal, err := s.blockscoutDB.ListEVMTransfersByAddress(r.Context(), addr, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	addrWith0x := "0x" + addr

	// Merge token transfers and native transfers into a single sorted list.
	// Both are already sorted by block_number DESC from the DB, so we merge-sort.
	out := make([]map[string]interface{}, 0, len(tokens)+len(natives))
	ti, ni := 0, 0

	for ti < len(tokens) || ni < len(natives) {
		useToken := false
		if ti < len(tokens) && ni < len(natives) {
			// Pick the one with higher block number (more recent).
			useToken = tokens[ti].BlockNumber >= natives[ni].BlockNumber
		} else {
			useToken = ti < len(tokens)
		}

		if useToken {
			t := tokens[ti]
			ti++
			out = append(out, toEVMTokenTransferOutput(t, addrWith0x))
		} else {
			n := natives[ni]
			ni++
			out = append(out, toEVMNativeTransferOutput(n, addrWith0x))
		}

		if len(out) >= limit {
			break
		}
	}

	total := tokenTotal + nativeTotal
	writeAPIResponse(w, out, map[string]interface{}{
		"limit":    limit,
		"offset":   offset,
		"count":    len(out),
		"has_more": total,
	}, nil)
}

// toEVMTokenTransferOutput formats a Blockscout token transfer to match our unified format.
func toEVMTokenTransferOutput(t repository.EVMTokenTransferRow, addrFilter string) map[string]interface{} {
	isNFT := t.TokenType == "ERC-721" || t.TokenType == "ERC-1155"

	item := map[string]interface{}{
		"transaction_hash": t.TxHash,
		"block_height":     t.BlockNumber,
		"timestamp":        formatTime(t.Timestamp),
		"sender":           t.FromAddress,
		"receiver":         t.ToAddress,
		"direction":        evmTransferDirection(addrFilter, t.FromAddress, t.ToAddress),
		"verified":         false,
		"is_primary":       false,
	}

	if isNFT {
		item["type"] = "nft"
		item["nft_type"] = t.TokenType
		item["nft_id"] = t.TokenID
		item["current_owner"] = t.ToAddress
		collection := map[string]interface{}{}
		if t.TokenName != "" {
			collection["name"] = t.TokenName
		}
		if t.TokenSymbol != "" {
			collection["symbol"] = t.TokenSymbol
		}
		item["collection"] = collection
		item["contract_address"] = t.ContractAddress
	} else {
		item["type"] = "ft"
		item["amount"] = weiToFloat(t.Amount, t.TokenDecimals)
		item["classifier"] = "Coin Transfer"
		item["approx_usd_price"] = 0
		item["usd_value"] = 0
		item["receiver_balance"] = 0
		item["token"] = map[string]interface{}{
			"token":    t.ContractAddress,
			"name":     t.TokenName,
			"symbol":   t.TokenSymbol,
			"decimals": t.TokenDecimals,
			"logo":     t.TokenLogo,
		}
	}

	return item
}

// toEVMNativeTransferOutput formats a native FLOW value transfer.
func toEVMNativeTransferOutput(n repository.EVMNativeTransferRow, addrFilter string) map[string]interface{} {
	return map[string]interface{}{
		"type":             "ft",
		"transaction_hash": n.TxHash,
		"block_height":     n.BlockNumber,
		"timestamp":        formatTime(n.Timestamp),
		"amount":           weiToFloat(n.Value, 18),
		"sender":           n.FromAddress,
		"receiver":         n.ToAddress,
		"direction":        evmTransferDirection(addrFilter, n.FromAddress, n.ToAddress),
		"verified":         false,
		"is_primary":       false,
		"classifier":       "Coin Transfer",
		"approx_usd_price": 0,
		"usd_value":        0,
		"receiver_balance": 0,
		"token": map[string]interface{}{
			"token":    "native",
			"name":     "FLOW",
			"symbol":   "FLOW",
			"decimals": 18,
			"logo":     "https://raw.githubusercontent.com/onflow/FRW-Assets/refs/heads/main/ft/flow/logo.png",
		},
	}
}

func evmTransferDirection(addrFilter, from, to string) string {
	addrFilter = strings.ToLower(addrFilter)
	if addrFilter != "" {
		if strings.ToLower(from) == addrFilter {
			return "withdraw"
		}
		if strings.ToLower(to) == addrFilter {
			return "deposit"
		}
	}
	return "deposit"
}

// weiToFloat converts a wei string to a float with the given decimals.
func weiToFloat(weiStr string, decimals int) float64 {
	if weiStr == "" || weiStr == "0" {
		return 0
	}
	val, ok := new(big.Float).SetString(weiStr)
	if !ok {
		return 0
	}
	divisor := new(big.Float).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil))
	result, _ := new(big.Float).Quo(val, divisor).Float64()
	return result
}
