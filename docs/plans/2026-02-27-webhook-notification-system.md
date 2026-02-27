# Webhook & Notification System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a developer-facing webhook notification system so developers can subscribe to Flow blockchain events (transfers, staking, DeFi, etc.) and receive real-time webhook deliveries.

**Architecture:** Event Bus (Go channels) receives data from existing ingester callbacks. Condition Matchers evaluate active subscriptions. Svix handles webhook delivery with retry/signing. Supabase self-hosted provides auth + subscription DB (separate from blockchain Postgres).

**Tech Stack:** Go (backend), Svix Go SDK (`github.com/svix/svix-webhooks/go`), Supabase self-hosted (Docker), pgx/v5 (Supabase DB connection), TypeScript (SDK)

**Design Doc:** `docs/plans/2026-02-27-webhook-notification-system-design.md`

---

## Phase 1: Infrastructure Setup

### Task 1: Add Supabase to Docker Compose

**Files:**
- Modify: `docker-compose.yml`
- Create: `.env.supabase` (template only, gitignored)

**Step 1: Add Supabase services to docker-compose.yml**

Add after existing services:

```yaml
  # --- Supabase Auth Stack ---
  supabase-db:
    image: supabase/postgres:15.8.1.060
    environment:
      POSTGRES_PASSWORD: ${SUPABASE_DB_PASSWORD:-supabase-secret}
      POSTGRES_DB: supabase
    volumes:
      - supabase_db_data:/var/lib/postgresql/data
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  supabase-auth:
    image: supabase/gotrue:v2.170.0
    depends_on:
      supabase-db:
        condition: service_healthy
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: ${API_EXTERNAL_URL:-http://localhost:9999}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:supabase-secret@supabase-db:5432/supabase
      GOTRUE_SITE_URL: ${SITE_URL:-http://localhost:5173}
      GOTRUE_JWT_SECRET: ${SUPABASE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}
      GOTRUE_JWT_EXP: 3600
      GOTRUE_DISABLE_SIGNUP: "false"
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_MAILER_AUTOCONFIRM: "true"
    ports:
      - "9999:9999"

  supabase-rest:
    image: postgrest/postgrest:v12.2.8
    depends_on:
      supabase-db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:supabase-secret@supabase-db:5432/supabase
      PGRST_DB_SCHEMAS: public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${SUPABASE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}
    ports:
      - "3000:3000"
```

Add volume:
```yaml
volumes:
  postgres_data:
  supabase_db_data:
```

**Step 2: Create `.env.supabase` template**

```env
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
SUPABASE_DB_PASSWORD=supabase-secret
SUPABASE_DB_URL=postgres://postgres:supabase-secret@localhost:5433/supabase
API_EXTERNAL_URL=http://localhost:9999
SITE_URL=http://localhost:5173
```

**Step 3: Add env vars to backend service in docker-compose.yml**

```yaml
  backend:
    environment:
      # ... existing vars ...
      - SUPABASE_DB_URL=postgres://postgres:supabase-secret@supabase-db:5432/supabase
      - SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
      - SVIX_AUTH_TOKEN=${SVIX_AUTH_TOKEN:-}
      - SVIX_SERVER_URL=${SVIX_SERVER_URL:-http://svix:8071}
    depends_on:
      db:
        condition: service_healthy
      supabase-db:
        condition: service_healthy
```

**Step 4: Verify docker-compose config is valid**

Run: `cd /Users/hao/clawd/agents/fw-cs/flowscan-clone/.claude/worktrees/noble-dancing-moon && docker-compose config --quiet`
Expected: No errors

**Step 5: Commit**

```bash
git add docker-compose.yml .env.supabase
git commit -m "infra: add Supabase auth stack to Docker Compose"
```

---

### Task 2: Create Webhook Schema (Supabase DB)

**Files:**
- Create: `backend/schema_webhooks.sql`

**Step 1: Write the schema file**

```sql
-- Webhook Notification System Schema
-- Runs against the Supabase Postgres instance (separate from blockchain DB)

-- Rate limit tiers (admin-managed)
CREATE TABLE IF NOT EXISTS public.rate_limit_tiers (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    max_subscriptions   INT NOT NULL DEFAULT 5,
    max_endpoints       INT NOT NULL DEFAULT 2,
    max_events_per_hour INT NOT NULL DEFAULT 1000,
    max_api_requests    INT NOT NULL DEFAULT 100,
    is_default          BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO public.rate_limit_tiers (id, name, max_subscriptions, max_endpoints, max_events_per_hour, max_api_requests, is_default) VALUES
    ('free',       'Free',       5,   2,   1000,   100,  true),
    ('pro',        'Pro',        50,  10,  50000,  1000, false),
    ('enterprise', 'Enterprise', 500, 100, 500000, 10000, false)
ON CONFLICT (id) DO NOTHING;

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    tier_id      TEXT REFERENCES public.rate_limit_tiers(id) DEFAULT 'free',
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Developer API keys
CREATE TABLE IF NOT EXISTS public.api_keys (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,
    name        TEXT NOT NULL,
    scopes      TEXT[] DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ
);

-- Webhook endpoints (synced with Svix)
CREATE TABLE IF NOT EXISTS public.endpoints (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    svix_ep_id  TEXT NOT NULL,
    url         TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscriptions (conditions -> endpoints)
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    endpoint_id UUID REFERENCES public.endpoints(id) ON DELETE CASCADE NOT NULL,
    event_type  TEXT NOT NULL,
    conditions  JSONB NOT NULL DEFAULT '{}',
    is_enabled  BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery logs (mirrored from Svix for quick access)
CREATE TABLE IF NOT EXISTS public.delivery_logs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    endpoint_id     UUID REFERENCES public.endpoints(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status_code     INT,
    delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    svix_msg_id     TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_event_type ON public.subscriptions(event_type) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_sub ON public.delivery_logs(subscription_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_user ON public.endpoints(user_id);

-- Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own data
CREATE POLICY users_own_profile ON public.user_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_keys ON public.api_keys FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_endpoints ON public.endpoints FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_subscriptions ON public.subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_logs ON public.delivery_logs FOR ALL USING (
    endpoint_id IN (SELECT id FROM public.endpoints WHERE user_id = auth.uid())
);
```

**Step 2: Commit**

```bash
git add backend/schema_webhooks.sql
git commit -m "feat(webhooks): add webhook notification schema for Supabase DB"
```

---

### Task 3: Add Go Dependencies (Svix SDK + JWT)

**Files:**
- Modify: `backend/go.mod`

**Step 1: Add Svix Go SDK and JWT library**

```bash
cd backend
go get github.com/svix/svix-webhooks/go
go get github.com/golang-jwt/jwt/v5
go mod tidy
```

**Step 2: Verify build**

```bash
cd backend && CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o /dev/null ./...
```
Expected: No errors

**Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add Svix Go SDK and golang-jwt for webhook system"
```

---

## Phase 2: EventBus & Core Infrastructure

### Task 4: Create EventBus Module

**Files:**
- Create: `backend/internal/eventbus/bus.go`
- Create: `backend/internal/eventbus/bus_test.go`

**Step 1: Write the failing test**

```go
// backend/internal/eventbus/bus_test.go
package eventbus

import (
    "sync"
    "testing"
    "time"
)

func TestBus_SubscribeAndPublish(t *testing.T) {
    bus := New()
    defer bus.Close()

    received := make(chan Event, 10)
    bus.Subscribe("ft.transfer", received)

    bus.Publish(Event{
        Type:      "ft.transfer",
        Height:    100,
        Timestamp: time.Now(),
        Data:      map[string]string{"from": "0xABC"},
    })

    select {
    case evt := <-received:
        if evt.Type != "ft.transfer" {
            t.Errorf("expected ft.transfer, got %s", evt.Type)
        }
        if evt.Height != 100 {
            t.Errorf("expected height 100, got %d", evt.Height)
        }
    case <-time.After(time.Second):
        t.Fatal("timed out waiting for event")
    }
}

func TestBus_MultipleSubscribers(t *testing.T) {
    bus := New()
    defer bus.Close()

    ch1 := make(chan Event, 10)
    ch2 := make(chan Event, 10)
    bus.Subscribe("ft.transfer", ch1)
    bus.Subscribe("ft.transfer", ch2)

    bus.Publish(Event{Type: "ft.transfer", Height: 1})

    for _, ch := range []chan Event{ch1, ch2} {
        select {
        case <-ch:
        case <-time.After(time.Second):
            t.Fatal("subscriber did not receive event")
        }
    }
}

func TestBus_TypeFiltering(t *testing.T) {
    bus := New()
    defer bus.Close()

    ftCh := make(chan Event, 10)
    nftCh := make(chan Event, 10)
    bus.Subscribe("ft.transfer", ftCh)
    bus.Subscribe("nft.transfer", nftCh)

    bus.Publish(Event{Type: "ft.transfer", Height: 1})

    select {
    case <-ftCh:
    case <-time.After(time.Second):
        t.Fatal("ft subscriber did not receive event")
    }

    select {
    case <-nftCh:
        t.Fatal("nft subscriber should NOT receive ft.transfer event")
    case <-time.After(50 * time.Millisecond):
        // good - no event received
    }
}

