package api

import (
	"net/http"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

func (s *Server) handleFlowFTTransfers(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	addrFilter := normalizeAddr(r.URL.Query().Get("address"))
	tokenAddr, tokenName := parseTokenParam(r.URL.Query().Get("token"))
	transfers, hasMore, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, addrFilter, tokenAddr, tokenName, r.URL.Query().Get("transaction_hash"), height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ftIDs := collectTransferTokenIDs(transfers, false)
	ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		id := formatTokenVaultIdentifier(t.TokenContractAddress, t.ContractName)
		var m *repository.TokenMetadataInfo
		if meta, ok := ftMeta[id]; ok {
			m = &meta
		}
		var usdPrice float64
		if m != nil && m.MarketSymbol != "" {
			usdPrice, _ = s.priceCache.GetPriceAt(m.MarketSymbol, t.TokenTransfer.Timestamp)
		} else if t.ContractName == "FlowToken" {
			usdPrice, _ = s.priceCache.GetPriceAt("FLOW", t.TokenTransfer.Timestamp)
		}
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, addrFilter, m, usdPrice))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

// handleFlowAllTransfers returns FT and NFT transfers merged in chronological order.
// Registered at both /flow/transfer (global) and /flow/account/{address}/transfer (per-account).
func (s *Server) handleFlowAllTransfers(w http.ResponseWriter, r *http.Request) {
	// Support both path param (account endpoint) and query param (global endpoint).
	address := normalizeAddr(mux.Vars(r)["address"])
	if address == "" {
		address = normalizeAddr(r.URL.Query().Get("address"))
	}
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	txHash := r.URL.Query().Get("transaction_hash")

	transfers, total, err := s.repo.ListAllTransfersFiltered(r.Context(), address, txHash, height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Split into FT/NFT for separate metadata lookups.
	var ftSlice, nftSlice []repository.TokenTransferWithContract
	for _, t := range transfers {
		if t.IsNFT {
			nftSlice = append(nftSlice, t)
		} else {
			ftSlice = append(ftSlice, t)
		}
	}
	ftIDs := collectTransferTokenIDs(ftSlice, false)
	nftIDs := collectTransferTokenIDs(nftSlice, true)
	ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)
	nftMeta, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), nftIDs)

	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		if t.IsNFT {
			id := formatTokenIdentifier(t.TokenContractAddress, t.ContractName)
			var m *repository.TokenMetadataInfo
			if meta, ok := nftMeta[id]; ok {
				m = &meta
			}
			item := toNFTTransferOutput(t.TokenTransfer, t.ContractName, address, m)
			item["type"] = "nft"
			out = append(out, item)
		} else {
			id := formatTokenVaultIdentifier(t.TokenContractAddress, t.ContractName)
			var m *repository.TokenMetadataInfo
			if meta, ok := ftMeta[id]; ok {
				m = &meta
			}
			var usdPrice float64
			if m != nil && m.MarketSymbol != "" {
				usdPrice, _ = s.priceCache.GetPriceAt(m.MarketSymbol, t.TokenTransfer.Timestamp)
			} else if t.ContractName == "FlowToken" {
				usdPrice, _ = s.priceCache.GetPriceAt("FLOW", t.TokenTransfer.Timestamp)
			}
			item := toFTTransferOutput(t.TokenTransfer, t.ContractName, address, m, usdPrice)
			item["type"] = "ft"
			out = append(out, item)
		}
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": total}, nil)
}

func (s *Server) handleFlowFTTokenStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetFTTokenStats(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, nil, nil)
}

func (s *Server) handleFlowListFTTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	sort := r.URL.Query().Get("sort")
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	filter := strings.TrimSpace(r.URL.Query().Get("filter"))

	var tokens []models.FTToken
	var total int64
	var err error

	if search != "" {
		tokens, total, err = s.repo.SearchFTTokens(r.Context(), search, limit, offset)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
	} else {
		if sort == "trending" {
			tokens, err = s.repo.ListTrendingFTTokens(r.Context(), limit, offset)
		} else {
			tokens, err = s.repo.ListFTTokens(r.Context(), limit, offset, filter)
		}
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}

		total, err = s.repo.CountFTTokens(r.Context())
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}

		if len(tokens) == 0 {
			contracts, err := s.repo.ListFTTokenContracts(r.Context(), limit, offset)
			if err != nil {
				writeAPIError(w, http.StatusInternalServerError, err.Error())
				return
			}
			for _, row := range contracts {
				tokens = append(tokens, models.FTToken{ContractAddress: row.Address, ContractName: row.Name})
			}
			if total == 0 {
				if n, err := s.repo.CountFTTokenContracts(r.Context()); err == nil {
					total = n
				}
			}
		}
	}

	out := make([]map[string]interface{}, 0, len(tokens))
	for _, t := range tokens {
		m := toFTListOutput(t)
		if t.MarketSymbol != "" {
			if price, change, ok := s.priceCache.GetLatestPriceWithChange(t.MarketSymbol); ok {
				m["current_price"] = price
				m["price_change_24h"] = change
			}
		}
		out = append(out, m)
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowGetFTToken(w http.ResponseWriter, r *http.Request) {
	tokenAddr, tokenName := parseTokenParam(mux.Vars(r)["token"])
	t, err := s.repo.GetFTToken(r.Context(), tokenAddr, tokenName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeAPIResponse(w, []interface{}{toFTListOutput(models.FTToken{ContractAddress: tokenAddr, ContractName: tokenName})}, nil, nil)
		return
	}
	out := toFTListOutput(*t)
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

func (s *Server) handleFlowFTHoldingsByToken(w http.ResponseWriter, r *http.Request) {
	tokenAddr, tokenName := parseTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByToken(r.Context(), tokenAddr, tokenName, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	total, err := s.repo.CountFTHoldingsByToken(r.Context(), tokenAddr, tokenName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowTopFTAccounts(w http.ResponseWriter, r *http.Request) {
	tokenAddr, tokenName := parseTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByToken(r.Context(), tokenAddr, tokenName, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	total, err := s.repo.CountFTHoldingsByToken(r.Context(), tokenAddr, tokenName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowFTTokenPrices(w http.ResponseWriter, r *http.Request) {
	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 365 {
			days = v
		}
	}
	// Build market_symbol -> []identifier mapping (e.g. "FLOW" -> ["A.1654653399040a61.FlowToken"])
	symToIDs, _ := s.repo.GetMarketSymbolToIdentifiers(r.Context())

	allPrices := s.priceCache.GetAllLatestPrices()
	out := make(map[string]interface{}, len(allPrices))
	for symbol := range allPrices {
		history := s.priceCache.GetRecentPrices(symbol, days)
		if len(history) == 0 {
			continue
		}
		points := make([]map[string]interface{}, 0, len(history))
		for _, p := range history {
			points = append(points, map[string]interface{}{
				"date":  p.Date.Format("2006-01-02"),
				"price": p.Price,
			})
		}
		entry := map[string]interface{}{
			"current": history[len(history)-1].Price,
			"history": points,
		}
		if ids, ok := symToIDs[symbol]; ok && len(ids) > 0 {
			entry["identifiers"] = ids
		}
		out[symbol] = entry
	}
	writeAPIResponse(w, out, nil, nil)
}

func (s *Server) handleFlowAccountFTHoldingByToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	tokenAddr, tokenName := parseTokenParam(mux.Vars(r)["token"])
	holding, err := s.repo.GetFTHolding(r.Context(), address, tokenAddr, tokenName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if holding == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toVaultOutput(*holding)}, nil, nil)
}
