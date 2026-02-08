package api

import (
	"net/http"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

func (s *Server) handleFlowListTransactions(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	includeEvents := strings.ToLower(r.URL.Query().Get("include_events")) == "true"
	f := repository.TransactionFilter{
		Height:        height,
		Payer:         normalizeAddr(r.URL.Query().Get("payer")),
		Proposer:      normalizeAddr(r.URL.Query().Get("proposer")),
		Authorizer:    normalizeAddr(r.URL.Query().Get("authorizers")),
		Status:        strings.TrimSpace(r.URL.Query().Get("status")),
		Limit:         limit,
		Offset:        offset,
		IncludeEvents: includeEvents,
	}
	txs, err := s.repo.ListTransactionsFiltered(r.Context(), f)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	txIDs := collectTxIDs(txs)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), txIDs)
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), txIDs)
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), txIDs)
	eventsByTx := make(map[string][]models.Event)
	if includeEvents {
		events, _ := s.repo.GetEventsByTransactionIDs(r.Context(), txIDs)
		for _, e := range events {
			eventsByTx[e.TransactionID] = append(eventsByTx[e.TransactionID], e)
		}
	}
	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, eventsByTx[t.ID], contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetTransaction(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	tx, err := s.repo.GetTransactionByID(r.Context(), id)
	if err != nil || tx == nil {
		writeAPIError(w, http.StatusNotFound, "transaction not found")
		return
	}
	events, _ := s.repo.GetEventsByTransactionID(r.Context(), tx.ID)
	contracts, _ := s.repo.GetTxContractsByTransactionIDs(r.Context(), []string{tx.ID})
	tags, _ := s.repo.GetTxTagsByTransactionIDs(r.Context(), []string{tx.ID})
	feesByTx, _ := s.repo.GetTransactionFeesByIDs(r.Context(), []string{tx.ID})
	out := toFlowTransactionOutput(*tx, events, contracts[tx.ID], tags[tx.ID], feesByTx[tx.ID])
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}