func TestBus_PublishBatch(t *testing.T) {
    bus := New()
    defer bus.Close()

    received := make(chan Event, 100)
    bus.Subscribe("ft.transfer", received)

    var wg sync.WaitGroup
    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func(h uint64) {
            defer wg.Done()
            bus.Publish(Event{Type: "ft.transfer", Height: h})
        }(uint64(i))
    }
    wg.Wait()

    // Allow time for delivery
    time.Sleep(100 * time.Millisecond)
    if len(received) != 50 {
        t.Errorf("expected 50 events, got %d", len(received))
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/eventbus/ -v`
Expected: FAIL (package doesn't exist yet)

**Step 3: Write implementation**

```go
// backend/internal/eventbus/bus.go
package eventbus

import (
    "sync"
    "time"
)

// Event represents a blockchain event flowing through the bus.
type Event struct {
    Type      string
    Height    uint64
    Timestamp time.Time
    Data      interface{}
}

// Bus is an in-process event bus using Go channels.
// Subscribers receive events matching their registered event type.
type Bus struct {
    mu          sync.RWMutex
    subscribers map[string][]chan<- Event
    closed      bool
}

func New() *Bus {
    return &Bus{
        subscribers: make(map[string][]chan<- Event),
    }
}

// Subscribe registers a channel to receive events of the given type.
func (b *Bus) Subscribe(eventType string, ch chan<- Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.subscribers[eventType] = append(b.subscribers[eventType], ch)
}

// Publish sends an event to all subscribers of its type.
// Non-blocking: drops events if a subscriber's channel is full.
func (b *Bus) Publish(evt Event) {
    b.mu.RLock()
    defer b.mu.RUnlock()
    if b.closed {
        return
    }
    for _, ch := range b.subscribers[evt.Type] {
        select {
        case ch <- evt:
        default:
            // drop if subscriber is slow
        }
    }
}

// Close marks the bus as closed. No more events will be published.
func (b *Bus) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.closed = true
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/eventbus/ -v -count=1`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add internal/eventbus/
git commit -m "feat(webhooks): add in-process EventBus with type-based pub/sub"
```

---

### Task 5: Supabase DB Connection in Backend

**Files:**
- Create: `backend/internal/webhooks/db.go`
- Create: `backend/internal/webhooks/db_test.go`

**Step 1: Write the failing test**

```go
// backend/internal/webhooks/db_test.go
package webhooks

import (
    "testing"
)

func TestNewWebhookDB_MissingURL(t *testing.T) {
    _, err := NewWebhookDB("")
    if err == nil {
        t.Fatal("expected error for empty DB URL")
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/webhooks/ -v -run TestNewWebhookDB`
Expected: FAIL (package doesn't exist)

**Step 3: Write implementation**

```go
// backend/internal/webhooks/db.go
package webhooks

import (
    "context"
    "fmt"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

// WebhookDB wraps a pgx pool connected to the Supabase Postgres instance.
type WebhookDB struct {
    Pool *pgxpool.Pool
}

func NewWebhookDB(dbURL string) (*WebhookDB, error) {
    if dbURL == "" {
        return nil, fmt.Errorf("SUPABASE_DB_URL is required for webhook system")
    }

    config, err := pgxpool.ParseConfig(dbURL)
    if err != nil {
        return nil, fmt.Errorf("parse supabase db url: %w", err)
    }

    config.MaxConns = 20
    config.MinConns = 2
    config.MaxConnLifetime = 30 * time.Minute
    config.MaxConnIdleTime = 5 * time.Minute

    pool, err := pgxpool.NewWithConfig(context.Background(), config)
    if err != nil {
        return nil, fmt.Errorf("connect to supabase db: %w", err)
    }

    return &WebhookDB{Pool: pool}, nil
}

func (db *WebhookDB) Close() {
    db.Pool.Close()
}

// Migrate runs the webhook schema against the Supabase DB.
func (db *WebhookDB) Migrate(schemaSQL string) error {
    _, err := db.Pool.Exec(context.Background(), schemaSQL)
    return err
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/webhooks/ -v -run TestNewWebhookDB`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/webhooks/
git commit -m "feat(webhooks): add Supabase DB connection wrapper"
```

---

### Task 6: Auth Middleware (JWT + API Key)

**Files:**
- Create: `backend/internal/webhooks/auth.go`
- Create: `backend/internal/webhooks/auth_test.go`

**Step 1: Write the failing test**

```go
// backend/internal/webhooks/auth_test.go
package webhooks

import (
    "net/http"
    "net/http/httptest"
    "testing"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

func TestExtractUserID_JWT(t *testing.T) {
    secret := "super-secret-jwt-token-with-at-least-32-characters-long"

    // Create a valid Supabase-style JWT
    claims := jwt.MapClaims{
        "sub": "550e8400-e29b-41d4-a716-446655440000",
        "aud": "authenticated",
        "exp": time.Now().Add(time.Hour).Unix(),
        "iat": time.Now().Unix(),
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenStr, err := token.SignedString([]byte(secret))
    if err != nil {
        t.Fatal(err)
    }

    auth := NewAuthMiddleware(secret, nil)

    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+tokenStr)

    userID, err := auth.ExtractUserID(req)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if userID != "550e8400-e29b-41d4-a716-446655440000" {
        t.Errorf("expected user ID 550e..., got %s", userID)
    }
}

func TestExtractUserID_ExpiredJWT(t *testing.T) {
    secret := "super-secret-jwt-token-with-at-least-32-characters-long"

    claims := jwt.MapClaims{
        "sub": "550e8400-e29b-41d4-a716-446655440000",
        "exp": time.Now().Add(-time.Hour).Unix(),
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenStr, _ := token.SignedString([]byte(secret))

    auth := NewAuthMiddleware(secret, nil)

    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+tokenStr)

    _, err := auth.ExtractUserID(req)
    if err == nil {
        t.Fatal("expected error for expired JWT")
    }
}

func TestExtractUserID_NoAuth(t *testing.T) {
    auth := NewAuthMiddleware("secret", nil)
    req := httptest.NewRequest("GET", "/", nil)

    _, err := auth.ExtractUserID(req)
    if err == nil {
        t.Fatal("expected error for missing auth")
    }
}

func TestMiddleware_InjectsUserID(t *testing.T) {
    secret := "super-secret-jwt-token-with-at-least-32-characters-long"

    claims := jwt.MapClaims{
        "sub": "user-123",
        "aud": "authenticated",
        "exp": time.Now().Add(time.Hour).Unix(),
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenStr, _ := token.SignedString([]byte(secret))

    auth := NewAuthMiddleware(secret, nil)

    var capturedUserID string
    handler := auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        capturedUserID = UserIDFromContext(r.Context())
        w.WriteHeader(200)
    }))

    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+tokenStr)
    rr := httptest.NewRecorder()

    handler.ServeHTTP(rr, req)

    if rr.Code != 200 {
        t.Errorf("expected 200, got %d", rr.Code)
    }
    if capturedUserID != "user-123" {
        t.Errorf("expected user-123, got %s", capturedUserID)
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/webhooks/ -v -run TestExtractUserID`
Expected: FAIL

**Step 3: Write implementation**

```go
// backend/internal/webhooks/auth.go
package webhooks

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "net/http"
    "strings"

    jwtlib "github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userIDKey contextKey = "webhook_user_id"

// APIKeyLookup resolves an API key hash to a user ID. Returns "" if not found.
type APIKeyLookup func(ctx context.Context, keyHash string) (userID string, err error)

// AuthMiddleware handles JWT and API Key authentication.
type AuthMiddleware struct {
    jwtSecret    []byte
    apiKeyLookup APIKeyLookup
}

func NewAuthMiddleware(jwtSecret string, apiKeyLookup APIKeyLookup) *AuthMiddleware {
    return &AuthMiddleware{
        jwtSecret:    []byte(jwtSecret),
        apiKeyLookup: apiKeyLookup,
    }
}

// ExtractUserID extracts the user ID from the request via JWT or API key.
func (a *AuthMiddleware) ExtractUserID(r *http.Request) (string, error) {
    // Try API Key first
    if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
        if a.apiKeyLookup == nil {
            return "", fmt.Errorf("API key auth not configured")
        }
        hash := sha256.Sum256([]byte(apiKey))
        keyHash := hex.EncodeToString(hash[:])
        userID, err := a.apiKeyLookup(r.Context(), keyHash)
        if err != nil {
            return "", fmt.Errorf("API key lookup failed: %w", err)
        }
        if userID == "" {
            return "", fmt.Errorf("invalid API key")
        }
        return userID, nil
    }

    // Try JWT
    authHeader := r.Header.Get("Authorization")
    if authHeader == "" {
        return "", fmt.Errorf("missing Authorization header or X-API-Key")
    }

    tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
    tokenStr = strings.TrimSpace(tokenStr)

    token, err := jwtlib.Parse(tokenStr, func(token *jwtlib.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwtlib.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return a.jwtSecret, nil
    })
    if err != nil {
        return "", fmt.Errorf("invalid JWT: %w", err)
    }

    claims, ok := token.Claims.(jwtlib.MapClaims)
    if !ok || !token.Valid {
        return "", fmt.Errorf("invalid JWT claims")
    }

    sub, ok := claims["sub"].(string)
    if !ok || sub == "" {
        return "", fmt.Errorf("JWT missing sub claim")
    }

    return sub, nil
}

// Middleware returns an HTTP middleware that extracts and injects user ID.
func (a *AuthMiddleware) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Method == "OPTIONS" {
            next.ServeHTTP(w, r)
            return
        }

        userID, err := a.ExtractUserID(r)
        if err != nil {
            http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusUnauthorized)
            return
        }

        ctx := context.WithValue(r.Context(), userIDKey, userID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// UserIDFromContext retrieves the user ID set by the auth middleware.
func UserIDFromContext(ctx context.Context) string {
    v, _ := ctx.Value(userIDKey).(string)
    return v
}

// HashAPIKey returns the SHA256 hex hash of an API key.
func HashAPIKey(key string) string {
    h := sha256.Sum256([]byte(key))
    return hex.EncodeToString(h[:])
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/webhooks/ -v -run "TestExtract|TestMiddleware"`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add internal/webhooks/auth.go internal/webhooks/auth_test.go
git commit -m "feat(webhooks): add JWT + API Key auth middleware"
```

---

## Phase 3: Subscription CRUD & API

### Task 7: Subscription Store (CRUD operations)

**Files:**
- Create: `backend/internal/webhooks/store.go`
- Create: `backend/internal/webhooks/store_test.go`

**Step 1: Write the failing test**

```go
// backend/internal/webhooks/store_test.go
package webhooks

import (
    "encoding/json"
    "testing"
)

func TestSubscription_JSON(t *testing.T) {
    s := Subscription{
        ID:         "sub-1",
        UserID:     "user-1",
        EndpointID: "ep-1",
        EventType:  "ft.transfer",
        Conditions: json.RawMessage(`{"min_amount":"100"}`),
        IsEnabled:  true,
    }

    data, err := json.Marshal(s)
    if err != nil {
        t.Fatal(err)
    }

    var decoded Subscription
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatal(err)
    }
    if decoded.EventType != "ft.transfer" {
        t.Errorf("expected ft.transfer, got %s", decoded.EventType)
    }
}

func TestEndpoint_JSON(t *testing.T) {
    e := Endpoint{
        ID:         "ep-1",
        UserID:     "user-1",
        SvixEpID:   "svix_ep_123",
        URL:        "https://example.com/webhook",
        IsActive:   true,
    }

    data, err := json.Marshal(e)
    if err != nil {
        t.Fatal(err)
    }

    var decoded Endpoint
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatal(err)
    }
    if decoded.URL != "https://example.com/webhook" {
        t.Errorf("expected URL, got %s", decoded.URL)
    }
}

func TestAPIKey_PrefixGeneration(t *testing.T) {
    key := GenerateAPIKey()
    if len(key) < 32 {
        t.Errorf("API key too short: %d", len(key))
    }
    prefix := APIKeyPrefix(key)
    if len(prefix) != 12 {
        t.Errorf("expected prefix length 12, got %d", len(prefix))
    }
    if prefix != key[:12] {
        t.Errorf("prefix mismatch")
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/webhooks/ -v -run "TestSubscription|TestEndpoint|TestAPIKey"`
Expected: FAIL

**Step 3: Write implementation**

```go
// backend/internal/webhooks/store.go
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
    ID          string    `json:"id"`
    UserID      string    `json:"user_id"`
    SvixEpID    string    `json:"svix_ep_id"`
    URL         string    `json:"url"`
    Description string    `json:"description,omitempty"`
    IsActive    bool      `json:"is_active"`
    CreatedAt   time.Time `json:"created_at"`
}

type APIKeyRecord struct {
    ID        string    `json:"id"`
    UserID    string    `json:"user_id"`
    KeyPrefix string    `json:"key_prefix"`
    Name      string    `json:"name"`
    IsActive  bool      `json:"is_active"`
    CreatedAt time.Time `json:"created_at"`
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
    ID                 string `json:"id"`
    Name               string `json:"name"`
    MaxSubscriptions   int    `json:"max_subscriptions"`
    MaxEndpoints       int    `json:"max_endpoints"`
    MaxEventsPerHour   int    `json:"max_events_per_hour"`
    MaxAPIRequests     int    `json:"max_api_requests"`
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
    return s.pool.QueryRow(ctx,
        `INSERT INTO public.endpoints (user_id, svix_ep_id, url, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
        ep.UserID, ep.SvixEpID, ep.URL, ep.Description,
    ).Scan(&ep.ID, &ep.CreatedAt)
}

func (s *Store) ListEndpoints(ctx context.Context, userID string) ([]Endpoint, error) {
    rows, err := s.pool.Query(ctx,
        `SELECT id, user_id, svix_ep_id, url, description, is_active, created_at
         FROM public.endpoints WHERE user_id = $1 ORDER BY created_at DESC`, userID,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var eps []Endpoint
    for rows.Next() {
        var ep Endpoint
        if err := rows.Scan(&ep.ID, &ep.UserID, &ep.SvixEpID, &ep.URL, &ep.Description, &ep.IsActive, &ep.CreatedAt); err != nil {
            return nil, err
        }
        eps = append(eps, ep)
    }
    return eps, nil
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

// --- Active Subscriptions (for Matcher) ---

func (s *Store) GetActiveSubscriptionsByType(ctx context.Context, eventType string) ([]Subscription, error) {
    rows, err := s.pool.Query(ctx,
        `SELECT s.id, s.user_id, s.endpoint_id, s.event_type, s.conditions, s.is_enabled, s.created_at, s.updated_at
         FROM public.subscriptions s
         JOIN public.user_profiles p ON p.user_id = s.user_id
         WHERE s.event_type = $1 AND s.is_enabled = true AND p.is_suspended = false`,
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

// CountUserSubscriptions returns the number of active subscriptions for a user.
func (s *Store) CountUserSubscriptions(ctx context.Context, userID string) (int, error) {
    var count int
    err := s.pool.QueryRow(ctx,
        `SELECT COUNT(*) FROM public.subscriptions WHERE user_id = $1`, userID,
    ).Scan(&count)
    return count, err
}

// CountUserEndpoints returns the number of endpoints for a user.
func (s *Store) CountUserEndpoints(ctx context.Context, userID string) (int, error) {
    var count int
    err := s.pool.QueryRow(ctx,
        `SELECT COUNT(*) FROM public.endpoints WHERE user_id = $1`, userID,
    ).Scan(&count)
    return count, err
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/webhooks/ -v -run "TestSubscription|TestEndpoint|TestAPIKey"`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/webhooks/store.go internal/webhooks/store_test.go
git commit -m "feat(webhooks): add subscription/endpoint/apikey store with CRUD"
```

---

### Task 8: Webhook API Handlers

**Files:**
- Create: `backend/internal/webhooks/handlers.go`
- Modify: `backend/internal/api/routes_registration.go` (add `registerWebhookRoutes`)
- Modify: `backend/internal/api/server_bootstrap.go` (add webhook fields to Server)

**Step 1: Create handlers**

```go
// backend/internal/webhooks/handlers.go
package webhooks

import (
    "encoding/json"
    "fmt"
    "net/http"
    "strconv"

    "github.com/gorilla/mux"
)

// Handlers provides HTTP handlers for the webhook API.
type Handlers struct {
    store *Store
    auth  *AuthMiddleware
}

func NewHandlers(store *Store, auth *AuthMiddleware) *Handlers {
    return &Handlers{store: store, auth: auth}
}

func (h *Handlers) RegisterRoutes(r *mux.Router) {
    api := r.PathPrefix("/api/v1").Subrouter()

    // Public
    api.HandleFunc("/event-types", h.handleListEventTypes).Methods("GET", "OPTIONS")

    // Authenticated
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
    authed.HandleFunc("/keys", h.handleCreateAPIKey).Methods("POST", "OPTIONS")
    authed.HandleFunc("/keys", h.handleListAPIKeys).Methods("GET", "OPTIONS")
    authed.HandleFunc("/keys/{id}", h.handleDeleteAPIKey).Methods("DELETE", "OPTIONS")

    // Delivery Logs
    authed.HandleFunc("/logs", h.handleListLogs).Methods("GET", "OPTIONS")
}

// --- Event Types ---

var supportedEventTypes = []map[string]interface{}{
    {"type": "address.activity", "description": "Any transaction activity for watched addresses"},
    {"type": "ft.transfer", "description": "Fungible token transfer"},
    {"type": "ft.large_transfer", "description": "Large fungible token transfer exceeding threshold"},
    {"type": "nft.transfer", "description": "NFT transfer"},
    {"type": "contract.event", "description": "Specific contract event emission"},
    {"type": "staking.event", "description": "Staking-related events (delegate, withdraw, reward)"},
    {"type": "defi.swap", "description": "DEX swap event"},
    {"type": "defi.liquidity", "description": "Liquidity add/remove event"},
    {"type": "account.key_change", "description": "Account public key change"},
    {"type": "evm.transaction", "description": "EVM transaction on Flow-EVM"},
}

func (h *Handlers) handleListEventTypes(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, 200, map[string]interface{}{"event_types": supportedEventTypes})
}

// --- Subscriptions ---

func (h *Handlers) handleCreateSubscription(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())

    var req struct {
        EndpointID string          `json:"endpoint_id"`
        EventType  string          `json:"event_type"`
        Conditions json.RawMessage `json:"conditions"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
        return
    }
    if req.EndpointID == "" || req.EventType == "" {
        writeJSON(w, 400, map[string]string{"error": "endpoint_id and event_type are required"})
        return
    }

    sub := &Subscription{
        UserID:     userID,
        EndpointID: req.EndpointID,
        EventType:  req.EventType,
        Conditions: req.Conditions,
        IsEnabled:  true,
    }

    if err := h.store.CreateSubscription(r.Context(), sub); err != nil {
        writeJSON(w, 500, map[string]string{"error": fmt.Sprintf("create subscription: %v", err)})
        return
    }
    writeJSON(w, 201, sub)
}

func (h *Handlers) handleListSubscriptions(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    limit, offset := parsePagination(r)

    subs, err := h.store.ListSubscriptions(r.Context(), userID, limit, offset)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    if subs == nil {
        subs = []Subscription{}
    }
    writeJSON(w, 200, map[string]interface{}{"subscriptions": subs, "count": len(subs)})
}

func (h *Handlers) handleGetSubscription(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    id := mux.Vars(r)["id"]

    sub, err := h.store.GetSubscription(r.Context(), id, userID)
    if err != nil {
        writeJSON(w, 404, map[string]string{"error": "subscription not found"})
        return
    }
    writeJSON(w, 200, sub)
}

func (h *Handlers) handleUpdateSubscription(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    id := mux.Vars(r)["id"]

    var req struct {
        Conditions json.RawMessage `json:"conditions,omitempty"`
        IsEnabled  *bool           `json:"is_enabled,omitempty"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
        return
    }

    if err := h.store.UpdateSubscription(r.Context(), id, userID, req.Conditions, req.IsEnabled); err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 200, map[string]string{"status": "updated"})
}

func (h *Handlers) handleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    id := mux.Vars(r)["id"]

    if err := h.store.DeleteSubscription(r.Context(), id, userID); err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 204, nil)
}

// --- Endpoints ---

func (h *Handlers) handleCreateEndpoint(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())

    var req struct {
        URL         string `json:"url"`
        Description string `json:"description"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
        return
    }
    if req.URL == "" {
        writeJSON(w, 400, map[string]string{"error": "url is required"})
        return
    }

    // TODO: Create Svix endpoint and get svix_ep_id
    ep := &Endpoint{
        UserID:      userID,
        SvixEpID:    "pending", // will be replaced by Svix integration
        URL:         req.URL,
        Description: req.Description,
        IsActive:    true,
    }

    if err := h.store.CreateEndpoint(r.Context(), ep); err != nil {
        writeJSON(w, 500, map[string]string{"error": fmt.Sprintf("create endpoint: %v", err)})
        return
    }
    writeJSON(w, 201, ep)
}

func (h *Handlers) handleListEndpoints(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())

    eps, err := h.store.ListEndpoints(r.Context(), userID)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    if eps == nil {
        eps = []Endpoint{}
    }
    writeJSON(w, 200, map[string]interface{}{"endpoints": eps, "count": len(eps)})
}

func (h *Handlers) handleDeleteEndpoint(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    id := mux.Vars(r)["id"]

    if err := h.store.DeleteEndpoint(r.Context(), id, userID); err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 204, nil)
}

// --- API Keys ---

func (h *Handlers) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())

    var req struct {
        Name string `json:"name"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
        return
    }
    if req.Name == "" {
        writeJSON(w, 400, map[string]string{"error": "name is required"})
        return
    }

    plainKey := GenerateAPIKey()
    keyHash := HashAPIKey(plainKey)
    prefix := APIKeyPrefix(plainKey)

    rec, err := h.store.CreateAPIKey(r.Context(), userID, keyHash, prefix, req.Name)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": fmt.Sprintf("create key: %v", err)})
        return
    }

    writeJSON(w, 201, map[string]interface{}{
        "key":     plainKey, // only shown once
        "id":      rec.ID,
        "prefix":  rec.KeyPrefix,
        "name":    rec.Name,
        "created": rec.CreatedAt,
    })
}

func (h *Handlers) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())

    keys, err := h.store.ListAPIKeys(r.Context(), userID)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    if keys == nil {
        keys = []APIKeyRecord{}
    }
    writeJSON(w, 200, map[string]interface{}{"keys": keys, "count": len(keys)})
}

func (h *Handlers) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    id := mux.Vars(r)["id"]

    if err := h.store.DeleteAPIKey(r.Context(), id, userID); err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 204, nil)
}

// --- Delivery Logs ---

func (h *Handlers) handleListLogs(w http.ResponseWriter, r *http.Request) {
    userID := UserIDFromContext(r.Context())
    limit, offset := parsePagination(r)

    logs, err := h.store.ListDeliveryLogs(r.Context(), userID, limit, offset)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    if logs == nil {
        logs = []DeliveryLog{}
    }
    writeJSON(w, 200, map[string]interface{}{"logs": logs, "count": len(logs)})
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
    if v == nil {
        w.WriteHeader(code)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(v)
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
```

**Step 2: Wire into the API server**

Add to `backend/internal/api/server_bootstrap.go` Server struct:
```go
webhookHandlers *webhooks.Handlers
```

Add to `backend/internal/api/routes_registration.go`:
```go
func registerWebhookRoutes(r *mux.Router, s *Server) {
    if s.webhookHandlers != nil {
        s.webhookHandlers.RegisterRoutes(r)
    }
}
```

Call `registerWebhookRoutes(r, s)` in `registerAPIRoutes`.

**Step 3: Verify build**

Run: `cd backend && CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o /dev/null ./...`
Expected: No errors

**Step 4: Commit**

```bash
git add internal/webhooks/handlers.go internal/api/routes_registration.go internal/api/server_bootstrap.go
git commit -m "feat(webhooks): add webhook API handlers (subscriptions, endpoints, keys, logs)"
```

---

## Phase 4: Condition Matchers

### Task 9: Matcher Interface & Registry

**Files:**
- Create: `backend/internal/webhooks/matcher/matcher.go`
- Create: `backend/internal/webhooks/matcher/matcher_test.go`

**Step 1: Write the failing test**

```go
// backend/internal/webhooks/matcher/matcher_test.go
package matcher

import (
    "encoding/json"
    "testing"
)

type mockMatcher struct{}

func (m *mockMatcher) EventType() string { return "test.event" }
func (m *mockMatcher) Match(data interface{}, conditions json.RawMessage) bool {
    return string(conditions) == `{"match":true}`
}

func TestRegistry_RegisterAndGet(t *testing.T) {
    reg := NewRegistry()
    reg.Register(&mockMatcher{})

    m := reg.Get("test.event")
    if m == nil {
        t.Fatal("expected matcher for test.event")
    }
    if m.EventType() != "test.event" {
        t.Errorf("expected test.event, got %s", m.EventType())
    }
}

func TestRegistry_GetUnknown(t *testing.T) {
    reg := NewRegistry()
    if reg.Get("unknown") != nil {
        t.Fatal("expected nil for unknown event type")
    }
}

func TestRegistry_Match(t *testing.T) {
    reg := NewRegistry()
    reg.Register(&mockMatcher{})

    if !reg.Get("test.event").Match(nil, json.RawMessage(`{"match":true}`)) {
        t.Fatal("expected match")
    }
    if reg.Get("test.event").Match(nil, json.RawMessage(`{"match":false}`)) {
        t.Fatal("expected no match")
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/webhooks/matcher/ -v`
Expected: FAIL

**Step 3: Write implementation**

```go
// backend/internal/webhooks/matcher/matcher.go
package matcher

import "encoding/json"

// ConditionMatcher evaluates whether blockchain data matches subscription conditions.
type ConditionMatcher interface {
    EventType() string
    Match(data interface{}, conditions json.RawMessage) bool
}

// Registry holds all registered condition matchers.
type Registry struct {
    matchers map[string]ConditionMatcher
}

func NewRegistry() *Registry {
    return &Registry{matchers: make(map[string]ConditionMatcher)}
}

func (r *Registry) Register(m ConditionMatcher) {
    r.matchers[m.EventType()] = m
}

func (r *Registry) Get(eventType string) ConditionMatcher {
    return r.matchers[eventType]
}

func (r *Registry) EventTypes() []string {
    types := make([]string, 0, len(r.matchers))
    for t := range r.matchers {
        types = append(types, t)
    }
    return types
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/webhooks/matcher/ -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/webhooks/matcher/
git commit -m "feat(webhooks): add ConditionMatcher interface and registry"
```

---

### Task 10: Implement All 10 Condition Matchers

**Files:**
- Create: `backend/internal/webhooks/matcher/ft_transfer.go`
- Create: `backend/internal/webhooks/matcher/ft_transfer_test.go`
- Create: `backend/internal/webhooks/matcher/nft_transfer.go`
- Create: `backend/internal/webhooks/matcher/address_activity.go`
- Create: `backend/internal/webhooks/matcher/contract_event.go`
- Create: `backend/internal/webhooks/matcher/staking.go`
- Create: `backend/internal/webhooks/matcher/defi.go`
- Create: `backend/internal/webhooks/matcher/account_key.go`
- Create: `backend/internal/webhooks/matcher/evm.go`
- Create: `backend/internal/webhooks/matcher/all_matchers_test.go`

Each matcher follows the same pattern. Here is the FT transfer matcher as the template — the other 9 follow the same structure.

**Step 1: Write FT transfer matcher test**

```go
// backend/internal/webhooks/matcher/ft_transfer_test.go
package matcher

import (
    "encoding/json"
    "testing"

    "github.com/user/flowscan/internal/models"
)

func TestFTTransferMatcher_EventType(t *testing.T) {
    m := &FTTransferMatcher{}
    if m.EventType() != "ft.transfer" {
        t.Errorf("expected ft.transfer, got %s", m.EventType())
    }
}

func TestFTTransferMatcher_MatchAddress(t *testing.T) {
    m := &FTTransferMatcher{}
    transfer := models.TokenTransfer{
        FromAddress:          "0xABC",
        ToAddress:            "0xDEF",
        Amount:               "100.0",
        TokenContractAddress: "A.1654653399040a61.FlowToken",
    }

    // Match on address
    cond := json.RawMessage(`{"addresses":["0xABC"]}`)
    if !m.Match(transfer, cond) {
        t.Fatal("expected match on from_address")
    }

    cond = json.RawMessage(`{"addresses":["0xDEF"]}`)
    if !m.Match(transfer, cond) {
        t.Fatal("expected match on to_address")
    }

    cond = json.RawMessage(`{"addresses":["0xZZZ"]}`)
    if m.Match(transfer, cond) {
        t.Fatal("expected no match on wrong address")
    }
}

func TestFTTransferMatcher_MatchMinAmount(t *testing.T) {
    m := &FTTransferMatcher{}
    transfer := models.TokenTransfer{
        FromAddress: "0xABC",
        ToAddress:   "0xDEF",
        Amount:      "5000.0",
    }

    cond := json.RawMessage(`{"min_amount":"1000.0"}`)
    if !m.Match(transfer, cond) {
        t.Fatal("5000 >= 1000, expected match")
    }

    cond = json.RawMessage(`{"min_amount":"10000.0"}`)
    if m.Match(transfer, cond) {
        t.Fatal("5000 < 10000, expected no match")
    }
}

func TestFTTransferMatcher_MatchToken(t *testing.T) {
    m := &FTTransferMatcher{}
    transfer := models.TokenTransfer{
        FromAddress:          "0xABC",
        ToAddress:            "0xDEF",
        Amount:               "100.0",
        TokenContractAddress: "A.1654653399040a61.FlowToken",
    }

    cond := json.RawMessage(`{"token_contract":"A.1654653399040a61.FlowToken"}`)
    if !m.Match(transfer, cond) {
        t.Fatal("expected match on token contract")
    }

    cond = json.RawMessage(`{"token_contract":"A.xxx.USDC"}`)
    if m.Match(transfer, cond) {
        t.Fatal("expected no match on wrong token")
    }
}

func TestFTTransferMatcher_EmptyConditions(t *testing.T) {
    m := &FTTransferMatcher{}
    transfer := models.TokenTransfer{FromAddress: "0xABC", ToAddress: "0xDEF", Amount: "100"}

    // Empty conditions = match everything
    if !m.Match(transfer, json.RawMessage(`{}`)) {
        t.Fatal("empty conditions should match all")
    }
}
```

**Step 2: Write FT transfer matcher implementation**

```go
// backend/internal/webhooks/matcher/ft_transfer.go
package matcher

import (
    "encoding/json"
    "strconv"
    "strings"

    "github.com/user/flowscan/internal/models"
)

type ftConditions struct {
    Addresses     []string `json:"addresses"`
    Direction     string   `json:"direction"`      // "in", "out", "both" (default)
    TokenContract string   `json:"token_contract"`
    MinAmount     string   `json:"min_amount"`
}

type FTTransferMatcher struct{}

func (m *FTTransferMatcher) EventType() string { return "ft.transfer" }

func (m *FTTransferMatcher) Match(data interface{}, conditions json.RawMessage) bool {
    transfer, ok := data.(models.TokenTransfer)
    if !ok {
        return false
    }
    if transfer.IsNFT {
        return false
    }

    var cond ftConditions
    if err := json.Unmarshal(conditions, &cond); err != nil {
        return false
    }

    if len(cond.Addresses) > 0 {
        matched := false
        for _, addr := range cond.Addresses {
            a := strings.ToLower(addr)
            dir := strings.ToLower(cond.Direction)
            if dir == "" || dir == "both" {
                if strings.ToLower(transfer.FromAddress) == a || strings.ToLower(transfer.ToAddress) == a {
                    matched = true
                    break
                }
            } else if dir == "in" {
                if strings.ToLower(transfer.ToAddress) == a {
                    matched = true
                    break
                }
            } else if dir == "out" {
                if strings.ToLower(transfer.FromAddress) == a {
                    matched = true
                    break
                }
            }
        }
        if !matched {
            return false
        }
    }

    if cond.TokenContract != "" {
        if !strings.EqualFold(transfer.TokenContractAddress, cond.TokenContract) {
            return false
        }
    }

    if cond.MinAmount != "" {
        minAmt, err := strconv.ParseFloat(cond.MinAmount, 64)
        if err != nil {
            return false
        }
        amt, err := strconv.ParseFloat(transfer.Amount, 64)
        if err != nil {
            return false
        }
        if amt < minAmt {
            return false
        }
    }

    return true
}

// LargeTransferMatcher is similar but min_amount is required.
type LargeTransferMatcher struct{}

func (m *LargeTransferMatcher) EventType() string { return "ft.large_transfer" }

func (m *LargeTransferMatcher) Match(data interface{}, conditions json.RawMessage) bool {
    transfer, ok := data.(models.TokenTransfer)
    if !ok || transfer.IsNFT {
        return false
    }

    var cond ftConditions
    if err := json.Unmarshal(conditions, &cond); err != nil || cond.MinAmount == "" {
        return false
    }

    // Delegate to FT matcher (which checks min_amount)
    ft := &FTTransferMatcher{}
    return ft.Match(data, conditions)
}
```

**Step 3: Implement remaining matchers following the same pattern**

Each matcher file follows the same structure:
- Define a conditions struct for that event type
- Implement `EventType()` and `Match()` methods
- Use the corresponding `models.*` struct as the data type

The matchers to create (abbreviated — each one follows the FT pattern):

**`nft_transfer.go`:** Matches on `addresses`, `collection`, `token_ids`, `direction`. Data type: `models.TokenTransfer` where `IsNFT == true`.

**`address_activity.go`:** Matches on `addresses` and `roles` (PROPOSER/PAYER/AUTHORIZER). Data type: `models.Transaction` — checks `ProposerAddress`, `PayerAddress`, `Authorizers[]`.

**`contract_event.go`:** Matches on `contract_address` and `event_names`. Data type: `models.Event` — checks `ContractAddress`, `EventName`.

**`staking.go`:** Matches on `event_types`, `node_id`, `min_amount`. Data type: `models.StakingEvent`.

**`defi.go`:** Two matchers — `DefiSwapMatcher` (event_type="Swap") and `DefiLiquidityMatcher` (event_type="Add"/"Remove"). Data type: `models.DefiEvent`.

**`account_key.go`:** Matches on `addresses`. Data type: custom struct with address field, derived from raw events.

**`evm.go`:** Matches on `from`, `to`, `min_value`. Data type: `models.EVMTransaction`.

**Step 4: Write comprehensive test for all matchers**

```go
// backend/internal/webhooks/matcher/all_matchers_test.go
package matcher

import (
    "encoding/json"
    "testing"
)

func TestAllMatchersRegistered(t *testing.T) {
    reg := NewRegistry()
    RegisterAll(reg)

    expected := []string{
        "ft.transfer", "ft.large_transfer", "nft.transfer",
        "address.activity", "contract.event",
        "staking.event", "defi.swap", "defi.liquidity",
        "account.key_change", "evm.transaction",
    }

    for _, et := range expected {
        if reg.Get(et) == nil {
            t.Errorf("missing matcher for %s", et)
        }
    }
}
```

Add `RegisterAll` helper:

```go
// In matcher.go, add:
func RegisterAll(r *Registry) {
    r.Register(&FTTransferMatcher{})
    r.Register(&LargeTransferMatcher{})
    r.Register(&NFTTransferMatcher{})
    r.Register(&AddressActivityMatcher{})
    r.Register(&ContractEventMatcher{})
    r.Register(&StakingEventMatcher{})
    r.Register(&DefiSwapMatcher{})
    r.Register(&DefiLiquidityMatcher{})
    r.Register(&AccountKeyChangeMatcher{})
    r.Register(&EVMTransactionMatcher{})
}
```

**Step 5: Run tests and commit**

Run: `cd backend && go test ./internal/webhooks/matcher/ -v -count=1`
Expected: PASS

```bash
git add internal/webhooks/matcher/
git commit -m "feat(webhooks): add all 10 condition matchers (FT, NFT, staking, DeFi, EVM, etc.)"
```

---

## Phase 5: Svix Integration & Matcher Orchestrator

### Task 11: Svix Client Wrapper

**Files:**
- Create: `backend/internal/webhooks/svix_client.go`
- Create: `backend/internal/webhooks/svix_client_test.go`

**Step 1: Write the Svix wrapper**

```go
// backend/internal/webhooks/svix_client.go
package webhooks

import (
    "context"
    "fmt"
    "log"

    svix "github.com/svix/svix-webhooks/go"
)

// SvixClient wraps the Svix SDK for webhook delivery.
type SvixClient struct {
    client *svix.Svix
}

func NewSvixClient(authToken, serverURL string) (*SvixClient, error) {
    opts := &svix.SvixOptions{}
    if serverURL != "" {
        opts.ServerUrl = &serverURL
    }
    client, err := svix.New(authToken, opts)
    if err != nil {
        return nil, fmt.Errorf("create svix client: %w", err)
    }
    return &SvixClient{client: client}, nil
}

// CreateApplication creates a Svix application for a user.
func (s *SvixClient) CreateApplication(ctx context.Context, userID, name string) (string, error) {
    app, err := s.client.Application.Create(ctx, &svix.ApplicationIn{
        Name: name,
        Uid:  svix.NullableString(&userID),
    })
    if err != nil {
        return "", err
    }
    return app.Id, nil
}

// CreateEndpoint creates a Svix endpoint under a user's application.
func (s *SvixClient) CreateEndpoint(ctx context.Context, userID, url string) (string, error) {
    ep, err := s.client.Endpoint.Create(ctx, userID, &svix.EndpointIn{
        Url: url,
    })
    if err != nil {
        return "", err
    }
    return ep.Id, nil
}

// SendMessage sends a webhook message via Svix.
func (s *SvixClient) SendMessage(ctx context.Context, userID, eventType string, payload map[string]interface{}) error {
    _, err := s.client.Message.Create(ctx, userID, &svix.MessageIn{
        EventType: svix.NullableString(&eventType),
        Payload:   payload,
    })
    if err != nil {
        log.Printf("[svix] send message error (user=%s, type=%s): %v", userID, eventType, err)
        return err
    }
    return nil
}

// DeleteEndpoint removes an endpoint from Svix.
func (s *SvixClient) DeleteEndpoint(ctx context.Context, userID, endpointID string) error {
    return s.client.Endpoint.Delete(ctx, userID, endpointID)
}
```

**Step 2: Commit**

```bash
git add internal/webhooks/svix_client.go
git commit -m "feat(webhooks): add Svix client wrapper for webhook delivery"
```

---

### Task 12: Notification Orchestrator

This is the core: connects EventBus → Matcher → Svix.

**Files:**
- Create: `backend/internal/webhooks/orchestrator.go`
- Create: `backend/internal/webhooks/orchestrator_test.go`
- Create: `backend/internal/webhooks/cache.go`

**Step 1: Write subscription cache**

```go
// backend/internal/webhooks/cache.go
package webhooks

import (
    "context"
    "log"
    "sync"
    "time"
)

// SubscriptionCache caches active subscriptions grouped by event type.
type SubscriptionCache struct {
    store    *Store
    ttl      time.Duration
    mu       sync.RWMutex
    byType   map[string][]Subscription
    loadedAt time.Time
}

func NewSubscriptionCache(store *Store, ttl time.Duration) *SubscriptionCache {
    return &SubscriptionCache{
        store:  store,
        ttl:    ttl,
        byType: make(map[string][]Subscription),
    }
}

// GetByType returns cached subscriptions for an event type.
func (c *SubscriptionCache) GetByType(eventType string) []Subscription {
    c.mu.RLock()
    if time.Since(c.loadedAt) < c.ttl {
        subs := c.byType[eventType]
        c.mu.RUnlock()
        return subs
    }
    c.mu.RUnlock()

    c.refresh()

    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.byType[eventType]
}

func (c *SubscriptionCache) refresh() {
    c.mu.Lock()
    defer c.mu.Unlock()

    // Double-check after acquiring write lock
    if time.Since(c.loadedAt) < c.ttl {
        return
    }

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    // Load all active subscriptions grouped by type
    eventTypes := []string{
        "address.activity", "ft.transfer", "ft.large_transfer", "nft.transfer",
        "contract.event", "staking.event", "defi.swap", "defi.liquidity",
        "account.key_change", "evm.transaction",
    }

    newByType := make(map[string][]Subscription)
    for _, et := range eventTypes {
        subs, err := c.store.GetActiveSubscriptionsByType(ctx, et)
        if err != nil {
            log.Printf("[webhook-cache] error loading %s subscriptions: %v", et, err)
            continue
        }
        newByType[et] = subs
    }

    c.byType = newByType
    c.loadedAt = time.Now()
}

// Invalidate forces a cache refresh on next access.
func (c *SubscriptionCache) Invalidate() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.loadedAt = time.Time{}
}
```

**Step 2: Write orchestrator**

```go
// backend/internal/webhooks/orchestrator.go
package webhooks

import (
    "context"
    "encoding/json"
    "log"
    "time"

    "github.com/user/flowscan/internal/eventbus"
    "github.com/user/flowscan/internal/models"
    "github.com/user/flowscan/internal/webhooks/matcher"
)

// Orchestrator connects the EventBus to condition matchers and Svix delivery.
type Orchestrator struct {
    bus      *eventbus.Bus
    cache    *SubscriptionCache
    registry *matcher.Registry
    svix     *SvixClient
    store    *Store
    events   chan eventbus.Event
}

func NewOrchestrator(bus *eventbus.Bus, cache *SubscriptionCache, registry *matcher.Registry, svix *SvixClient, store *Store) *Orchestrator {
    o := &Orchestrator{
        bus:      bus,
        cache:    cache,
        registry: registry,
        svix:     svix,
        store:    store,
        events:   make(chan eventbus.Event, 10000),
    }

    // Subscribe to all event types
    for _, et := range registry.EventTypes() {
        bus.Subscribe(et, o.events)
    }

    return o
}

// Run starts the orchestrator loop. Call in a goroutine.
func (o *Orchestrator) Run(ctx context.Context) {
    log.Println("[orchestrator] started")
    for {
        select {
        case <-ctx.Done():
            log.Println("[orchestrator] stopped")
            return
        case evt := <-o.events:
            o.processEvent(evt)
        }
    }
}

func (o *Orchestrator) processEvent(evt eventbus.Event) {
    m := o.registry.Get(evt.Type)
    if m == nil {
        return
    }

    subs := o.cache.GetByType(evt.Type)
    for _, sub := range subs {
        if m.Match(evt.Data, sub.Conditions) {
            o.deliver(sub, evt)
        }
    }
}

func (o *Orchestrator) deliver(sub Subscription, evt eventbus.Event) {
    payload := map[string]interface{}{
        "event_type":      evt.Type,
        "block_height":    evt.Height,
        "timestamp":       evt.Timestamp.Format(time.RFC3339),
        "data":            evt.Data,
        "subscription_id": sub.ID,
    }

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    err := o.svix.SendMessage(ctx, sub.UserID, evt.Type, payload)

    // Log delivery
    payloadJSON, _ := json.Marshal(payload)
    statusCode := 200
    if err != nil {
        statusCode = 0
        log.Printf("[orchestrator] delivery error (sub=%s, type=%s): %v", sub.ID, evt.Type, err)
    }

    _ = o.store.InsertDeliveryLog(context.Background(), &DeliveryLog{
        SubscriptionID: sub.ID,
        EndpointID:     sub.EndpointID,
        EventType:      evt.Type,
        Payload:        payloadJSON,
        StatusCode:     statusCode,
    })
}

// PublishFromBlock extracts events from block data and publishes to the EventBus.
// Call this from the ingester callback.
func (o *Orchestrator) PublishFromBlock(
    txs []models.Transaction,
    events []models.Event,
    ftTransfers []models.TokenTransfer,
    nftTransfers []models.TokenTransfer,
    stakingEvents []models.StakingEvent,
    defiEvents []models.DefiEvent,
    evmTxs []models.EVMTransaction,
) {
    now := time.Now()
    var height uint64
    if len(txs) > 0 {
        height = txs[0].BlockHeight
    }

    // Address activity (from transactions)
    for _, tx := range txs {
        o.bus.Publish(eventbus.Event{
            Type: "address.activity", Height: height, Timestamp: now, Data: tx,
        })
    }

    // FT transfers
    for _, t := range ftTransfers {
        if !t.IsNFT {
            o.bus.Publish(eventbus.Event{
                Type: "ft.transfer", Height: height, Timestamp: now, Data: t,
            })
            o.bus.Publish(eventbus.Event{
                Type: "ft.large_transfer", Height: height, Timestamp: now, Data: t,
            })
        }
    }

    // NFT transfers
    for _, t := range nftTransfers {
        if t.IsNFT {
            o.bus.Publish(eventbus.Event{
                Type: "nft.transfer", Height: height, Timestamp: now, Data: t,
            })
        }
    }

    // Contract events
    for _, e := range events {
        o.bus.Publish(eventbus.Event{
            Type: "contract.event", Height: height, Timestamp: now, Data: e,
        })
    }

    // Staking
    for _, s := range stakingEvents {
        o.bus.Publish(eventbus.Event{
            Type: "staking.event", Height: height, Timestamp: now, Data: s,
        })
    }

    // DeFi
    for _, d := range defiEvents {
        if d.EventType == "Swap" {
            o.bus.Publish(eventbus.Event{
                Type: "defi.swap", Height: height, Timestamp: now, Data: d,
            })
        } else {
            o.bus.Publish(eventbus.Event{
                Type: "defi.liquidity", Height: height, Timestamp: now, Data: d,
            })
        }
    }

    // EVM
    for _, e := range evmTxs {
        o.bus.Publish(eventbus.Event{
            Type: "evm.transaction", Height: height, Timestamp: now, Data: e,
        })
    }
}
```

**Step 3: Run tests and commit**

Run: `cd backend && go test ./internal/webhooks/... -v -count=1`
Expected: PASS

```bash
git add internal/webhooks/orchestrator.go internal/webhooks/cache.go
git commit -m "feat(webhooks): add notification orchestrator (EventBus → Matcher → Svix)"
```

---

## Phase 6: Wire Everything Together

### Task 13: Integrate into main.go

**Files:**
- Modify: `backend/main.go`

**Step 1: Add webhook system initialization**

After existing ingester setup (around line 385), add:

```go
// --- Webhook Notification System ---
var webhookOrchestrator *webhooks.Orchestrator

if supabaseDBURL := os.Getenv("SUPABASE_DB_URL"); supabaseDBURL != "" {
    jwtSecret := os.Getenv("SUPABASE_JWT_SECRET")
    svixToken := os.Getenv("SVIX_AUTH_TOKEN")
    svixURL := os.Getenv("SVIX_SERVER_URL")

    // Connect to Supabase DB
    whDB, err := webhooks.NewWebhookDB(supabaseDBURL)
    if err != nil {
        log.Printf("[webhooks] failed to connect to Supabase DB: %v (webhooks disabled)", err)
    } else {
        whStore := webhooks.NewStore(whDB.Pool)

        // Auth middleware
        whAuth := webhooks.NewAuthMiddleware(jwtSecret, whStore.LookupAPIKey)

        // Svix client (optional — can run without for development)
        var svixClient *webhooks.SvixClient
        if svixToken != "" {
            svixClient, err = webhooks.NewSvixClient(svixToken, svixURL)
            if err != nil {
                log.Printf("[webhooks] Svix client error: %v", err)
            }
        }

        // EventBus + Matcher + Orchestrator
        bus := eventbus.New()
        matcherRegistry := matcher.NewRegistry()
        matcher.RegisterAll(matcherRegistry)

        subCache := webhooks.NewSubscriptionCache(whStore, 30*time.Second)
        webhookOrchestrator = webhooks.NewOrchestrator(bus, subCache, matcherRegistry, svixClient, whStore)

        go webhookOrchestrator.Run(context.Background())

        // Wire webhook handlers into API server
        whHandlers := webhooks.NewHandlers(whStore, whAuth)
        // Pass to server via option pattern
        api = NewServer(repo, flowClient, port, startBlock,
            WithWebhookHandlers(whHandlers),
        )

        log.Println("[webhooks] notification system initialized")
    }
}
```

**Step 2: Hook into forward ingester's OnNewTransactions callback**

Modify the existing callback setup to also publish to the webhook bus:

```go
// Wrap existing OnNewTransactions to also publish to webhook bus
originalOnNewTxs := api.MakeBroadcastNewTransactions(repo)
forwardIngester.Config.OnNewTransactions = func(txs []models.Transaction, events []models.Event) {
    originalOnNewTxs(txs, events)  // existing WebSocket broadcast
    if webhookOrchestrator != nil {
        // Note: ftTransfers/stakingEvents/defiEvents come from derived workers,
        // not directly from this callback. For MVP, publish txs and events only.
        // Full data will come from OnIndexedRange integration in a later phase.
        webhookOrchestrator.PublishFromBlock(txs, events, nil, nil, nil, nil, nil)
    }
}
```

**Step 3: Add Server option for webhook handlers**

In `server_bootstrap.go`:

```go
func WithWebhookHandlers(h *webhooks.Handlers) func(*Server) {
    return func(s *Server) {
        s.webhookHandlers = h
    }
}
```

**Step 4: Verify build**

Run: `cd backend && CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o /dev/null ./...`
Expected: No errors

**Step 5: Commit**

```bash
git add main.go internal/api/server_bootstrap.go
git commit -m "feat(webhooks): wire notification system into main.go and ingester callbacks"
```

---

### Task 14: Admin API for User Management

**Files:**
- Create: `backend/internal/webhooks/admin_handlers.go`
- Modify: `backend/internal/api/routes_registration.go`

**Step 1: Write admin handlers**

```go
// backend/internal/webhooks/admin_handlers.go
package webhooks

import (
    "encoding/json"
    "net/http"

    "github.com/gorilla/mux"
)

// AdminHandlers provides admin-only webhook management endpoints.
type AdminHandlers struct {
    store *Store
}

func NewAdminHandlers(store *Store) *AdminHandlers {
    return &AdminHandlers{store: store}
}

func (h *AdminHandlers) RegisterRoutes(r *mux.Router) {
    // These routes should be under the admin subrouter (with adminAuthMiddleware)
    r.HandleFunc("/webhook/users", h.handleListUsers).Methods("GET", "OPTIONS")
    r.HandleFunc("/webhook/users/{id}", h.handleGetUser).Methods("GET", "OPTIONS")
    r.HandleFunc("/webhook/users/{id}/tier", h.handleUpdateTier).Methods("PATCH", "OPTIONS")
    r.HandleFunc("/webhook/users/{id}/suspend", h.handleSuspendUser).Methods("POST", "OPTIONS")
    r.HandleFunc("/webhook/users/{id}/subscriptions", h.handleUserSubscriptions).Methods("GET", "OPTIONS")
    r.HandleFunc("/webhook/users/{id}/logs", h.handleUserLogs).Methods("GET", "OPTIONS")
    r.HandleFunc("/webhook/stats", h.handleStats).Methods("GET", "OPTIONS")
}

func (h *AdminHandlers) handleListUsers(w http.ResponseWriter, r *http.Request) {
    // Query Supabase auth.users + user_profiles
    // For MVP: list user_profiles with tier info
    ctx := r.Context()
    rows, err := h.store.pool.Query(ctx,
        `SELECT p.user_id, p.tier_id, p.is_suspended, p.created_at,
                (SELECT COUNT(*) FROM public.subscriptions WHERE user_id = p.user_id) as sub_count,
                (SELECT COUNT(*) FROM public.endpoints WHERE user_id = p.user_id) as ep_count
         FROM public.user_profiles p ORDER BY p.created_at DESC LIMIT 100`)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    defer rows.Close()

    var users []map[string]interface{}
    for rows.Next() {
        var userID, tierID string
        var suspended bool
        var createdAt interface{}
        var subCount, epCount int
        if err := rows.Scan(&userID, &tierID, &suspended, &createdAt, &subCount, &epCount); err != nil {
            continue
        }
        users = append(users, map[string]interface{}{
            "user_id":       userID,
            "tier":          tierID,
            "is_suspended":  suspended,
            "created_at":    createdAt,
            "subscriptions": subCount,
            "endpoints":     epCount,
        })
    }
    writeJSON(w, 200, map[string]interface{}{"users": users})
}

func (h *AdminHandlers) handleGetUser(w http.ResponseWriter, r *http.Request) {
    userID := mux.Vars(r)["id"]
    profile, err := h.store.GetUserProfile(r.Context(), userID)
    if err != nil {
        writeJSON(w, 404, map[string]string{"error": "user not found"})
        return
    }
    tier, _ := h.store.GetUserTier(r.Context(), userID)
    writeJSON(w, 200, map[string]interface{}{"profile": profile, "tier": tier})
}

func (h *AdminHandlers) handleUpdateTier(w http.ResponseWriter, r *http.Request) {
    userID := mux.Vars(r)["id"]
    var req struct {
        TierID string `json:"tier_id"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
        return
    }
    if err := h.store.UpdateUserTier(r.Context(), userID, req.TierID); err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 200, map[string]string{"status": "updated"})
}

