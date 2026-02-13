package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"flowscan-clone/internal/models"

	"github.com/gorilla/mux"
)

// adminAuthMiddleware checks for a valid admin token in the Authorization header.
// Token is read from ADMIN_TOKEN env var.
func adminAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}
		token := os.Getenv("ADMIN_TOKEN")
		if token == "" {
			writeAPIError(w, http.StatusForbidden, "admin API is disabled (no ADMIN_TOKEN configured)")
			return
		}
		auth := r.Header.Get("Authorization")
		auth = strings.TrimPrefix(auth, "Bearer ")
		auth = strings.TrimSpace(auth)
		if auth != token {
			writeAPIError(w, http.StatusUnauthorized, "invalid admin token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- FT Token CRUD ---

func (s *Server) handleAdminListFTTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	search := strings.TrimSpace(r.URL.Query().Get("search"))

	tokens, err := s.repo.AdminListFTTokens(r.Context(), search, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(tokens))
	for _, t := range tokens {
		out = append(out, ftTokenToAdmin(t))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleAdminUpdateFTToken(w http.ResponseWriter, r *http.Request) {
	identifier := mux.Vars(r)["identifier"]
	address, name, _ := splitContractIdentifier(identifier)
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid identifier (use A.address.ContractName)")
		return
	}

	var body struct {
		Name        *string `json:"name"`
		Symbol      *string `json:"symbol"`
		Logo        *string `json:"logo"`
		Description *string `json:"description"`
		ExternalURL *string `json:"external_url"`
		Decimals    *int    `json:"decimals"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	updates := map[string]interface{}{}
	if body.Name != nil {
		updates["name"] = *body.Name
	}
	if body.Symbol != nil {
		updates["symbol"] = *body.Symbol
	}
	if body.Logo != nil {
		updates["logo"] = *body.Logo
	}
	if body.Description != nil {
		updates["description"] = *body.Description
	}
	if body.ExternalURL != nil {
		updates["external_url"] = *body.ExternalURL
	}
	if body.Decimals != nil {
		updates["decimals"] = *body.Decimals
	}
	if len(updates) == 0 {
		writeAPIError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	if err := s.repo.AdminUpdateFTToken(r.Context(), address, name, updates); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"updated": true, "identifier": identifier}, nil, nil)
}

// --- NFT Collection CRUD ---

func (s *Server) handleAdminListNFTCollections(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	search := strings.TrimSpace(r.URL.Query().Get("search"))

	collections, err := s.repo.AdminListNFTCollections(r.Context(), search, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(collections))
	for _, c := range collections {
		out = append(out, nftCollectionToAdmin(c))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleAdminUpdateNFTCollection(w http.ResponseWriter, r *http.Request) {
	identifier := mux.Vars(r)["identifier"]
	address, name, _ := splitContractIdentifier(identifier)
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid identifier (use A.address.ContractName)")
		return
	}

	var body struct {
		Name        *string `json:"name"`
		Symbol      *string `json:"symbol"`
		SquareImage *string `json:"square_image"`
		BannerImage *string `json:"banner_image"`
		Description *string `json:"description"`
		ExternalURL *string `json:"external_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	updates := map[string]interface{}{}
	if body.Name != nil {
		updates["name"] = *body.Name
	}
	if body.Symbol != nil {
		updates["symbol"] = *body.Symbol
	}
	if body.SquareImage != nil {
		updates["square_image"] = *body.SquareImage
	}
	if body.BannerImage != nil {
		updates["banner_image"] = *body.BannerImage
	}
	if body.Description != nil {
		updates["description"] = *body.Description
	}
	if body.ExternalURL != nil {
		updates["external_url"] = *body.ExternalURL
	}
	if len(updates) == 0 {
		writeAPIError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	if err := s.repo.AdminUpdateNFTCollection(r.Context(), address, name, updates); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"updated": true, "identifier": identifier}, nil, nil)
}

// --- output helpers ---

func ftTokenToAdmin(t models.FTToken) map[string]interface{} {
	return map[string]interface{}{
		"identifier":       formatTokenIdentifier(t.ContractAddress, t.ContractName),
		"contract_address": formatAddressV1(t.ContractAddress),
		"contract_name":    t.ContractName,
		"name":             t.Name,
		"symbol":           t.Symbol,
		"decimals":         t.Decimals,
		"description":      t.Description,
		"external_url":     t.ExternalURL,
		"logo":             t.Logo,
		"updated_at":       formatTime(t.UpdatedAt),
	}
}

func nftCollectionToAdmin(c models.NFTCollection) map[string]interface{} {
	return map[string]interface{}{
		"identifier":       formatTokenIdentifier(c.ContractAddress, c.ContractName),
		"contract_address": formatAddressV1(c.ContractAddress),
		"contract_name":    c.ContractName,
		"name":             c.Name,
		"symbol":           c.Symbol,
		"description":      c.Description,
		"external_url":     c.ExternalURL,
		"square_image":     c.SquareImage,
		"banner_image":     c.BannerImage,
		"updated_at":       formatTime(c.UpdatedAt),
	}
}
