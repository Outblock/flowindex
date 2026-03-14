package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/models"
)

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

// SearchPreviewTxResponse is the response for type=tx search preview.
type SearchPreviewTxResponse struct {
	Query   string                 `json:"query"`
	Cadence *SearchPreviewCadence  `json:"cadence"`
	EVM     *SearchPreviewEVM      `json:"evm"`
	Link    *SearchPreviewTxLink   `json:"link"`
}

// SearchPreviewCadence holds Cadence transaction details.
type SearchPreviewCadence struct {
	ID              string   `json:"id"`
	Status          string   `json:"status"`
	BlockHeight     uint64   `json:"block_height"`
	Timestamp       string   `json:"timestamp"`
	Authorizers     []string `json:"authorizers"`
	IsEVM           bool     `json:"is_evm"`
	ExecutionStatus string   `json:"execution_status"`
	GasUsed         uint64   `json:"gas_used"`
}

// SearchPreviewEVM holds EVM transaction details from Blockscout.
type SearchPreviewEVM struct {
	Hash     string      `json:"hash"`
	Status   interface{} `json:"status"`
	From     interface{} `json:"from"`
	To       interface{} `json:"to"`
	Value    interface{} `json:"value"`
	GasUsed  interface{} `json:"gas_used"`
	Method   interface{} `json:"method"`
	Block    interface{} `json:"block"`
	TxTypes  interface{} `json:"tx_types,omitempty"`
}

// SearchPreviewTxLink connects Cadence and EVM transactions.
type SearchPreviewTxLink struct {
	CadenceTxID *string `json:"cadence_tx_id"`
	EVMHash     *string `json:"evm_hash"`
}

// SearchPreviewAddressResponse is the response for type=address search preview.
type SearchPreviewAddressResponse struct {
	Query   string                    `json:"query"`
	Cadence *SearchPreviewAddrCadence `json:"cadence"`
	EVM     *SearchPreviewAddrEVM     `json:"evm"`
	Link    *SearchPreviewAddrLink    `json:"link"`
}

// SearchPreviewAddrCadence holds Cadence address details.
type SearchPreviewAddrCadence struct {
	Address       string `json:"address"`
	ContractCount int    `json:"contract_count"`
	HasActiveKeys bool   `json:"has_active_keys"`
}

// SearchPreviewAddrEVM holds EVM address details from Blockscout.
type SearchPreviewAddrEVM struct {
	Address       interface{} `json:"address"`
	IsContract    interface{} `json:"is_contract"`
	Name          interface{} `json:"name"`
	TokenName     interface{} `json:"token_name,omitempty"`
	TokenSymbol   interface{} `json:"token_symbol,omitempty"`
	TxCount       interface{} `json:"tx_count,omitempty"`
	Balance       interface{} `json:"balance,omitempty"`
}

// SearchPreviewAddrLink connects Flow and EVM addresses via COA.
type SearchPreviewAddrLink struct {
	FlowAddress *string `json:"flow_address"`
	COAAddress  *string `json:"coa_address"`
}

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

var (
	hexPattern  = regexp.MustCompile(`^(0x)?[0-9a-fA-F]+$`)
)

// isFlowAddress returns true for 16 hex-char Flow addresses (with optional 0x prefix).
func isFlowAddress(s string) bool {
	clean := strings.TrimPrefix(strings.ToLower(s), "0x")
	return len(clean) == 16 && hexPattern.MatchString(clean)
}

// isEVMAddress returns true for 40 hex-char EVM addresses (with optional 0x prefix).
func isEVMAddress(s string) bool {
	clean := strings.TrimPrefix(strings.ToLower(s), "0x")
	return len(clean) == 40 && hexPattern.MatchString(clean)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

func (s *Server) handleSearchPreview(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeAPIError(w, http.StatusBadRequest, "q parameter is required")
		return
	}
	if len(q) > 130 {
		writeAPIError(w, http.StatusBadRequest, "query too long")
		return
	}

	searchType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))

	switch searchType {
	case "tx":
		s.handleSearchPreviewTx(w, r, q)
	case "address":
		s.handleSearchPreviewAddress(w, r, q)
	default:
		writeAPIError(w, http.StatusBadRequest, "type must be 'tx' or 'address'")
	}
}

// ---------------------------------------------------------------------------
// type=tx
// ---------------------------------------------------------------------------