func (h *AdminHandlers) handleSuspendUser(w http.ResponseWriter, r *http.Request) {
    userID := mux.Vars(r)["id"]
    var req struct {
        Suspend bool `json:"suspend"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
        return
    }
    if err := h.store.SuspendUser(r.Context(), userID, req.Suspend); err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 200, map[string]string{"status": "updated"})
}

func (h *AdminHandlers) handleUserSubscriptions(w http.ResponseWriter, r *http.Request) {
    userID := mux.Vars(r)["id"]
    limit, offset := parsePagination(r)
    subs, err := h.store.ListSubscriptions(r.Context(), userID, limit, offset)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 200, map[string]interface{}{"subscriptions": subs})
}

func (h *AdminHandlers) handleUserLogs(w http.ResponseWriter, r *http.Request) {
    userID := mux.Vars(r)["id"]
    limit, offset := parsePagination(r)
    logs, err := h.store.ListDeliveryLogs(r.Context(), userID, limit, offset)
    if err != nil {
        writeJSON(w, 500, map[string]string{"error": err.Error()})
        return
    }
    writeJSON(w, 200, map[string]interface{}{"logs": logs})
}

func (h *AdminHandlers) handleStats(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    var totalUsers, totalSubs, totalEndpoints, totalDeliveries int

    h.store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.user_profiles`).Scan(&totalUsers)
    h.store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.subscriptions WHERE is_enabled = true`).Scan(&totalSubs)
    h.store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.endpoints WHERE is_active = true`).Scan(&totalEndpoints)
    h.store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.delivery_logs WHERE delivered_at > now() - interval '24 hours'`).Scan(&totalDeliveries)

    writeJSON(w, 200, map[string]interface{}{
        "total_users":            totalUsers,
        "active_subscriptions":   totalSubs,
        "active_endpoints":       totalEndpoints,
        "deliveries_last_24h":    totalDeliveries,
    })
}
```

