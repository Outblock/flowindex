package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

func (s *Server) handleAdminListScriptTemplates(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	labeledOnly := r.URL.Query().Get("labeled") == "true"

	templates, err := s.repo.AdminListScriptTemplates(r.Context(), search, category, labeledOnly, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(templates))
	for _, t := range templates {
		out = append(out, map[string]interface{}{
			"script_hash":    t.ScriptHash,
			"category":       t.Category,
			"label":          t.Label,
			"description":    t.Description,
			"tx_count":       t.TxCount,
			"script_preview": t.ScriptPreview,
			"created_at":     formatTime(t.CreatedAt),
			"updated_at":     formatTime(t.UpdatedAt),
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleAdminGetScriptTemplateStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.AdminGetScriptTemplateStats(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{
		"total":        stats.Total,
		"labeled":      stats.Labeled,
		"unlabeled":    stats.Unlabeled,
		"coverage_pct": stats.CoveragePct,
		"labeled_tx":   stats.LabeledTx,
		"total_tx":     stats.TotalTx,
	}, nil, nil)
}

func (s *Server) handleAdminRefreshScriptTemplateCounts(w http.ResponseWriter, r *http.Request) {
	updated, err := s.repo.AdminRefreshScriptTemplateCounts(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"refreshed": true, "updated_rows": updated}, nil, nil)
}

func (s *Server) handleAdminUpdateScriptTemplate(w http.ResponseWriter, r *http.Request) {
	hash := mux.Vars(r)["hash"]
	if hash == "" {
		writeAPIError(w, http.StatusBadRequest, "hash is required")
		return
	}

	var body struct {
		Category    *string `json:"category"`
		Label       *string `json:"label"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	category := ""
	label := ""
	description := ""
	if body.Category != nil {
		category = *body.Category
	}
	if body.Label != nil {
		label = *body.Label
	}
	if body.Description != nil {
		description = *body.Description
	}

	if err := s.repo.AdminUpdateScriptTemplate(r.Context(), hash, category, label, description); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"updated": true, "script_hash": hash}, nil, nil)
}

func (s *Server) handleAdminGetScriptText(w http.ResponseWriter, r *http.Request) {
	hash := mux.Vars(r)["hash"]
	if hash == "" {
		writeAPIError(w, http.StatusBadRequest, "hash is required")
		return
	}

	text, err := s.repo.AdminGetScriptText(r.Context(), hash)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "script not found")
		return
	}
	writeAPIResponse(w, map[string]interface{}{"script_hash": hash, "script_text": text}, nil, nil)
}