func (s *Server) handleSearchPreviewTx(w http.ResponseWriter, r *http.Request, query string) {
	ctx := r.Context()
	hash := normalizeAddr(query) // strips 0x, lowercases

	var (
		mu          sync.Mutex
		cadenceTx   *models.Transaction
		evmParentID string   // Cadence tx ID resolved from EVM hash lookup
		bsData      map[string]interface{}
		wg          sync.WaitGroup
	)

	// 1) Local DB: direct Cadence tx lookup
	wg.Add(1)
	go func() {
		defer wg.Done()
		tx, err := s.repo.GetTransactionByID(ctx, hash)
		if err != nil {
			log.Printf("search-preview tx cadence lookup: %v", err)
			return
		}
		mu.Lock()
		cadenceTx = tx
		mu.Unlock()
	}()

	// 2) Local DB: EVM hash -> parent Cadence tx
	wg.Add(1)
	go func() {
		defer wg.Done()
		parentID, err := s.repo.LookupCadenceTxByEVMHash(ctx, hash)
		if err != nil {
			log.Printf("search-preview evm->cadence lookup: %v", err)
			return
		}
		mu.Lock()
		evmParentID = parentID
		mu.Unlock()
	}()

	// 3) Blockscout: EVM tx details
	wg.Add(1)
	go func() {
		defer wg.Done()
		if s.blockscoutURL == "" {
			return
		}
		bsCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()

		url := fmt.Sprintf("%s/api/v2/transactions/0x%s", s.blockscoutURL, hash)
		if s.blockscoutAPIKey != "" {
			url += "?apikey=" + s.blockscoutAPIKey
		}
		req, err := http.NewRequestWithContext(bsCtx, http.MethodGet, url, nil)
		if err != nil {
			return
		}
		req.Header.Set("Accept", "application/json")

		resp, err := blockscoutClient.Do(req)
		if err != nil {
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		if err != nil {
			return
		}

		var data map[string]interface{}
		if err := json.Unmarshal(body, &data); err != nil {
			return
		}

		mu.Lock()
		bsData = data
		mu.Unlock()
	}()

	wg.Wait()

	// Follow-up: if EVM hash resolved to a Cadence parent but we didn't find it directly
	if evmParentID != "" && cadenceTx == nil {
		tx, err := s.repo.GetTransactionByID(ctx, evmParentID)
		if err != nil {
			log.Printf("search-preview follow-up cadence lookup: %v", err)
		} else {
			cadenceTx = tx
		}
	}

	// Build response
	resp := SearchPreviewTxResponse{Query: query}

	if cadenceTx != nil {
		resp.Cadence = &SearchPreviewCadence{
			ID:              cadenceTx.ID,
			Status:          cadenceTx.Status,
			BlockHeight:     cadenceTx.BlockHeight,
			Timestamp:       cadenceTx.Timestamp.UTC().Format(time.RFC3339),
			Authorizers:     cadenceTx.Authorizers,
			IsEVM:           cadenceTx.IsEVM,
			ExecutionStatus: cadenceTx.ExecutionStatus,
			GasUsed:         cadenceTx.GasUsed,
		}

		// If cadence tx is EVM, try to find the EVM hash
		if cadenceTx.IsEVM {
			evmHash := cadenceTx.EVMHash
			if evmHash == "" {
				// Lookup from evm_tx_hashes table
				h, err := s.repo.LookupEVMHashByCadenceTx(ctx, cadenceTx.ID)
				if err != nil {
					log.Printf("search-preview evm hash lookup: %v", err)
				} else {
					evmHash = h
				}
			}
			if evmHash != "" {
				prefixed := "0x" + strings.TrimPrefix(evmHash, "0x")
				resp.Link = &SearchPreviewTxLink{
					CadenceTxID: strPtr(cadenceTx.ID),
					EVMHash:     &prefixed,
				}
			}
		}
	}

	if bsData != nil {
		resp.EVM = &SearchPreviewEVM{
			Hash:    safeString(bsData, "hash"),
			Status:  bsData["status"],
			From:    extractNestedField(bsData, "from", "hash"),
			To:      extractNestedField(bsData, "to", "hash"),
			Value:   bsData["value"],
			GasUsed: bsData["gas_used"],
			Method:  bsData["method"],
			Block:   bsData["block"],
			TxTypes: bsData["tx_types"],
		}
	}

	// Build link from EVM parent resolution (if we found an EVM->Cadence mapping)
	if resp.Link == nil && evmParentID != "" {
		prefixed := "0x" + hash
		resp.Link = &SearchPreviewTxLink{
			CadenceTxID: &evmParentID,
			EVMHash:     &prefixed,
		}
	}

	writeAPIResponse(w, resp, nil, nil)
}

// ---------------------------------------------------------------------------
// type=address
// ---------------------------------------------------------------------------

func (s *Server) handleSearchPreviewAddress(w http.ResponseWriter, r *http.Request, query string) {
	ctx := r.Context()
	addr := normalizeAddr(query)

	isFlow := isFlowAddress(addr)
	isEVM := isEVMAddress(addr)

	if !isFlow && !isEVM {
		writeAPIError(w, http.StatusBadRequest, "invalid address format: expected 16 hex (Flow) or 40 hex (EVM)")
		return
	}

	var (
		mu            sync.Mutex
		coaLink       *SearchPreviewAddrLink
		cadenceData   *SearchPreviewAddrCadence
		evmData       *SearchPreviewAddrEVM
		wg            sync.WaitGroup
	)

	// 1) COA link lookup
	wg.Add(1)
	go func() {
		defer wg.Done()
		var link SearchPreviewAddrLink
		if isFlow {
			coa, err := s.repo.GetCOAByFlowAddress(ctx, addr)
			if err != nil {
				log.Printf("search-preview coa-by-flow lookup: %v", err)
				return
			}
			if coa != nil {
				link.FlowAddress = &coa.FlowAddress
				link.COAAddress = &coa.COAAddress
			}
		} else {
			coa, err := s.repo.GetFlowAddressByCOA(ctx, addr)
			if err != nil {
				log.Printf("search-preview flow-by-coa lookup: %v", err)
				return
			}
			if coa != nil {
				link.FlowAddress = &coa.FlowAddress
				link.COAAddress = &coa.COAAddress
			}
		}
		if link.FlowAddress != nil || link.COAAddress != nil {
			mu.Lock()
			coaLink = &link
			mu.Unlock()
		}
	}()

	// 2) Cadence data (if Flow address)
	if isFlow {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var cd SearchPreviewAddrCadence
			cd.Address = addr

			var wg2 sync.WaitGroup
			wg2.Add(2)
			go func() {
				defer wg2.Done()
				cnt, err := s.repo.GetAddressContractCount(ctx, addr)
				if err != nil {
					log.Printf("search-preview contract count: %v", err)
					return
				}
				cd.ContractCount = cnt
			}()
			go func() {
				defer wg2.Done()
				has, err := s.repo.GetAddressHasActiveKeys(ctx, addr)
				if err != nil {
					log.Printf("search-preview active keys: %v", err)
					return
				}
				cd.HasActiveKeys = has
			}()
			wg2.Wait()

			mu.Lock()
			cadenceData = &cd
			mu.Unlock()
		}()
	}

	// 3) EVM data from Blockscout (if EVM address)
	if isEVM {
		wg.Add(1)
		go func() {
			defer wg.Done()
			evmInfo := fetchBlockscoutAddress(ctx, s.blockscoutURL, s.blockscoutAPIKey, addr)
			if evmInfo != nil {
				mu.Lock()
				evmData = evmInfo
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	// Follow-up: if COA link resolved, fetch the other side's data
	if coaLink != nil {
		if isFlow && coaLink.COAAddress != nil && evmData == nil {
			// We have a Flow address with a COA link, fetch EVM data for the COA
			evmInfo := fetchBlockscoutAddress(ctx, s.blockscoutURL, s.blockscoutAPIKey, *coaLink.COAAddress)
			if evmInfo != nil {
				evmData = evmInfo
			}
		}
		if isEVM && coaLink.FlowAddress != nil && cadenceData == nil {
			// We have an EVM address with a COA link, fetch Cadence data for the Flow address
			flowAddr := *coaLink.FlowAddress
			var cd SearchPreviewAddrCadence
			cd.Address = flowAddr

			var wg2 sync.WaitGroup
			wg2.Add(2)
			go func() {
				defer wg2.Done()
				cnt, err := s.repo.GetAddressContractCount(ctx, flowAddr)
				if err == nil {
					cd.ContractCount = cnt
				}
			}()
			go func() {
				defer wg2.Done()
				has, err := s.repo.GetAddressHasActiveKeys(ctx, flowAddr)
				if err == nil {
					cd.HasActiveKeys = has
				}
			}()
			wg2.Wait()
			cadenceData = &cd
		}
	}

	resp := SearchPreviewAddressResponse{
		Query:   query,
		Cadence: cadenceData,
		EVM:     evmData,
		Link:    coaLink,
	}

	writeAPIResponse(w, resp, nil, nil)
}

// ---------------------------------------------------------------------------
// Blockscout helpers
// ---------------------------------------------------------------------------

func fetchBlockscoutAddress(ctx context.Context, blockscoutURL, apiKey, addr string) *SearchPreviewAddrEVM {
	if blockscoutURL == "" {
		return nil
	}

	bsCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	url := fmt.Sprintf("%s/api/v2/addresses/0x%s", blockscoutURL, strings.TrimPrefix(addr, "0x"))
	if apiKey != "" {
		url += "?apikey=" + apiKey
	}
	req, err := http.NewRequestWithContext(bsCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")

	resp, err := blockscoutClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil
	}

	return &SearchPreviewAddrEVM{
		Address:     extractNestedField(data, "hash", ""),
		IsContract:  data["is_contract"],
		Name:        data["name"],
		TokenName:   extractNestedField(data, "token", "name"),
		TokenSymbol: extractNestedField(data, "token", "symbol"),
		TxCount:     data["transactions_count"],
		Balance:     data["coin_balance"],
	}
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func safeString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func extractNestedField(m map[string]interface{}, key1, key2 string) interface{} {
	if key2 == "" {
		return m[key1]
	}
	if nested, ok := m[key1]; ok {
		if nm, ok := nested.(map[string]interface{}); ok {
			return nm[key2]
		}
	}
	return nil
}

func strPtr(s string) *string {
	return &s
}