**Step 2: Wire admin handlers into existing admin routes**

In `routes_registration.go`, add to `registerAdminRoutes`:

```go
if s.webhookAdminHandlers != nil {
    s.webhookAdminHandlers.RegisterRoutes(admin)
}
```

**Step 3: Commit**

```bash
git add internal/webhooks/admin_handlers.go internal/api/routes_registration.go
git commit -m "feat(webhooks): add admin API for user management and stats"
```

---

## Phase 7: TypeScript SDK

### Task 15: Create TypeScript SDK Package

**Files:**
- Create: `sdk/typescript/package.json`
- Create: `sdk/typescript/src/index.ts`
- Create: `sdk/typescript/src/client.ts`
- Create: `sdk/typescript/src/types.ts`
- Create: `sdk/typescript/src/verify.ts`
- Create: `sdk/typescript/tsconfig.json`

**Step 1: Package setup**

```json
// sdk/typescript/package.json
{
  "name": "@flowscan/webhooks-sdk",
  "version": "0.1.0",
  "description": "FlowScan Webhook SDK for Flow blockchain event notifications",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Write types**

```typescript
// sdk/typescript/src/types.ts
export interface FlowScanConfig {
  apiKey: string;
  baseUrl: string;
}

export interface Endpoint {
  id: string;
  url: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  endpoint_id: string;
  event_type: string;
  conditions: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface APIKey {
  id: string;
  key?: string; // only on creation
  prefix: string;
  name: string;
  created_at: string;
}

export interface DeliveryLog {
  id: string;
  subscription_id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status_code: number;
  delivered_at: string;
}

export interface EventType {
  type: string;
  description: string;
}

export type WebhookEventType =
  | 'address.activity'
  | 'ft.transfer'
  | 'ft.large_transfer'
  | 'nft.transfer'
  | 'contract.event'
  | 'staking.event'
  | 'defi.swap'
  | 'defi.liquidity'
  | 'account.key_change'
  | 'evm.transaction';
```

**Step 3: Write client**

```typescript
// sdk/typescript/src/client.ts
import type {
  FlowScanConfig,
  Endpoint,
  Subscription,
  APIKey,
  DeliveryLog,
  EventType,
  WebhookEventType,
} from './types';

export class FlowScanWebhooks {
  private baseUrl: string;
  private apiKey: string;

