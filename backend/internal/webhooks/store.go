package webhooks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// --- Models ---

type Subscription struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id"`
	EndpointID string          `json:"endpoint_id"`
	EventType  string          `json:"event_type"`
	Conditions json.RawMessage `json:"conditions"`
	IsEnabled  bool            `json:"is_enabled"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

type Endpoint struct {
	ID           string          `json:"id"`
	UserID       string          `json:"user_id"`
	SvixEpID     string          `json:"svix_ep_id"`
	URL          string          `json:"url"`
	Description  string          `json:"description,omitempty"`
	EndpointType string          `json:"endpoint_type"`
	Metadata     json.RawMessage `json:"metadata,omitempty"`
	IsActive     bool            `json:"is_active"`
	CreatedAt    time.Time       `json:"created_at"`
}

type APIKeyRecord struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	KeyPrefix string     `json:"key_prefix"`
	Name      string     `json:"name"`
	IsActive  bool       `json:"is_active"`
	CreatedAt time.Time  `json:"created_at"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
}

type UserProfile struct {
	UserID      string    `json:"user_id"`
	TierID      string    `json:"tier_id"`
	IsSuspended bool      `json:"is_suspended"`
	Notes       string    `json:"notes,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type RateLimitTier struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	MaxSubscriptions int    `json:"max_subscriptions"`
	MaxEndpoints     int    `json:"max_endpoints"`
	MaxEventsPerHour int    `json:"max_events_per_hour"`
	MaxAPIRequests   int    `json:"max_api_requests"`
}

type Workflow struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id,omitempty"`
	Name       string          `json:"name"`
	CanvasJSON json.RawMessage `json:"canvas_json"`
	IsActive   bool            `json:"is_active"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

type DeliveryLog struct {
	ID             string          `json:"id"`
	SubscriptionID string          `json:"subscription_id,omitempty"`
	EndpointID     string          `json:"endpoint_id,omitempty"`
	EventType      string          `json:"event_type"`
	Payload        json.RawMessage `json:"payload"`
	StatusCode     int             `json:"status_code"`
	DeliveredAt    time.Time       `json:"delivered_at"`
	SvixMsgID      string          `json:"svix_msg_id,omitempty"`
}

// --- Store ---

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// --- API Key helpers ---

func GenerateAPIKey() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "fs_live_" + hex.EncodeToString(b)
}

func APIKeyPrefix(key string) string {
	if len(key) < 12 {
		return key
	}
	return key[:12]
}

// --- Subscriptions ---

func (s *Store) CreateSubscription(ctx context.Context, sub *Subscription) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO public.subscriptions (user_id, endpoint_id, event_type, conditions)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		sub.UserID, sub.EndpointID, sub.EventType, sub.Conditions,
	).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt)
}

func (s *Store) GetSubscription(ctx context.Context, id, userID string) (*Subscription, error) {
	var sub Subscription
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, endpoint_id, event_type, conditions, is_enabled, created_at, updated_at
		 FROM public.subscriptions WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&sub.ID, &sub.UserID, &sub.EndpointID, &sub.EventType, &sub.Conditions, &sub.IsEnabled, &sub.CreatedAt, &sub.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

func (s *Store) ListSubscriptions(ctx context.Context, userID string, limit, offset int) ([]Subscription, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, endpoint_id, event_type, conditions, is_enabled, created_at, updated_at
		 FROM public.subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		var sub Subscription
		if err := rows.Scan(&sub.ID, &sub.UserID, &sub.EndpointID, &sub.EventType, &sub.Conditions, &sub.IsEnabled, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, nil
}

func (s *Store) UpdateSubscription(ctx context.Context, id, userID string, conditions json.RawMessage, isEnabled *bool) error {
	if conditions != nil && isEnabled != nil {
		_, err := s.pool.Exec(ctx,
			`UPDATE public.subscriptions SET conditions = $1, is_enabled = $2, updated_at = now()
			 WHERE id = $3 AND user_id = $4`, conditions, *isEnabled, id, userID)
		return err
	}
	if conditions != nil {
		_, err := s.pool.Exec(ctx,
			`UPDATE public.subscriptions SET conditions = $1, updated_at = now()
			 WHERE id = $2 AND user_id = $3`, conditions, id, userID)
		return err
	}
	if isEnabled != nil {
		_, err := s.pool.Exec(ctx,
			`UPDATE public.subscriptions SET is_enabled = $1, updated_at = now()
			 WHERE id = $2 AND user_id = $3`, *isEnabled, id, userID)
		return err
	}
	return nil
}

func (s *Store) DeleteSubscription(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.subscriptions WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// --- Endpoints ---

func (s *Store) CreateEndpoint(ctx context.Context, ep *Endpoint) error {
	if ep.EndpointType == "" {
		ep.EndpointType = "webhook"
	}
	if ep.Metadata == nil {
		ep.Metadata = json.RawMessage(`{}`)
	}
	return s.pool.QueryRow(ctx,
		`INSERT INTO public.endpoints (user_id, svix_ep_id, url, description, endpoint_type, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, created_at`,
		ep.UserID, ep.SvixEpID, ep.URL, ep.Description, ep.EndpointType, ep.Metadata,
	).Scan(&ep.ID, &ep.CreatedAt)
}

func (s *Store) ListEndpoints(ctx context.Context, userID string) ([]Endpoint, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, svix_ep_id, url, description, endpoint_type, metadata, is_active, created_at
		 FROM public.endpoints WHERE user_id = $1 ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var eps []Endpoint
	for rows.Next() {
		var ep Endpoint
		if err := rows.Scan(&ep.ID, &ep.UserID, &ep.SvixEpID, &ep.URL, &ep.Description, &ep.EndpointType, &ep.Metadata, &ep.IsActive, &ep.CreatedAt); err != nil {
			return nil, err
		}
		eps = append(eps, ep)
	}
	return eps, nil
}

func (s *Store) GetEndpointByID(ctx context.Context, id string) (*Endpoint, error) {
	var ep Endpoint
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, svix_ep_id, url, description, endpoint_type, metadata, is_active, created_at
		 FROM public.endpoints WHERE id = $1`, id,
	).Scan(&ep.ID, &ep.UserID, &ep.SvixEpID, &ep.URL, &ep.Description, &ep.EndpointType, &ep.Metadata, &ep.IsActive, &ep.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &ep, nil
}

func (s *Store) UpdateEndpoint(ctx context.Context, id, userID string, url, description *string, metadata json.RawMessage) error {
	// Build dynamic update
	if url != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.endpoints SET url = $1 WHERE id = $2 AND user_id = $3`, *url, id, userID); err != nil {
			return err
		}
	}
	if description != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.endpoints SET description = $1 WHERE id = $2 AND user_id = $3`, *description, id, userID); err != nil {
			return err
		}
	}
	if metadata != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.endpoints SET metadata = $1 WHERE id = $2 AND user_id = $3`, metadata, id, userID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteEndpoint(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.endpoints WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// --- API Keys ---

func (s *Store) CreateAPIKey(ctx context.Context, userID, keyHash, keyPrefix, name string) (*APIKeyRecord, error) {
	var rec APIKeyRecord
	err := s.pool.QueryRow(ctx,
		`INSERT INTO public.api_keys (user_id, key_hash, key_prefix, name)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, user_id, key_prefix, name, is_active, created_at`,
		userID, keyHash, keyPrefix, name,
	).Scan(&rec.ID, &rec.UserID, &rec.KeyPrefix, &rec.Name, &rec.IsActive, &rec.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) LookupAPIKey(ctx context.Context, keyHash string) (string, error) {
	var userID string
	err := s.pool.QueryRow(ctx,
		`UPDATE public.api_keys SET last_used = now()
		 WHERE key_hash = $1 AND is_active = true
		 RETURNING user_id`, keyHash,
	).Scan(&userID)
	if err != nil {
		return "", err
	}
	return userID, nil
}

func (s *Store) ListAPIKeys(ctx context.Context, userID string) ([]APIKeyRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, key_prefix, name, is_active, created_at, last_used
		 FROM public.api_keys WHERE user_id = $1 ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []APIKeyRecord
	for rows.Next() {
		var k APIKeyRecord
		if err := rows.Scan(&k.ID, &k.UserID, &k.KeyPrefix, &k.Name, &k.IsActive, &k.CreatedAt, &k.LastUsed); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, nil
}

func (s *Store) DeleteAPIKey(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.api_keys WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// --- Active Subscriptions (for Matcher cache) ---

func (s *Store) GetActiveSubscriptionsByType(ctx context.Context, eventType string) ([]Subscription, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT s.id, s.user_id, s.endpoint_id, s.event_type, s.conditions, s.is_enabled, s.created_at, s.updated_at
		 FROM public.subscriptions s
		 LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
		 WHERE s.event_type = $1 AND s.is_enabled = true AND COALESCE(p.is_suspended, false) = false`,
		eventType,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		var sub Subscription
		if err := rows.Scan(&sub.ID, &sub.UserID, &sub.EndpointID, &sub.EventType, &sub.Conditions, &sub.IsEnabled, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, nil
}

