package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"

	"github.com/gorilla/mux"
)

func (s *Server) handleFlowListBlocks(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	if heightParam := r.URL.Query().Get("height"); heightParam != "" {
		height, err := strconv.ParseUint(heightParam, 10, 64)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid height")
			return
		}
		block, err := s.repo.GetBlockByHeight(r.Context(), height)
		if err != nil {
			writeAPIResponse(w, []interface{}{}, map[string]interface{}{"limit": limit, "offset": offset}, nil)
			return
		}
		writeAPIResponse(w, []interface{}{toFlowBlockOutput(*block)}, map[string]interface{}{"limit": 1, "offset": 0}, nil)
		return
	}

	blocks, err := s.repo.ListBlocks(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(blocks))
	for _, b := range blocks {
		out = append(out, toFlowBlockOutput(b))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleFlowGetBlock(w http.ResponseWriter, r *http.Request) {
	heightStr := mux.Vars(r)["height"]
	height, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	block, err := s.repo.GetBlockByHeight(r.Context(), height)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "block not found")
		return
	}
	writeAPIResponse(w, []interface{}{toFlowBlockOutput(*block)}, nil, nil)
}

func (s *Server) handleFlowBlockTransactions(w http.ResponseWriter, r *http.Request) {
	heightStr := mux.Vars(r)["height"]
	height, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	includeEvents := strings.ToLower(r.URL.Query().Get("include_events")) == "true"
	txs, err := s.repo.ListTransactionsByBlock(r.Context(), height, includeEvents)
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
		for _, tx := range txs {
			eventsByTx[tx.ID] = tx.Events
		}
	}
	templates, _ := s.repo.GetScriptTemplatesByTxIDs(r.Context(), txIDs)
	out := make([]map[string]interface{}, 0, len(txs))
	for _, t := range txs {
		out = append(out, toFlowTransactionOutput(t, eventsByTx[t.ID], contracts[t.ID], tags[t.ID], feesByTx[t.ID]))
	}
	enrichWithTemplates(out, templates)
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

func (s *Server) handleFlowBlockServiceEvents(w http.ResponseWriter, r *http.Request) {
	heightStr := mux.Vars(r)["height"]
	height, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	events, err := s.repo.GetEventsByBlockHeight(r.Context(), height)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0)
	for _, e := range events {
		contractName := strings.ToLower(e.ContractName)
		if contractName == "" {
			parts := strings.SplitN(e.Type, ".", 2)
			if len(parts) > 0 {
				contractName = strings.ToLower(parts[0])
			}
		}
		if contractName != "flow" {
			continue
		}
		var fields interface{}
		_ = json.Unmarshal(e.Payload, &fields)
		out = append(out, map[string]interface{}{
			"block_height": e.BlockHeight,
			"name":         e.EventName,
			"timestamp":    formatTime(e.Timestamp),
			"fields":       fields,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}