  public endpoints: EndpointAPI;
  public subscriptions: SubscriptionAPI;
  public keys: KeyAPI;
  public logs: LogAPI;

  constructor(config: FlowScanConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.endpoints = new EndpointAPI(this);
    this.subscriptions = new SubscriptionAPI(this);
    this.keys = new KeyAPI(this);
    this.logs = new LogAPI(this);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`FlowScan API error (${res.status}): ${err.error || res.statusText}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  async getEventTypes(): Promise<EventType[]> {
    const res = await this.request<{ event_types: EventType[] }>('GET', '/event-types');
    return res.event_types;
  }
}

class EndpointAPI {
  constructor(private client: FlowScanWebhooks) {}

  async create(data: { url: string; description?: string }): Promise<Endpoint> {
    return this.client.request('POST', '/endpoints', data);
  }

  async list(): Promise<Endpoint[]> {
    const res = await this.client.request<{ endpoints: Endpoint[] }>('GET', '/endpoints');
    return res.endpoints;
  }

  async delete(id: string): Promise<void> {
    await this.client.request('DELETE', `/endpoints/${id}`);
  }
}

class SubscriptionAPI {
  constructor(private client: FlowScanWebhooks) {}

  async create(data: {
    endpointId: string;
    eventType: WebhookEventType;
    conditions: Record<string, unknown>;
  }): Promise<Subscription> {
    return this.client.request('POST', '/subscriptions', {
      endpoint_id: data.endpointId,
      event_type: data.eventType,
      conditions: data.conditions,
    });
  }

  async list(params?: { limit?: number; offset?: number }): Promise<Subscription[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString() ? `?${query}` : '';
    const res = await this.client.request<{ subscriptions: Subscription[] }>('GET', `/subscriptions${qs}`);
    return res.subscriptions;
  }

  async get(id: string): Promise<Subscription> {
    return this.client.request('GET', `/subscriptions/${id}`);
  }

  async update(id: string, data: { conditions?: Record<string, unknown>; is_enabled?: boolean }): Promise<void> {
    await this.client.request('PATCH', `/subscriptions/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.client.request('DELETE', `/subscriptions/${id}`);
  }
}

class KeyAPI {
  constructor(private client: FlowScanWebhooks) {}

