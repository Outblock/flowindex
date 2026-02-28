package webhooks

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

// SupportedEventTypes lists all event types the webhook system supports.
var SupportedEventTypes = []string{
	// Token transfers
	"ft.transfer",
	"ft.large_transfer",
	"nft.transfer",
	// Transaction & block
	"transaction.sealed",
	"block.sealed",
	// Account lifecycle
	"account.created",
	"account.key.added",
	"account.key.removed",
	"account.key_change",
	"account.contract.added",
	"account.contract.updated",
	"account.contract.removed",
	// Address & contract activity
	"address.activity",
	"contract.event",
	// Staking
	"staking.event",
	// DeFi
	"defi.swap",
	"defi.liquidity",
	// EVM
	"evm.transaction",
}

// Handlers provides HTTP handlers for the webhook API.
type Handlers struct {
	store       *Store
	auth        *AuthMiddleware
	rateLimiter *RateLimiter
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(store *Store, auth *AuthMiddleware, rateLimiter *RateLimiter) *Handlers {
	return &Handlers{store: store, auth: auth, rateLimiter: rateLimiter}
}

// RegisterRoutes registers all webhook routes under /api/v1 on the given router.
func (h *Handlers) RegisterRoutes(r *mux.Router) {
	api := r.PathPrefix("/api/v1").Subrouter()

	// Public route
	api.HandleFunc("/event-types", h.handleListEventTypes).Methods("GET", "OPTIONS")

	// Authenticated routes
	authed := api.NewRoute().Subrouter()
	authed.Use(h.auth.Middleware)

	// Subscriptions
	authed.HandleFunc("/subscriptions", h.handleCreateSubscription).Methods("POST", "OPTIONS")
	authed.HandleFunc("/subscriptions", h.handleListSubscriptions).Methods("GET", "OPTIONS")
	authed.HandleFunc("/subscriptions/{id}", h.handleGetSubscription).Methods("GET", "OPTIONS")
	authed.HandleFunc("/subscriptions/{id}", h.handleUpdateSubscription).Methods("PATCH", "OPTIONS")
	authed.HandleFunc("/subscriptions/{id}", h.handleDeleteSubscription).Methods("DELETE", "OPTIONS")

	// Endpoints
	authed.HandleFunc("/endpoints", h.handleCreateEndpoint).Methods("POST", "OPTIONS")
	authed.HandleFunc("/endpoints", h.handleListEndpoints).Methods("GET", "OPTIONS")
	authed.HandleFunc("/endpoints/{id}", h.handleDeleteEndpoint).Methods("DELETE", "OPTIONS")

	// API Keys
	authed.HandleFunc("/api-keys", h.handleCreateAPIKey).Methods("POST", "OPTIONS")
	authed.HandleFunc("/api-keys", h.handleListAPIKeys).Methods("GET", "OPTIONS")
	authed.HandleFunc("/api-keys/{id}", h.handleDeleteAPIKey).Methods("DELETE", "OPTIONS")

	// Delivery Logs
	authed.HandleFunc("/logs", h.handleListDeliveryLogs).Methods("GET", "OPTIONS")
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func parsePagination(r *http.Request) (limit, offset int) {
	limit = 50
	offset = 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return
}

// --- Public handlers ---

func (h *Handlers) handleListEventTypes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": SupportedEventTypes,
		"count": len(SupportedEventTypes),
	})
}

// --- Subscription handlers ---

