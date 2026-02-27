package api

import (
	"net/http"
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

func (s *Server) handleFlowListFTTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	sort := r.URL.Query().Get("sort")
	search := strings.TrimSpace(r.URL.Query().Get("search"))

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
			tokens, err = s.repo.ListFTTokens(r.Context(), limit, offset)
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
		out = append(out, toFTListOutput(t))
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