  async create(data: { name: string }): Promise<APIKey & { key: string }> {
    return this.client.request('POST', '/keys', data);
  }

  async list(): Promise<APIKey[]> {
    const res = await this.client.request<{ keys: APIKey[] }>('GET', '/keys');
    return res.keys;
  }

  async delete(id: string): Promise<void> {
    await this.client.request('DELETE', `/keys/${id}`);
  }
}

class LogAPI {
  constructor(private client: FlowScanWebhooks) {}

  async list(params?: { limit?: number; offset?: number }): Promise<DeliveryLog[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString() ? `?${query}` : '';
    const res = await this.client.request<{ logs: DeliveryLog[] }>('GET', `/logs${qs}`);
    return res.logs;
  }
}
```

**Step 4: Write webhook verification utility**

```typescript
// sdk/typescript/src/verify.ts
import { createHmac, timingSafeEqual } from 'crypto';

const TOLERANCE_IN_SECONDS = 5 * 60; // 5 minutes

export function verifyWebhookSignature(
  payload: string,
  headers: {
    'webhook-id': string;
    'webhook-timestamp': string;
    'webhook-signature': string;
  },
  secret: string
): boolean {
  const msgId = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signature = headers['webhook-signature'];

  if (!msgId || !timestamp || !signature) return false;

  // Check timestamp tolerance
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_IN_SECONDS) return false;