// --- Delivery Logs ---

func (s *Store) InsertDeliveryLog(ctx context.Context, log *DeliveryLog) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO public.delivery_logs (subscription_id, endpoint_id, event_type, payload, status_code, svix_msg_id)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		log.SubscriptionID, log.EndpointID, log.EventType, log.Payload, log.StatusCode, log.SvixMsgID,
	)
	return err
}

func (s *Store) ListDeliveryLogs(ctx context.Context, userID string, limit, offset int) ([]DeliveryLog, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT dl.id, dl.subscription_id, dl.endpoint_id, dl.event_type, dl.payload, dl.status_code, dl.delivered_at, dl.svix_msg_id
		 FROM public.delivery_logs dl
		 JOIN public.endpoints e ON e.id = dl.endpoint_id
		 WHERE e.user_id = $1
		 ORDER BY dl.delivered_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []DeliveryLog
	for rows.Next() {
		var l DeliveryLog
		if err := rows.Scan(&l.ID, &l.SubscriptionID, &l.EndpointID, &l.EventType, &l.Payload, &l.StatusCode, &l.DeliveredAt, &l.SvixMsgID); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// --- User Profiles (Admin) ---

func (s *Store) GetUserProfile(ctx context.Context, userID string) (*UserProfile, error) {
	var p UserProfile
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, tier_id, is_suspended, notes, created_at
		 FROM public.user_profiles WHERE user_id = $1`, userID,
	).Scan(&p.UserID, &p.TierID, &p.IsSuspended, &p.Notes, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) GetUserTier(ctx context.Context, userID string) (*RateLimitTier, error) {
	var t RateLimitTier
	err := s.pool.QueryRow(ctx,
		`SELECT r.id, r.name, r.max_subscriptions, r.max_endpoints, r.max_events_per_hour, r.max_api_requests
		 FROM public.rate_limit_tiers r
		 JOIN public.user_profiles p ON p.tier_id = r.id
		 WHERE p.user_id = $1`, userID,
	).Scan(&t.ID, &t.Name, &t.MaxSubscriptions, &t.MaxEndpoints, &t.MaxEventsPerHour, &t.MaxAPIRequests)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) UpdateUserTier(ctx context.Context, userID, tierID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE public.user_profiles SET tier_id = $1 WHERE user_id = $2`, tierID, userID)
	return err
}

func (s *Store) SuspendUser(ctx context.Context, userID string, suspend bool) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE public.user_profiles SET is_suspended = $1 WHERE user_id = $2`, suspend, userID)
	return err
}

func (s *Store) CountUserSubscriptions(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.subscriptions WHERE user_id = $1`, userID,
	).Scan(&count)
	return count, err
}

