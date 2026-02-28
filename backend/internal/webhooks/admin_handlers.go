package webhooks

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
)

// AdminHandlers provides ADMIN_TOKEN-protected endpoints for managing webhook users.
// These handlers are registered under the existing admin subrouter, which already
// applies adminAuthMiddleware.
type AdminHandlers struct {
	store *Store
}

// NewAdminHandlers creates a new AdminHandlers instance.
func NewAdminHandlers(store *Store) *AdminHandlers {
	return &AdminHandlers{store: store}
}

// RegisterRoutes registers webhook admin routes on the given router.
// The router is expected to already have admin auth middleware applied.
func (ah *AdminHandlers) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/webhook/users", ah.handleListUsers).Methods("GET", "OPTIONS")
	r.HandleFunc("/webhook/users/{id}", ah.handleGetUser).Methods("GET", "OPTIONS")
	r.HandleFunc("/webhook/users/{id}/tier", ah.handleUpdateUserTier).Methods("PATCH", "OPTIONS")
	r.HandleFunc("/webhook/users/{id}/suspend", ah.handleSuspendUser).Methods("POST", "OPTIONS")
	r.HandleFunc("/webhook/users/{id}/subscriptions", ah.handleListUserSubscriptions).Methods("GET", "OPTIONS")
	r.HandleFunc("/webhook/users/{id}/logs", ah.handleListUserLogs).Methods("GET", "OPTIONS")
	r.HandleFunc("/webhook/stats", ah.handleGlobalStats).Methods("GET", "OPTIONS")
}

// --- Handlers ---

func (ah *AdminHandlers) handleListUsers(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)
	search := r.URL.Query().Get("search")

	users, err := ah.store.AdminListUsers(r.Context(), limit, offset, search)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}
	if users == nil {
		users = []AdminUserRow{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": users,
		"count": len(users),
	})
}

func (ah *AdminHandlers) handleGetUser(w http.ResponseWriter, r *http.Request) {
	userID := mux.Vars(r)["id"]

	profile, err := ah.store.GetUserProfile(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	tier, _ := ah.store.GetUserTier(r.Context(), userID)

	resp := map[string]interface{}{
		"user_id":      profile.UserID,
		"tier_id":      profile.TierID,
		"is_suspended": profile.IsSuspended,
		"notes":        profile.Notes,
		"created_at":   profile.CreatedAt,
	}
	if tier != nil {
		resp["tier"] = tier
	}

	writeJSON(w, http.StatusOK, resp)
}

func (ah *AdminHandlers) handleUpdateUserTier(w http.ResponseWriter, r *http.Request) {
	userID := mux.Vars(r)["id"]

	var body struct {
		TierID string `json:"tier_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.TierID == "" {
		writeError(w, http.StatusBadRequest, "tier_id is required")
		return
	}

	if err := ah.store.UpdateUserTier(r.Context(), userID, body.TierID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update tier")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"updated": true,
		"user_id": userID,
		"tier_id": body.TierID,
	})
}

func (ah *AdminHandlers) handleSuspendUser(w http.ResponseWriter, r *http.Request) {
	userID := mux.Vars(r)["id"]

	var body struct {
		Suspend bool `json:"suspend"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := ah.store.SuspendUser(r.Context(), userID, body.Suspend); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update suspension status")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"updated":      true,
		"user_id":      userID,
		"is_suspended": body.Suspend,
	})
}

func (ah *AdminHandlers) handleListUserSubscriptions(w http.ResponseWriter, r *http.Request) {
	userID := mux.Vars(r)["id"]
	limit, offset := parsePagination(r)

	subs, err := ah.store.ListSubscriptions(r.Context(), userID, limit, offset)
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

func (ah *AdminHandlers) handleListUserLogs(w http.ResponseWriter, r *http.Request) {
	userID := mux.Vars(r)["id"]
	limit, offset := parsePagination(r)

	logs, err := ah.store.ListDeliveryLogs(r.Context(), userID, limit, offset)
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

func (ah *AdminHandlers) handleGlobalStats(w http.ResponseWriter, r *http.Request) {
	stats, err := ah.store.AdminGlobalStats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch stats")
		return
	}

	writeJSON(w, http.StatusOK, stats)
}