  // Compute expected signature
  const toSign = `${msgId}.${timestamp}.${payload}`;

  // Secret may be prefixed with "whsec_"
  const secretBytes = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64'
  );

  const expectedSig = createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64');

  // Check against all provided signatures (v1,xxx format)
  const signatures = signature.split(' ');
  for (const sig of signatures) {
    const [version, value] = sig.split(',');
    if (version !== 'v1') continue;
    try {
      if (timingSafeEqual(Buffer.from(value), Buffer.from(expectedSig))) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}
```

**Step 5: Write index**

```typescript
// sdk/typescript/src/index.ts
export { FlowScanWebhooks } from './client';
export { verifyWebhookSignature } from './verify';
export type * from './types';
```

**Step 6: Commit**

```bash
git add sdk/typescript/
git commit -m "feat(sdk): add TypeScript webhook SDK with client, types, and signature verification"
```

---

## Phase 8: Rate Limiting

### Task 16: Add Rate Limiting to Webhook API

**Files:**
- Create: `backend/internal/webhooks/ratelimit.go`
- Modify: `backend/internal/webhooks/handlers.go` (add tier checks on create)

**Step 1: Write rate limiter**

```go
// backend/internal/webhooks/ratelimit.go
package webhooks

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// RateLimiter enforces per-user rate limits based on their tier.
type RateLimiter struct {
    store     *Store
    mu        sync.Mutex
    counters  map[string]*userCounter
}

type userCounter struct {
    apiCalls     int
    deliveries   int
    windowStart  time.Time
}

func NewRateLimiter(store *Store) *RateLimiter {
    return &RateLimiter{
        store:    store,
        counters: make(map[string]*userCounter),
    }
}

// CheckAPIRate returns an error if the user has exceeded their API rate limit.
func (rl *RateLimiter) CheckAPIRate(ctx context.Context, userID string) error {
    tier, err := rl.store.GetUserTier(ctx, userID)
    if err != nil {
        return nil // fail open
    }

    rl.mu.Lock()
    defer rl.mu.Unlock()

    c := rl.getOrCreate(userID)
    if time.Since(c.windowStart) > time.Minute {
        c.apiCalls = 0
        c.windowStart = time.Now()
    }

    c.apiCalls++
    if c.apiCalls > tier.MaxAPIRequests {
        return fmt.Errorf("API rate limit exceeded (%d/%d per minute)", c.apiCalls, tier.MaxAPIRequests)
    }
    return nil
}

// CheckDeliveryRate returns an error if the user has exceeded their delivery rate.
func (rl *RateLimiter) CheckDeliveryRate(ctx context.Context, userID string) error {
    tier, err := rl.store.GetUserTier(ctx, userID)
    if err != nil {
        return nil
    }

    rl.mu.Lock()
    defer rl.mu.Unlock()

    c := rl.getOrCreate(userID)
    if time.Since(c.windowStart) > time.Hour {
        c.deliveries = 0
        c.windowStart = time.Now()
    }

    c.deliveries++
    if c.deliveries > tier.MaxEventsPerHour {
        return fmt.Errorf("delivery rate limit exceeded (%d/%d per hour)", c.deliveries, tier.MaxEventsPerHour)
    }
    return nil
}

// CheckSubscriptionLimit returns an error if the user is at their subscription limit.
func (rl *RateLimiter) CheckSubscriptionLimit(ctx context.Context, userID string) error {
    tier, err := rl.store.GetUserTier(ctx, userID)
    if err != nil {
        return nil
    }
    count, err := rl.store.CountUserSubscriptions(ctx, userID)
    if err != nil {
        return nil
    }
    if count >= tier.MaxSubscriptions {
        return fmt.Errorf("subscription limit reached (%d/%d)", count, tier.MaxSubscriptions)
    }
    return nil
}

// CheckEndpointLimit returns an error if the user is at their endpoint limit.
func (rl *RateLimiter) CheckEndpointLimit(ctx context.Context, userID string) error {
    tier, err := rl.store.GetUserTier(ctx, userID)
    if err != nil {
        return nil
    }
    count, err := rl.store.CountUserEndpoints(ctx, userID)
    if err != nil {
        return nil
    }
    if count >= tier.MaxEndpoints {
        return fmt.Errorf("endpoint limit reached (%d/%d)", count, tier.MaxEndpoints)
    }
    return nil
}

func (rl *RateLimiter) getOrCreate(userID string) *userCounter {
    c, ok := rl.counters[userID]
    if !ok {
        c = &userCounter{windowStart: time.Now()}
        rl.counters[userID] = c
    }
    return c
}
```

**Step 2: Add tier checks to handlers**

In `handlers.go`, update `handleCreateSubscription` to check `rl.CheckSubscriptionLimit` before creating. Similarly for endpoints.

**Step 3: Commit**

```bash
git add internal/webhooks/ratelimit.go internal/webhooks/handlers.go
git commit -m "feat(webhooks): add per-user rate limiting based on tier"
```

---

## Summary

| Phase | Tasks | What it delivers |
|---|---|---|
| 1: Infrastructure | 1-3 | Docker Compose with Supabase, schema, Go deps |
| 2: Core | 4-5 | EventBus module, Supabase DB wrapper |
| 3: Auth & API | 6-8 | JWT/API Key auth, CRUD handlers for subscriptions/endpoints/keys |
| 4: Matchers | 9-10 | 10 condition matchers (FT, NFT, staking, DeFi, EVM, etc.) |
| 5: Delivery | 11-12 | Svix integration, notification orchestrator |
| 6: Integration | 13-14 | Wire into main.go + admin API |
| 7: SDK | 15 | TypeScript SDK |
| 8: Rate Limiting | 16 | Per-user tier-based rate limiting |

**Total: 16 tasks, ~8 phases**

After completion, developers can:
1. Register via Supabase auth
2. Create API keys
3. Register webhook endpoints
4. Subscribe to any of 10 event types with custom conditions
5. Receive real-time webhook deliveries via Svix
6. View delivery logs
7. Be rate-limited based on admin-assigned tiers