func (s *Store) CountUserEndpoints(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.endpoints WHERE user_id = $1`, userID,
	).Scan(&count)
	return count, err
}

// --- Workflows ---

func (s *Store) CreateWorkflow(ctx context.Context, w *Workflow) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO public.workflows (user_id, name, canvas_json)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at, updated_at`,
		w.UserID, w.Name, w.CanvasJSON,
	).Scan(&w.ID, &w.CreatedAt, &w.UpdatedAt)
}

func (s *Store) ListWorkflows(ctx context.Context, userID string, limit, offset int) ([]Workflow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, name, canvas_json, is_active, created_at, updated_at
		 FROM public.workflows WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var workflows []Workflow
	for rows.Next() {
		var w Workflow
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &w.CanvasJSON, &w.IsActive, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		workflows = append(workflows, w)
	}
	return workflows, nil
}

func (s *Store) GetWorkflow(ctx context.Context, id, userID string) (*Workflow, error) {
	var w Workflow
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, name, canvas_json, is_active, created_at, updated_at
		 FROM public.workflows WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&w.ID, &w.UserID, &w.Name, &w.CanvasJSON, &w.IsActive, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (s *Store) UpdateWorkflow(ctx context.Context, id, userID string, name *string, canvasJSON *json.RawMessage, isActive *bool) error {
	if name != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.workflows SET name = $1, updated_at = now() WHERE id = $2 AND user_id = $3`, *name, id, userID); err != nil {
			return err
		}
	}
	if canvasJSON != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.workflows SET canvas_json = $1, updated_at = now() WHERE id = $2 AND user_id = $3`, *canvasJSON, id, userID); err != nil {
			return err
		}
	}
	if isActive != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.workflows SET is_active = $1, updated_at = now() WHERE id = $2 AND user_id = $3`, *isActive, id, userID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteWorkflow(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.workflows WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// --- Admin queries ---

// AdminUserRow represents a user profile with subscription and endpoint counts.
type AdminUserRow struct {
	UserID      string    `json:"user_id"`
	Email       string    `json:"email"`
	TierID      string    `json:"tier_id"`
	IsSuspended bool      `json:"is_suspended"`
	CreatedAt   time.Time `json:"created_at"`
	SubCount    int       `json:"subscription_count"`
	EpCount     int       `json:"endpoint_count"`
}

// AdminListUsers returns user profiles with subscription and endpoint counts.
// If search is non-empty, filters by email or user_id prefix.
func (s *Store) AdminListUsers(ctx context.Context, limit, offset int, search ...string) ([]AdminUserRow, error) {
	q := `SELECT p.user_id, COALESCE(u.email, '') as email, p.tier_id, p.is_suspended, p.created_at,
		        (SELECT COUNT(*) FROM public.subscriptions WHERE user_id = p.user_id) as sub_count,
		        (SELECT COUNT(*) FROM public.endpoints WHERE user_id = p.user_id) as ep_count
		 FROM public.user_profiles p
		 LEFT JOIN auth.users u ON u.id = p.user_id`

	var args []interface{}
	if len(search) > 0 && search[0] != "" {
		q += ` WHERE u.email ILIKE $1 OR p.user_id::text ILIKE $1`
		args = append(args, "%"+search[0]+"%")
		q += fmt.Sprintf(` ORDER BY p.created_at DESC LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
		args = append(args, limit, offset)
	} else {
		q += ` ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`
		args = append(args, limit, offset)
	}

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []AdminUserRow
	for rows.Next() {
		var u AdminUserRow
		if err := rows.Scan(&u.UserID, &u.Email, &u.TierID, &u.IsSuspended, &u.CreatedAt, &u.SubCount, &u.EpCount); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

// AdminGlobalStats returns aggregate statistics about the webhook system.
func (s *Store) AdminGlobalStats(ctx context.Context) (map[string]interface{}, error) {
	var totalUsers, totalSubs, totalEndpoints, deliveries24h int

	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.user_profiles`).Scan(&totalUsers)
	if err != nil {
		return nil, err
	}
	err = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.subscriptions`).Scan(&totalSubs)
	if err != nil {
		return nil, err
	}
	err = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.endpoints`).Scan(&totalEndpoints)
	if err != nil {
		return nil, err
	}
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.delivery_logs WHERE delivered_at > now() - interval '24 hours'`,
	).Scan(&deliveries24h)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"total_users":         totalUsers,
		"total_subscriptions": totalSubs,
		"total_endpoints":     totalEndpoints,
		"deliveries_last_24h": deliveries24h,
	}, nil
}