func (h *Handlers) handleCreateSubscription(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	// Check subscription limit
	if h.rateLimiter != nil {
		if err := h.rateLimiter.CheckSubscriptionLimit(r.Context(), userID); err != nil {
			writeError(w, http.StatusTooManyRequests, err.Error())
			return
		}
	}

	var body struct {
		EndpointID string          `json:"endpoint_id"`
		EventType  string          `json:"event_type"`
		Conditions json.RawMessage `json:"conditions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.EndpointID == "" || body.EventType == "" {
		writeError(w, http.StatusBadRequest, "endpoint_id and event_type are required")
		return
	}

	// Validate event type
	valid := false
	for _, et := range SupportedEventTypes {
		if et == body.EventType {
			valid = true
			break
		}
	}
	if !valid {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported event_type: %s", body.EventType))
		return
	}

	sub := &Subscription{
		UserID:     userID,
		EndpointID: body.EndpointID,
		EventType:  body.EventType,
		Conditions: body.Conditions,
		IsEnabled:  true,
	}
	if err := h.store.CreateSubscription(r.Context(), sub); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create subscription")
		return
	}

	writeJSON(w, http.StatusCreated, sub)
}

func (h *Handlers) handleListSubscriptions(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	limit, offset := parsePagination(r)
	subs, err := h.store.ListSubscriptions(r.Context(), userID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list subscriptions")
		return
	}
	if subs == nil {
		subs = []Subscription{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": subs,
		"count": len(subs),
	})
}

func (h *Handlers) handleGetSubscription(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	id := mux.Vars(r)["id"]
	sub, err := h.store.GetSubscription(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "subscription not found")
		return
	}

	writeJSON(w, http.StatusOK, sub)
}

func (h *Handlers) handleUpdateSubscription(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	id := mux.Vars(r)["id"]

	var body struct {
		Conditions json.RawMessage `json:"conditions"`
		IsEnabled  *bool           `json:"is_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.store.UpdateSubscription(r.Context(), id, userID, body.Conditions, body.IsEnabled); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update subscription")
		return
	}

	// Return updated subscription
	sub, err := h.store.GetSubscription(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "subscription not found after update")
		return
	}

	writeJSON(w, http.StatusOK, sub)
}

func (h *Handlers) handleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	id := mux.Vars(r)["id"]
	if err := h.store.DeleteSubscription(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete subscription")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --- Endpoint handlers ---

func (h *Handlers) handleCreateEndpoint(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	// Check endpoint limit
	if h.rateLimiter != nil {
		if err := h.rateLimiter.CheckEndpointLimit(r.Context(), userID); err != nil {
			writeError(w, http.StatusTooManyRequests, err.Error())
			return
		}
	}

	var body struct {
		URL         string `json:"url"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	ep := &Endpoint{
		UserID:      userID,
		SvixEpID:    "pending", // Svix integration comes in Task 11
		URL:         body.URL,
		Description: body.Description,
		IsActive:    true,
	}
	if err := h.store.CreateEndpoint(r.Context(), ep); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create endpoint")
		return
	}

	writeJSON(w, http.StatusCreated, ep)
}

func (h *Handlers) handleListEndpoints(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	eps, err := h.store.ListEndpoints(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list endpoints")
		return
	}
	if eps == nil {
		eps = []Endpoint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": eps,
		"count": len(eps),
	})
}

func (h *Handlers) handleDeleteEndpoint(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	id := mux.Vars(r)["id"]
	if err := h.store.DeleteEndpoint(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete endpoint")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --- API Key handlers ---

func (h *Handlers) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	// Generate plaintext key, hash it, store the hash
	plaintext := GenerateAPIKey()
	keyHash := HashAPIKey(plaintext)
	prefix := APIKeyPrefix(plaintext)

	rec, err := h.store.CreateAPIKey(r.Context(), userID, keyHash, prefix, body.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create API key")
		return
	}

	// Return the plaintext key exactly once
	resp := map[string]interface{}{
		"id":         rec.ID,
		"user_id":    rec.UserID,
		"key_prefix": rec.KeyPrefix,
		"name":       rec.Name,
		"is_active":  rec.IsActive,
		"created_at": rec.CreatedAt,
		"key":        plaintext,
	}

	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handlers) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	keys, err := h.store.ListAPIKeys(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list API keys")
		return
	}
	if keys == nil {
		keys = []APIKeyRecord{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": keys,
		"count": len(keys),
	})
}

func (h *Handlers) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	id := mux.Vars(r)["id"]
	if err := h.store.DeleteAPIKey(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete API key")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --- Delivery Log handlers ---

func (h *Handlers) handleListDeliveryLogs(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}

	limit, offset := parsePagination(r)
	logs, err := h.store.ListDeliveryLogs(r.Context(), userID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list delivery logs")
		return
	}
	if logs == nil {
		logs = []DeliveryLog{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": logs,
		"count": len(logs),
	})
}
