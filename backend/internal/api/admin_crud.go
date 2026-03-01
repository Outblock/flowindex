package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"

	"flowscan-clone/internal/models"

	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	adminAuthzDBOnce sync.Once
	adminAuthzDBPool *pgxpool.Pool
	adminAuthzDBErr  error
)

// adminAuthMiddleware supports two auth methods:
// 1) Legacy static ADMIN_TOKEN (kept for emergency fallback)
// 2) JWT (ADMIN_JWT_SECRET or SUPABASE_JWT_SECRET) with role/team claims
//
// JWT authorization rules (table-first):
// - If SUPABASE_DB_URL is configured, /admin auth checks table-driven RBAC:
//   - public.user_platform_roles.role
//   - public.team_memberships(team_id,user_id,role,status) + public.teams.slug
//
// - If user has no RBAC rows yet, it falls back to JWT claims for compatibility.
//
// JWT claim authorization rules (fallback):
//   - ADMIN_ALLOWED_ROLES (csv, default: "platform_admin,ops_admin,admin")
//     must match at least one role claim
//   - ADMIN_ALLOWED_TEAMS (csv, optional) if set, must match at least one team claim
//
// Canonical role names used by FlowIndex:
// - platform_admin: full platform administration (can access /admin)
// - ops_admin: operational administration (can access /admin)
// - team_admin: team-level admin (no /admin access by default)
// - team_member: regular team member (no /admin access by default)
func adminAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		bearer := extractBearerToken(r.Header.Get("Authorization"))
		if bearer == "" {
			writeAPIError(w, http.StatusUnauthorized, "missing Authorization bearer token")
			return
		}

		// Legacy static admin token path (fallback).
		if staticToken := strings.TrimSpace(os.Getenv("ADMIN_TOKEN")); staticToken != "" {
			if subtle.ConstantTimeCompare([]byte(bearer), []byte(staticToken)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
		}

		jwtSecret := strings.TrimSpace(os.Getenv("ADMIN_JWT_SECRET"))
		if jwtSecret == "" {
			jwtSecret = strings.TrimSpace(os.Getenv("SUPABASE_JWT_SECRET"))
		}
		if jwtSecret == "" {
			writeAPIError(w, http.StatusForbidden, "admin API is disabled (set ADMIN_TOKEN or ADMIN_JWT_SECRET/SUPABASE_JWT_SECRET)")
			return
		}

		claims, err := parseAndValidateAdminJWT(bearer, jwtSecret)
		if err != nil {
			writeAPIError(w, http.StatusUnauthorized, fmt.Sprintf("invalid admin JWT: %v", err))
			return
		}

		sub, _ := claims["sub"].(string)
		allowedRoles := parseCSVSet(os.Getenv("ADMIN_ALLOWED_ROLES"))
		if len(allowedRoles) == 0 {
			allowedRoles = map[string]struct{}{
				"platform_admin": {},
				"ops_admin":      {},
				// Backward compatibility for previously issued claims.
				"admin": {},
			}
		}
		allowedTeams := parseCSVSet(os.Getenv("ADMIN_ALLOWED_TEAMS"))

		// Prefer table-driven RBAC from Supabase DB.
		if strings.TrimSpace(sub) != "" {
			dbAllowed, hasAssignments, denyReason, dbErr := authorizeAdminViaDB(r.Context(), sub, allowedRoles, allowedTeams)
			if dbErr != nil {
				// Fall through to claims-based fallback for compatibility.
			} else if hasAssignments {
				if !dbAllowed {
					writeAPIError(w, http.StatusForbidden, denyReason)
					return
				}
				next.ServeHTTP(w, r)
				return
			}
		}

		// Fallback: JWT claims.
		roles := extractRoleClaims(claims)
		if !hasAnyAllowedValue(roles, allowedRoles) {
			writeAPIError(w, http.StatusForbidden, "admin access denied: missing required role")
			return
		}
		if len(allowedTeams) > 0 {
			teams := extractTeamClaims(claims)
			if !hasAnyAllowedValue(teams, allowedTeams) {
				writeAPIError(w, http.StatusForbidden, "admin access denied: missing required team")
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

func getAdminAuthzDBPool() (*pgxpool.Pool, error) {
	adminAuthzDBOnce.Do(func() {
		dbURL := strings.TrimSpace(os.Getenv("SUPABASE_DB_URL"))
		if dbURL == "" {
			adminAuthzDBErr = fmt.Errorf("SUPABASE_DB_URL is not configured")
			return
		}
		adminAuthzDBPool, adminAuthzDBErr = pgxpool.New(context.Background(), dbURL)
	})
	return adminAuthzDBPool, adminAuthzDBErr
}

func authorizeAdminViaDB(ctx context.Context, userID string, allowedRoles, allowedTeams map[string]struct{}) (allowed bool, hasAssignments bool, denyReason string, err error) {
	pool, err := getAdminAuthzDBPool()
	if err != nil {
		return false, false, "", err
	}

	var rolesCSV, teamsCSV string
	err = pool.QueryRow(ctx, `
		SELECT
			COALESCE(string_agg(DISTINCT lower(upr.role), ','), '') AS roles_csv,
			COALESCE(string_agg(DISTINCT lower(t.slug), ','), '') AS teams_csv,
			(COUNT(DISTINCT upr.role) + COUNT(DISTINCT tm.team_id)) > 0 AS has_assignments
		FROM (SELECT $1::text AS uid) u
		LEFT JOIN public.user_platform_roles upr ON upr.user_id::text = u.uid
		LEFT JOIN public.team_memberships tm ON tm.user_id::text = u.uid AND tm.status = 'active'
		LEFT JOIN public.teams t ON t.id = tm.team_id
	`, userID).Scan(&rolesCSV, &teamsCSV, &hasAssignments)
	if err != nil {
		return false, false, "", err
	}

	if !hasAssignments {
		return false, false, "", nil
	}

	roles := csvToClaimValues(rolesCSV)
	if !hasAnyAllowedValue(roles, allowedRoles) {
		return false, true, "admin access denied: missing required role", nil
	}
	if len(allowedTeams) > 0 {
		teams := csvToClaimValues(teamsCSV)
		if !hasAnyAllowedValue(teams, allowedTeams) {
			return false, true, "admin access denied: missing required team", nil
		}
	}
	return true, true, "", nil
}

func csvToClaimValues(csv string) []string {
	if strings.TrimSpace(csv) == "" {
		return nil
	}
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		n := normalizeClaimValue(p)
		if n != "" {
			out = append(out, n)
		}
	}
	return out
}

func extractBearerToken(authHeader string) string {
	auth := strings.TrimSpace(authHeader)
	auth = strings.TrimPrefix(auth, "Bearer ")
	return strings.TrimSpace(auth)
}

func parseAndValidateAdminJWT(tokenStr, secret string) (jwtlib.MapClaims, error) {
	token, err := jwtlib.Parse(tokenStr, func(token *jwtlib.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwtlib.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	}, jwtlib.WithValidMethods([]string{
		jwtlib.SigningMethodHS256.Alg(),
		jwtlib.SigningMethodHS384.Alg(),
		jwtlib.SigningMethodHS512.Alg(),
	}))
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(jwtlib.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid claims")
	}
	return claims, nil
}

func parseCSVSet(raw string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		v := normalizeClaimValue(part)
		if v != "" {
			out[v] = struct{}{}
		}
	}
	return out
}

func extractRoleClaims(claims jwtlib.MapClaims) []string {
	return extractClaimValues(claims,
		[]string{"role"},
		[]string{"roles"},
		[]string{"app_metadata", "role"},
		[]string{"app_metadata", "roles"},
		[]string{"user_metadata", "role"},
		[]string{"user_metadata", "roles"},
	)
}

func extractTeamClaims(claims jwtlib.MapClaims) []string {
	return extractClaimValues(claims,
		[]string{"team"},
		[]string{"teams"},
		[]string{"app_metadata", "team"},
		[]string{"app_metadata", "teams"},
		[]string{"user_metadata", "team"},
		[]string{"user_metadata", "teams"},
	)
}

func extractClaimValues(claims jwtlib.MapClaims, paths ...[]string) []string {
	seen := make(map[string]struct{})
	for _, path := range paths {
		if len(path) == 0 {
			continue
		}
		if v, ok := claimValueAtPath(map[string]interface{}(claims), path...); ok {
			collectClaimValues(seen, v)
		}
	}
	out := make([]string, 0, len(seen))
	for v := range seen {
		out = append(out, v)
	}
	slices.Sort(out)
	return out
}

func claimValueAtPath(m map[string]interface{}, path ...string) (interface{}, bool) {
	var cur interface{} = m
	for _, key := range path {
		obj, ok := cur.(map[string]interface{})
		if !ok {
			return nil, false
		}
		v, exists := obj[key]
		if !exists {
			return nil, false
		}
		cur = v
	}
	return cur, true
}

func collectClaimValues(dst map[string]struct{}, value interface{}) {
	switch v := value.(type) {
	case string:
		// Support both single values and comma-separated values.
		for _, part := range strings.Split(v, ",") {
			n := normalizeClaimValue(part)
			if n != "" {
				dst[n] = struct{}{}
			}
		}
	case []interface{}:
		for _, item := range v {
			collectClaimValues(dst, item)
		}
	case []string:
		for _, item := range v {
			collectClaimValues(dst, item)
		}
	}
}

func normalizeClaimValue(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func hasAnyAllowedValue(values []string, allowed map[string]struct{}) bool {
	if len(values) == 0 || len(allowed) == 0 {
		return false
	}
	for _, v := range values {
		if _, ok := allowed[normalizeClaimValue(v)]; ok {
			return true
		}
	}
	return false
}

// --- FT Token CRUD ---

func (s *Server) handleAdminListFTTokens(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	verified := strings.TrimSpace(r.URL.Query().Get("verified"))

	tokens, err := s.repo.AdminListFTTokens(r.Context(), search, limit, offset, verified)
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
		IsVerified  *bool   `json:"is_verified"`
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
	if body.IsVerified != nil {
		updates["is_verified"] = *body.IsVerified
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
	verified := strings.TrimSpace(r.URL.Query().Get("verified"))

	collections, err := s.repo.AdminListNFTCollections(r.Context(), search, limit, offset, verified)
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
		IsVerified  *bool   `json:"is_verified"`
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
		updates["square_image"] = unquoteString(*body.SquareImage)
	}
	if body.BannerImage != nil {
		updates["banner_image"] = unquoteString(*body.BannerImage)
	}
	if body.Description != nil {
		updates["description"] = *body.Description
	}
	if body.ExternalURL != nil {
		updates["external_url"] = *body.ExternalURL
	}
	if body.IsVerified != nil {
		updates["is_verified"] = *body.IsVerified
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

// --- Account Labels CRUD ---

func (s *Server) handleAdminListAccountLabels(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	search := strings.TrimSpace(r.URL.Query().Get("search"))

	labels, err := s.repo.AdminListAccountLabels(r.Context(), search, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(labels))
	for _, l := range labels {
		out = append(out, map[string]interface{}{
			"address":  l.Address,
			"tag":      l.Tag,
			"label":    l.Label,
			"category": l.Category,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleAdminUpsertAccountLabel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Address  string `json:"address"`
		Tag      string `json:"tag"`
		Label    string `json:"label"`
		Category string `json:"category"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.Address == "" || body.Tag == "" {
		writeAPIError(w, http.StatusBadRequest, "address and tag are required")
		return
	}
	if body.Category == "" {
		body.Category = "custom"
	}

	label := models.AccountLabel{
		Address:  body.Address,
		Tag:      body.Tag,
		Label:    body.Label,
		Category: body.Category,
	}
	if err := s.repo.AdminUpsertAccountLabel(r.Context(), label); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"upserted": true, "address": body.Address, "tag": body.Tag}, nil, nil)
}

func (s *Server) handleAdminDeleteAccountLabel(w http.ResponseWriter, r *http.Request) {
	address := mux.Vars(r)["address"]
	tag := mux.Vars(r)["tag"]
	if address == "" || tag == "" {
		writeAPIError(w, http.StatusBadRequest, "address and tag are required")
		return
	}
	if err := s.repo.AdminDeleteAccountLabel(r.Context(), address, tag); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"deleted": true, "address": address, "tag": tag}, nil, nil)
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
		"is_verified":      t.IsVerified,
		"total_supply":     t.TotalSupply,
		"evm_address":      t.EVMAddress,
		"holder_count":     t.HolderCount,
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
		"square_image":     unquoteString(c.SquareImage),
		"banner_image":     unquoteString(c.BannerImage),
		"is_verified":      c.IsVerified,
		"updated_at":       formatTime(c.UpdatedAt),
	}
}

// --- Contract Verified Status ---

func (s *Server) handleAdminListContracts(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	verified := strings.TrimSpace(r.URL.Query().Get("verified"))

	contracts, err := s.repo.AdminListContracts(r.Context(), search, limit, offset, verified)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(contracts))
	for _, c := range contracts {
		out = append(out, map[string]interface{}{
			"identifier":      formatTokenIdentifier(c.Address, c.Name),
			"address":         formatAddressV1(c.Address),
			"name":            c.Name,
			"kind":            c.Kind,
			"is_verified":     c.IsVerified,
			"dependent_count": c.DependentCount,
			"created_at":      formatTime(c.CreatedAt),
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

func (s *Server) handleAdminUpdateContract(w http.ResponseWriter, r *http.Request) {
	identifier := mux.Vars(r)["identifier"]
	address, name, _ := splitContractIdentifier(identifier)
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	var body struct {
		IsVerified *bool   `json:"is_verified"`
		Kind       *string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.IsVerified == nil && body.Kind == nil {
		writeAPIError(w, http.StatusBadRequest, "at least one of is_verified or kind is required")
		return
	}

	if body.IsVerified != nil {
		if err := s.repo.SetContractVerified(r.Context(), address, name, *body.IsVerified); err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if body.Kind != nil {
		if err := s.repo.SetContractKind(r.Context(), address, name, *body.Kind); err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	resp := map[string]interface{}{"ok": true, "identifier": formatTokenIdentifier(address, name)}
	if body.IsVerified != nil {
		resp["is_verified"] = *body.IsVerified
	}
	if body.Kind != nil {
		resp["kind"] = *body.Kind
	}
	writeAPIResponse(w, resp, nil, nil)
}

func (s *Server) handleAdminRefreshDependentCounts(w http.ResponseWriter, r *http.Request) {
	updated, err := s.repo.RefreshContractDependentCounts(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{"ok": true, "updated": updated}, nil, nil)
}
