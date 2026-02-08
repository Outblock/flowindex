package api

import (
	"net/http"

	"flowscan-clone/internal/models"

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
	transfers, total, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), false, addrFilter, normalizeTokenParam(r.URL.Query().Get("token")), r.URL.Query().Get("transaction_hash"), height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, addrFilter))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowListFTTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	tokens, err := s.repo.ListFTTokens(r.Context(), limit, offset)
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
		for _, addr := range contracts {
			tokens = append(tokens, models.FTToken{ContractAddress: addr})
		}
	}
	out := make([]map[string]interface{}, 0, len(tokens))
	for _, t := range tokens {
		out = append(out, toFTListOutput(t))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetFTToken(w http.ResponseWriter, r *http.Request) {
	token := normalizeTokenParam(mux.Vars(r)["token"])
	t, err := s.repo.GetFTToken(r.Context(), token)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeAPIResponse(w, []interface{}{toFTListOutput(models.FTToken{ContractAddress: token})}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toFTListOutput(*t)}, nil, nil)
}

func (s *Server) handleFlowFTHoldingsByToken(w http.ResponseWriter, r *http.Request) {
	token := normalizeTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByToken(r.Context(), token, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowTopFTAccounts(w http.ResponseWriter, r *http.Request) {
	token := normalizeTokenParam(mux.Vars(r)["token"])
	limit, offset := parseLimitOffset(r)
	holdings, err := s.repo.ListFTHoldingsByToken(r.Context(), token, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(holdings))
	for _, h := range holdings {
		out = append(out, toFTHoldingOutput(h, 0))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowAccountFTHoldingByToken(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	token := normalizeTokenParam(mux.Vars(r)["token"])
	holding, err := s.repo.GetFTHolding(r.Context(), address, token)
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
