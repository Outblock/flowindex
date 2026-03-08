# Cloud Wallet Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Backend endpoints, wallet app approval page, and frontend wallet tab to support the agent-wallet MCP server's cloud signing modes.

**Architecture:** Go backend as auth gateway proxying to existing Supabase edge functions (flow-keys for signing, passkey-auth for accounts). New DB tables for agent login sessions and approval requests. Wallet app gets approval page, flowindex.io gets wallet tab in developer portal.

**Tech Stack:** Go (gorilla/mux, JWT), PostgreSQL (Supabase), React (wallet app: react-router, frontend: TanStack Router), TypeScript

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260308000000_wallet_infra.sql`

**Step 1: Write migration SQL**

```sql
-- Agent login sessions (for zero-config MCP wallet_login flow)
CREATE TABLE IF NOT EXISTS public.agent_login_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired')),
  wallet_token TEXT,
  callback_origin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes'
);

CREATE INDEX IF NOT EXISTS idx_agent_login_sessions_status
  ON public.agent_login_sessions(status) WHERE status = 'pending';

-- Wallet approval requests (for passkey tx approval)
CREATE TABLE IF NOT EXISTS public.wallet_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  tx_message_hex TEXT NOT NULL,
  cadence_script TEXT,
  cadence_args JSONB,
  description TEXT,
  signature TEXT,
  credential_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes'
);

CREATE INDEX IF NOT EXISTS idx_wallet_approval_requests_user_status
  ON public.wallet_approval_requests(user_id, status) WHERE status = 'pending';

-- RLS policies
ALTER TABLE public.agent_login_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_approval_requests ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY agent_login_sessions_service ON public.agent_login_sessions
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY wallet_approval_requests_service ON public.wallet_approval_requests
  FOR ALL USING (true) WITH CHECK (true);
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260308000000_wallet_infra.sql
git commit -m "feat: add agent_login_sessions and wallet_approval_requests tables"
```

---

## Task 2: Go — Wallet JWT Utility

**Files:**
- Create: `backend/internal/api/wallet_jwt.go`

**Context:** The Go backend needs to issue and validate scoped wallet JWTs. These are distinct from Supabase JWTs — they're short-lived tokens with `scope: "wallet"` that agents use for API access.

**Step 1: Implement JWT helpers**

```go
package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

var (
	errWalletJWTMissing  = errors.New("missing wallet JWT secret")
	errWalletJWTInvalid  = errors.New("invalid wallet JWT")
	errWalletJWTExpired  = errors.New("wallet JWT expired")
)

type walletJWTClaims struct {
	Sub   string `json:"sub"`   // user_id
	Scope string `json:"scope"` // "wallet"
	Exp   int64  `json:"exp"`
	Iat   int64  `json:"iat"`
}

func walletJWTSecret() ([]byte, error) {
	s := os.Getenv("WALLET_JWT_SECRET")
	if s == "" {
		// Fallback to SUPABASE_JWT_SECRET if WALLET_JWT_SECRET not set
		s = os.Getenv("SUPABASE_JWT_SECRET")
	}
	if s == "" {
		return nil, errWalletJWTMissing
	}
	return []byte(s), nil
}

func issueWalletJWT(userID string, ttl time.Duration) (string, error) {
	secret, err := walletJWTSecret()
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := walletJWTClaims{
		Sub:   userID,
		Scope: "wallet",
		Exp:   now.Add(ttl).Unix(),
		Iat:   now.Unix(),
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)

	sigInput := header + "." + payloadB64
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(sigInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return sigInput + "." + sig, nil
}

func validateWalletJWT(tokenStr string) (*walletJWTClaims, error) {
	secret, err := walletJWTSecret()
	if err != nil {
		return nil, err
	}

	parts := strings.SplitN(tokenStr, ".", 3)
	if len(parts) != 3 {
		return nil, errWalletJWTInvalid
	}

	// Verify signature
	sigInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(sigInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, errWalletJWTInvalid
	}

	// Decode claims
	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errWalletJWTInvalid
	}
	var claims walletJWTClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, errWalletJWTInvalid
	}

	if claims.Scope != "wallet" {
		return nil, fmt.Errorf("invalid scope: %s", claims.Scope)
	}
	if time.Now().Unix() > claims.Exp {
		return nil, errWalletJWTExpired
	}
	return &claims, nil
}
```

**Step 2: Commit**

```bash
git add backend/internal/api/wallet_jwt.go
git commit -m "feat: add wallet JWT issue/validate helpers"
```

---

## Task 3: Go — Wallet Auth Middleware

**Files:**
- Create: `backend/internal/api/wallet_auth.go`

**Context:** Wallet endpoints accept two auth methods: (1) `Authorization: Bearer {wallet_jwt}` or (2) `X-API-Key` header with `wallet:sign` scope. This middleware extracts the user ID and stores it in request context.

**Step 1: Implement middleware**

```go
package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
)

type ctxKey string

const ctxWalletUserID ctxKey = "wallet_user_id"

func walletUserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxWalletUserID).(string); ok {
		return v
	}
	return ""
}

// walletAuthMiddleware authenticates via Wallet JWT or API key with wallet:sign scope.
func (s *Server) walletAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try Bearer token first
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token := strings.TrimPrefix(auth, "Bearer ")
			claims, err := validateWalletJWT(token)
			if err == nil && claims.Sub != "" {
				ctx := context.WithValue(r.Context(), ctxWalletUserID, claims.Sub)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			// If Bearer token is present but invalid, reject
			writeAPIError(w, http.StatusUnauthorized, "invalid wallet token")
			return
		}

		// Try X-API-Key with wallet:sign scope
		if apiKey := r.Header.Get("X-API-Key"); apiKey != "" && s.apiKeyResolver != nil {
			hash := sha256.Sum256([]byte(apiKey))
			keyHash := hex.EncodeToString(hash[:])
			userID, err := s.apiKeyResolver(r.Context(), keyHash)
			if err != nil || userID == "" {
				writeAPIError(w, http.StatusUnauthorized, "invalid API key")
				return
			}
			// Check wallet:sign scope — query api_keys table for scopes
			hasScope, err := s.checkAPIKeyScope(r.Context(), keyHash, "wallet:sign")
			if err != nil || !hasScope {
				writeAPIError(w, http.StatusForbidden, "API key missing wallet:sign scope")
				return
			}
			ctx := context.WithValue(r.Context(), ctxWalletUserID, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		writeAPIError(w, http.StatusUnauthorized, "authentication required")
	})
}

// checkAPIKeyScope queries api_keys for the given key hash and checks if it has the required scope.
func (s *Server) checkAPIKeyScope(ctx context.Context, keyHash, requiredScope string) (bool, error) {
	pool, err := getAdminAuthzDBPool()
	if err != nil {
		return false, err
	}
	var scopes []string
	err = pool.QueryRow(ctx,
		`SELECT scopes FROM public.api_keys WHERE key_hash = $1 AND is_active = true`,
		keyHash,
	).Scan(&scopes)
	if err != nil {
		return false, err
	}
	for _, s := range scopes {
		if s == requiredScope {
			return true, nil
		}
	}
	return false, nil
}
```

**Step 2: Commit**

```bash
git add backend/internal/api/wallet_auth.go
git commit -m "feat: add wallet auth middleware (JWT + API key scope check)"
```

---

## Task 4: Go — Supabase Auth Middleware (for wallet app calls)

**Files:**
- Create: `backend/internal/api/supabase_auth.go`

**Context:** The wallet app calls `POST /wallet/approve/{id}/sign` and wallet key CRUD endpoints using a Supabase session JWT. We need middleware to validate Supabase JWTs and extract user_id.

**Step 1: Implement Supabase JWT validation**

```go
package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

type supabaseJWTClaims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

// supabaseAuthMiddleware validates Supabase session JWT from Authorization header.
func supabaseAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			writeAPIError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		token := strings.TrimPrefix(auth, "Bearer ")

		secret := os.Getenv("SUPABASE_JWT_SECRET")
		if secret == "" {
			writeAPIError(w, http.StatusInternalServerError, "auth not configured")
			return
		}

		// Validate HMAC-SHA256 signature
		parts := strings.SplitN(token, ".", 3)
		if len(parts) != 3 {
			writeAPIError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		sigInput := parts[0] + "." + parts[1]
		if !verifyHMACSHA256(sigInput, parts[2], []byte(secret)) {
			writeAPIError(w, http.StatusUnauthorized, "invalid token signature")
			return
		}

		claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			writeAPIError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		var claims supabaseJWTClaims
		if err := json.Unmarshal(claimsJSON, &claims); err != nil {
			writeAPIError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		if claims.Sub == "" || time.Now().Unix() > claims.Exp {
			writeAPIError(w, http.StatusUnauthorized, "token expired")
			return
		}

		ctx := context.WithValue(r.Context(), ctxWalletUserID, claims.Sub)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func verifyHMACSHA256(sigInput, sigB64 string, secret []byte) bool {
	import "crypto/hmac"
	import "crypto/sha256"
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(sigInput))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sigB64), []byte(expected))
}
```

**Note:** The `verifyHMACSHA256` function has invalid inline imports in the example above. In actual implementation, move the imports to the top of the file and reuse the same HMAC verification logic from `wallet_jwt.go`. Consider extracting a shared `verifyHS256(sigInput, sigB64 string, secret []byte) bool` helper used by both `validateWalletJWT` and `supabaseAuthMiddleware`.

**Step 2: Commit**

```bash
git add backend/internal/api/supabase_auth.go
git commit -m "feat: add Supabase JWT auth middleware for wallet app endpoints"
```

---

## Task 5: Go — Agent Login Endpoints

**Files:**
- Create: `backend/internal/api/wallet_agent_login.go`

**Context:** Two public endpoints that implement the agent login flow. The MCP server calls `POST /wallet/agent/login` to create a session, then polls `GET /wallet/agent/login/{id}` until the user completes authentication in the browser.

**Step 1: Implement agent login handlers**

```go
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
)

// POST /api/v1/wallet/agent/login — Create agent login session (public)
func (s *Server) handleWalletAgentLoginCreate(w http.ResponseWriter, r *http.Request) {
	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	var sessionID string
	err = pool.QueryRow(r.Context(),
		`INSERT INTO public.agent_login_sessions (status)
		 VALUES ('pending')
		 RETURNING id`,
	).Scan(&sessionID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	baseURL := os.Getenv("FLOWINDEX_FRONTEND_URL")
	if baseURL == "" {
		baseURL = "https://flowindex.io"
	}
	loginURL := fmt.Sprintf("%s/agent/auth?session=%s", baseURL, sessionID)

	writeAPIResponse(w, map[string]interface{}{
		"session_id": sessionID,
		"login_url":  loginURL,
		"expires_in": 300,
	}, nil, nil)
}

// GET /api/v1/wallet/agent/login/{id} — Poll agent login status (public)
func (s *Server) handleWalletAgentLoginPoll(w http.ResponseWriter, r *http.Request) {
	sessionID := mux.Vars(r)["id"]
	if sessionID == "" {
		writeAPIError(w, http.StatusBadRequest, "session_id required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	var status string
	var walletToken *string
	var expiresAt time.Time
	err = pool.QueryRow(r.Context(),
		`SELECT status, wallet_token, expires_at
		 FROM public.agent_login_sessions
		 WHERE id = $1`,
		sessionID,
	).Scan(&status, &walletToken, &expiresAt)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "session not found")
		return
	}

	// Check if expired
	if time.Now().After(expiresAt) && status == "pending" {
		pool.Exec(r.Context(),
			`UPDATE public.agent_login_sessions SET status = 'expired' WHERE id = $1`,
			sessionID,
		)
		status = "expired"
	}

	resp := map[string]interface{}{
		"status": status,
	}
	if status == "completed" && walletToken != nil {
		resp["token"] = *walletToken
	}
	writeAPIResponse(w, resp, nil, nil)
}

// POST /api/v1/wallet/agent/login/{id}/complete — Complete login (Supabase JWT auth)
// Called by frontend after user authenticates
func (s *Server) handleWalletAgentLoginComplete(w http.ResponseWriter, r *http.Request) {
	sessionID := mux.Vars(r)["id"]
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	// Verify session is pending and not expired
	var status string
	var expiresAt time.Time
	err = pool.QueryRow(r.Context(),
		`SELECT status, expires_at FROM public.agent_login_sessions WHERE id = $1`,
		sessionID,
	).Scan(&status, &expiresAt)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "session not found")
		return
	}
	if status != "pending" {
		writeAPIError(w, http.StatusConflict, "session already "+status)
		return
	}
	if time.Now().After(expiresAt) {
		writeAPIError(w, http.StatusGone, "session expired")
		return
	}

	// Issue wallet JWT (24h)
	token, err := issueWalletJWT(userID, 24*time.Hour)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to issue token")
		return
	}

	// Update session
	_, err = pool.Exec(r.Context(),
		`UPDATE public.agent_login_sessions
		 SET status = 'completed', user_id = $2, wallet_token = $3, completed_at = now()
		 WHERE id = $1`,
		sessionID, userID, token,
	)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to complete session")
		return
	}

	writeAPIResponse(w, map[string]interface{}{"completed": true}, nil, nil)
}
```

**Step 2: Commit**

```bash
git add backend/internal/api/wallet_agent_login.go
git commit -m "feat: add agent login create/poll/complete endpoints"
```

---

## Task 6: Go — Wallet Info & Signing Proxy Endpoints

**Files:**
- Create: `backend/internal/api/wallet_proxy.go`

**Context:** These endpoints proxy to Supabase edge functions. `GET /wallet/me` aggregates data from flow-keys and passkey-auth. `POST /wallet/sign` proxies to flow-keys `/keys/sign`.

The edge functions use a POST envelope pattern: `{ endpoint: "/keys/list", data: {} }` with `Authorization: Bearer {supabase_service_role_key}`.

However, the edge functions authenticate the user via the Bearer token (Supabase JWT). Since the Go backend receives a Wallet JWT (not a Supabase JWT), we need to use the **service role key** and pass the `user_id` directly. The flow-keys function already accepts service role auth — it extracts user from JWT claims. We'll need to either:
- (a) Pass the original Supabase JWT if the user provided one, or
- (b) Use service role key + add user_id to the request body

For simplicity, use option (b): service role key + query the DB directly for the user's keys and accounts.

**Step 1: Implement proxy handlers**

```go
package api

import (
	"encoding/json"
	"net/http"
)

// GET /api/v1/wallet/me — Get wallet info for authenticated user
func (s *Server) handleWalletMe(w http.ResponseWriter, r *http.Request) {
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	// Query user's custodial keys from user_keys table
	rows, err := pool.Query(r.Context(),
		`SELECT id, flow_address, public_key, key_index, label, sig_algo, hash_algo, source, created_at
		 FROM public.user_keys
		 WHERE user_id = $1
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to query keys")
		return
	}
	defer rows.Close()

	var keys []map[string]interface{}
	for rows.Next() {
		var id, flowAddr, pubKey, label, sigAlgo, hashAlgo, source string
		var keyIndex int
		var createdAt interface{}
		if err := rows.Scan(&id, &flowAddr, &pubKey, &keyIndex, &label, &sigAlgo, &hashAlgo, &source, &createdAt); err != nil {
			continue
		}
		keys = append(keys, map[string]interface{}{
			"id":           id,
			"flow_address": flowAddr,
			"public_key":   pubKey,
			"key_index":    keyIndex,
			"label":        label,
			"sig_algo":     sigAlgo,
			"hash_algo":    hashAlgo,
			"source":       source,
			"created_at":   createdAt,
		})
	}

	// Query passkey-linked accounts from passkey_credentials table
	accRows, err := pool.Query(r.Context(),
		`SELECT id, public_key_sec1_hex, flow_address, authenticator_name, created_at
		 FROM public.passkey_credentials
		 WHERE user_id = $1 AND flow_address IS NOT NULL
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to query accounts")
		return
	}
	defer accRows.Close()

	var accounts []map[string]interface{}
	for accRows.Next() {
		var credID, pubHex, flowAddr, name string
		var createdAt interface{}
		if err := accRows.Scan(&credID, &pubHex, &flowAddr, &name, &createdAt); err != nil {
			continue
		}
		accounts = append(accounts, map[string]interface{}{
			"credential_id": credID,
			"public_key":    pubHex,
			"flow_address":  flowAddr,
			"name":          name,
			"created_at":    createdAt,
		})
	}

	if keys == nil {
		keys = []map[string]interface{}{}
	}
	if accounts == nil {
		accounts = []map[string]interface{}{}
	}

	writeAPIResponse(w, map[string]interface{}{
		"keys":     keys,
		"accounts": accounts,
	}, nil, nil)
}

// POST /api/v1/wallet/sign — Sign a message using custodial key (proxy to flow-keys)
func (s *Server) handleWalletSign(w http.ResponseWriter, r *http.Request) {
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		KeyID   string `json:"key_id"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.KeyID == "" || body.Message == "" {
		writeAPIError(w, http.StatusBadRequest, "key_id and message are required")
		return
	}

	// Call flow-keys edge function to sign
	resp, err := callEdgeFunction("flow-keys", map[string]interface{}{
		"endpoint": "/keys/sign",
		"data": map[string]interface{}{
			"keyId":   body.KeyID,
			"message": body.Message,
		},
	}, userID)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "signing service unavailable")
		return
	}

	// Forward the response
	w.WriteHeader(http.StatusOK)
	w.Write(resp)
}
```

**Step 2: Implement edge function caller**

```go
// callEdgeFunction calls a Supabase edge function with service role auth,
// impersonating the given user_id.
func callEdgeFunction(funcName string, body interface{}, userID string) ([]byte, error) {
	supabaseURL := os.Getenv("SUPABASE_URL")
	if supabaseURL == "" {
		supabaseURL = os.Getenv("VITE_SUPABASE_URL")
	}
	if supabaseURL == "" {
		return nil, fmt.Errorf("SUPABASE_URL not configured")
	}
	serviceKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if serviceKey == "" {
		return nil, fmt.Errorf("SUPABASE_SERVICE_ROLE_KEY not configured")
	}

	// Build a short-lived Supabase JWT for the user
	// The edge function validates this token and extracts user_id
	userToken, err := issueSupabaseUserJWT(userID)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/functions/v1/%s", strings.TrimRight(supabaseURL, "/"), funcName)
	jsonBody, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+userToken)
	req.Header.Set("apikey", serviceKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}

// issueSupabaseUserJWT creates a short-lived JWT that Supabase edge functions accept.
// Uses SUPABASE_JWT_SECRET to sign.
func issueSupabaseUserJWT(userID string) (string, error) {
	secret := os.Getenv("SUPABASE_JWT_SECRET")
	if secret == "" {
		return "", fmt.Errorf("SUPABASE_JWT_SECRET not configured")
	}

	now := time.Now()
	claims := map[string]interface{}{
		"sub":  userID,
		"role": "authenticated",
		"exp":  now.Add(5 * time.Minute).Unix(),
		"iat":  now.Unix(),
		"aud":  "authenticated",
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)

	sigInput := header + "." + payloadB64
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sigInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return sigInput + "." + sig, nil
}
```

**Step 3: Commit**

```bash
git add backend/internal/api/wallet_proxy.go
git commit -m "feat: add wallet/me and wallet/sign proxy endpoints"
```

---

## Task 7: Go — Approval Queue Endpoints

**Files:**
- Create: `backend/internal/api/wallet_approval.go`

**Context:** Three endpoints for the passkey approval flow. Agent creates approval request, polls for completion, wallet app submits the passkey signature.

**Step 1: Implement approval handlers**

```go
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
)

// POST /api/v1/wallet/approve — Create approval request (wallet JWT auth)
func (s *Server) handleWalletApproveCreate(w http.ResponseWriter, r *http.Request) {
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		TxMessageHex  string          `json:"tx_message_hex"`
		CadenceScript string          `json:"cadence_script"`
		CadenceArgs   json.RawMessage `json:"cadence_args"`
		Description   string          `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.TxMessageHex == "" {
		writeAPIError(w, http.StatusBadRequest, "tx_message_hex is required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	var requestID string
	err = pool.QueryRow(r.Context(),
		`INSERT INTO public.wallet_approval_requests
		 (user_id, tx_message_hex, cadence_script, cadence_args, description)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		userID, body.TxMessageHex, body.CadenceScript, body.CadenceArgs, body.Description,
	).Scan(&requestID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create approval request")
		return
	}

	walletURL := os.Getenv("WALLET_APP_URL")
	if walletURL == "" {
		walletURL = "https://wallet.flowindex.io"
	}

	writeAPIResponse(w, map[string]interface{}{
		"request_id":  requestID,
		"approve_url": fmt.Sprintf("%s/approve/%s", walletURL, requestID),
		"expires_in":  300,
	}, nil, nil)
}

// GET /api/v1/wallet/approve/{id} — Poll approval status (wallet JWT auth)
func (s *Server) handleWalletApprovePoll(w http.ResponseWriter, r *http.Request) {
	requestID := mux.Vars(r)["id"]
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	var status string
	var signature *string
	var expiresAt time.Time
	err = pool.QueryRow(r.Context(),
		`SELECT status, signature, expires_at
		 FROM public.wallet_approval_requests
		 WHERE id = $1 AND user_id = $2`,
		requestID, userID,
	).Scan(&status, &signature, &expiresAt)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "approval request not found")
		return
	}

	// Auto-expire
	if time.Now().After(expiresAt) && status == "pending" {
		pool.Exec(r.Context(),
			`UPDATE public.wallet_approval_requests SET status = 'expired' WHERE id = $1`,
			requestID,
		)
		status = "expired"
	}

	resp := map[string]interface{}{
		"status": status,
	}
	if status == "approved" && signature != nil {
		resp["signature"] = *signature
	}
	writeAPIResponse(w, resp, nil, nil)
}

// POST /api/v1/wallet/approve/{id}/sign — Submit passkey signature (Supabase JWT auth)
// Called by wallet app after WebAuthn assertion
func (s *Server) handleWalletApproveSign(w http.ResponseWriter, r *http.Request) {
	requestID := mux.Vars(r)["id"]
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Signature    string `json:"signature"`
		CredentialID string `json:"credential_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.Signature == "" {
		writeAPIError(w, http.StatusBadRequest, "signature is required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	// Verify request belongs to user and is pending
	var status string
	err = pool.QueryRow(r.Context(),
		`SELECT status FROM public.wallet_approval_requests WHERE id = $1 AND user_id = $2`,
		requestID, userID,
	).Scan(&status)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "approval request not found")
		return
	}
	if status != "pending" {
		writeAPIError(w, http.StatusConflict, "request already "+status)
		return
	}

	// Update with signature
	_, err = pool.Exec(r.Context(),
		`UPDATE public.wallet_approval_requests
		 SET status = 'approved', signature = $2, credential_id = $3, resolved_at = now()
		 WHERE id = $1`,
		requestID, body.Signature, body.CredentialID,
	)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to update approval")
		return
	}

	writeAPIResponse(w, map[string]interface{}{"approved": true}, nil, nil)
}
```

**Step 2: Commit**

```bash
git add backend/internal/api/wallet_approval.go
git commit -m "feat: add wallet approval create/poll/sign endpoints"
```

---

## Task 8: Go — Wallet API Key CRUD Endpoints

**Files:**
- Create: `backend/internal/api/wallet_keys.go`

**Context:** CRUD for API keys with `wallet:sign` scope. Reuses existing `api_keys` table. Authenticated via Supabase JWT.

**Step 1: Implement wallet key handlers**

```go
package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
)

// POST /api/v1/wallet/keys — Create wallet API key
func (s *Server) handleWalletKeyCreate(w http.ResponseWriter, r *http.Request) {
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.Name == "" {
		writeAPIError(w, http.StatusBadRequest, "name is required")
		return
	}

	// Generate random key
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to generate key")
		return
	}
	fullKey := "wk_" + hex.EncodeToString(keyBytes)
	prefix := fullKey[:11] // "wk_" + first 8 hex chars

	hash := sha256.Sum256([]byte(fullKey))
	keyHash := hex.EncodeToString(hash[:])

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	var keyID string
	var createdAt interface{}
	err = pool.QueryRow(r.Context(),
		`INSERT INTO public.api_keys (user_id, key_hash, key_prefix, name, scopes, is_active)
		 VALUES ($1, $2, $3, $4, ARRAY['wallet:sign'], true)
		 RETURNING id, created_at`,
		userID, keyHash, prefix, body.Name,
	).Scan(&keyID, &createdAt)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create key")
		return
	}

	writeAPIResponse(w, map[string]interface{}{
		"id":         keyID,
		"name":       body.Name,
		"key":        fullKey, // Only returned once
		"key_prefix": prefix,
		"scopes":     []string{"wallet:sign"},
		"created_at": createdAt,
	}, nil, nil)
}

// GET /api/v1/wallet/keys — List wallet API keys
func (s *Server) handleWalletKeyList(w http.ResponseWriter, r *http.Request) {
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	rows, err := pool.Query(r.Context(),
		`SELECT id, name, key_prefix, scopes, is_active, created_at, last_used
		 FROM public.api_keys
		 WHERE user_id = $1 AND 'wallet:sign' = ANY(scopes)
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to query keys")
		return
	}
	defer rows.Close()

	var keys []map[string]interface{}
	for rows.Next() {
		var id, name, prefix string
		var scopes []string
		var isActive bool
		var createdAt, lastUsed interface{}
		if err := rows.Scan(&id, &name, &prefix, &scopes, &isActive, &createdAt, &lastUsed); err != nil {
			continue
		}
		keys = append(keys, map[string]interface{}{
			"id":         id,
			"name":       name,
			"key_prefix": prefix,
			"scopes":     scopes,
			"is_active":  isActive,
			"created_at": createdAt,
			"last_used":  lastUsed,
		})
	}
	if keys == nil {
		keys = []map[string]interface{}{}
	}

	writeAPIResponse(w, map[string]interface{}{
		"items": keys,
		"count": len(keys),
	}, nil, nil)
}

// DELETE /api/v1/wallet/keys/{id} — Delete wallet API key
func (s *Server) handleWalletKeyDelete(w http.ResponseWriter, r *http.Request) {
	keyID := mux.Vars(r)["id"]
	userID := walletUserIDFromContext(r.Context())
	if userID == "" {
		writeAPIError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	pool, err := getAdminAuthzDBPool()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	tag, err := pool.Exec(r.Context(),
		`DELETE FROM public.api_keys
		 WHERE id = $1 AND user_id = $2 AND 'wallet:sign' = ANY(scopes)`,
		keyID, userID,
	)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to delete key")
		return
	}
	if tag.RowsAffected() == 0 {
		writeAPIError(w, http.StatusNotFound, "key not found")
		return
	}

	writeAPIResponse(w, map[string]interface{}{"deleted": true}, nil, nil)
}
```

**Step 2: Commit**

```bash
git add backend/internal/api/wallet_keys.go
git commit -m "feat: add wallet API key CRUD endpoints"
```

---

## Task 9: Go — Route Registration

**Files:**
- Modify: `backend/internal/api/routes_registration.go`
- Modify: `backend/internal/api/server_bootstrap.go` (if needed for new deps)

**Context:** Register all new wallet routes. Public routes (agent login create/poll) go on the main router. Authenticated routes use subrouters with appropriate middleware.

**Step 1: Add wallet route registration function**

Add to `routes_registration.go`:

```go
func registerWalletRoutes(r *mux.Router, s *Server) {
	// Public: agent login
	r.HandleFunc("/api/v1/wallet/agent/login", s.handleWalletAgentLoginCreate).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/wallet/agent/login/{id}", s.handleWalletAgentLoginPoll).Methods("GET", "OPTIONS")

	// Supabase JWT auth: agent login completion, approval signing, wallet key CRUD
	supabaseAuth := r.PathPrefix("/api/v1/wallet").Subrouter()
	supabaseAuth.Use(supabaseAuthMiddleware)
	supabaseAuth.HandleFunc("/agent/login/{id}/complete", s.handleWalletAgentLoginComplete).Methods("POST", "OPTIONS")
	supabaseAuth.HandleFunc("/approve/{id}/sign", s.handleWalletApproveSign).Methods("POST", "OPTIONS")
	supabaseAuth.HandleFunc("/keys", s.handleWalletKeyCreate).Methods("POST", "OPTIONS")
	supabaseAuth.HandleFunc("/keys", s.handleWalletKeyList).Methods("GET", "OPTIONS")
	supabaseAuth.HandleFunc("/keys/{id}", s.handleWalletKeyDelete).Methods("DELETE", "OPTIONS")

	// Wallet JWT or API key auth: wallet info, signing, approval management
	walletAuth := r.PathPrefix("/api/v1/wallet").Subrouter()
	walletAuth.Use(s.walletAuthMiddleware)
	walletAuth.HandleFunc("/me", s.handleWalletMe).Methods("GET", "OPTIONS")
	walletAuth.HandleFunc("/sign", s.handleWalletSign).Methods("POST", "OPTIONS")
	walletAuth.HandleFunc("/approve", s.handleWalletApproveCreate).Methods("POST", "OPTIONS")
	walletAuth.HandleFunc("/approve/{id}", s.handleWalletApprovePoll).Methods("GET", "OPTIONS")
}
```

**Step 2: Call from NewServer**

In `server_bootstrap.go`, add `registerWalletRoutes(r, s)` in the `NewServer` function alongside the other route registration calls.

**Step 3: Verify build**

```bash
cd backend && go build ./...
```

**Step 4: Commit**

```bash
git add backend/internal/api/routes_registration.go backend/internal/api/server_bootstrap.go
git commit -m "feat: register wallet routes in API server"
```

---

## Task 10: Wallet App — Approval Page

**Files:**
- Create: `wallet/src/pages/Approve.tsx`
- Modify: `wallet/src/App.tsx` (add route)

**Context:** New page at `/approve/:requestId` in the wallet app. User opens this URL from the agent, sees transaction details, approves with passkey (WebAuthn), signature is sent back to the Go backend.

**Step 1: Create approval page component**

Model after `Authz.tsx` but instead of FCL messaging, use fetch API to communicate with Go backend.

```typescript
// wallet/src/pages/Approve.tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@flowindex/flow-ui';
import { Loader2, ShieldCheck, X, ChevronDown, ChevronUp, FileCode2, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '@flowindex/auth-ui';
import { useWallet } from '@/hooks/useWallet';

const API_URL = import.meta.env.VITE_API_URL || '';

interface ApprovalRequest {
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  tx_message_hex: string;
  cadence_script?: string;
  cadence_args?: unknown[];
  description?: string;
  expires_at: string;
}

export default function Approve() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user, passkey } = useAuth();
  const { activeAccount } = useWallet();

  const [request, setRequest] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // Fetch approval request details
  useEffect(() => {
    if (!requestId || !user) return;
    const fetchRequest = async () => {
      try {
        const token = /* get Supabase access token from auth */;
        const res = await fetch(`${API_URL}/api/v1/wallet/approve/${requestId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (!data.data) throw new Error(data.error?.message || 'Not found');
        setRequest(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load request');
      } finally {
        setLoading(false);
      }
    };
    fetchRequest();
  }, [requestId, user]);

  // Countdown timer
  useEffect(() => {
    if (!request?.expires_at) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(request.expires_at).getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) {
        setRequest(prev => prev ? { ...prev, status: 'expired' } : null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [request?.expires_at]);

  // Approve with passkey
  const handleApprove = useCallback(async () => {
    if (!requestId || !request || !activeAccount) return;
    setSigning(true);
    setError(null);
    try {
      // Sign the tx message with passkey (WebAuthn assertion)
      const { signature } = await passkey.signMessage(request.tx_message_hex, activeAccount.credentialId);

      // Submit signature to backend
      const token = /* get Supabase access token */;
      const res = await fetch(`${API_URL}/api/v1/wallet/approve/${requestId}/sign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signature,
          credential_id: activeAccount.credentialId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to approve');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed');
    } finally {
      setSigning(false);
    }
  }, [requestId, request, activeAccount, passkey]);

  const handleReject = useCallback(async () => {
    // Optional: POST to reject endpoint, or just close the page
    window.close();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-wallet-bg flex items-center justify-center">
        <Card className="w-full max-w-md rounded-3xl bg-wallet-surface border-wallet-border">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-8 h-8 animate-spin text-wallet-accent" />
            <p className="text-wallet-muted">Loading approval request...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-wallet-bg flex items-center justify-center">
        <Card className="w-full max-w-md rounded-3xl bg-wallet-surface border-wallet-border">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <ShieldCheck className="w-12 h-12 text-green-400" />
            <p className="text-white text-lg font-semibold">Transaction Approved</p>
            <p className="text-wallet-muted text-sm">You can close this window.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render request details + approve/decline buttons
  // Similar layout to Authz.tsx with Card, expandable script section, action buttons
  return (
    <div className="min-h-screen bg-wallet-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-3xl bg-wallet-surface border-wallet-border">
        <CardHeader className="text-center">
          <CardTitle className="text-white flex items-center justify-center gap-2">
            <ShieldCheck className="w-5 h-5 text-wallet-accent" />
            Agent Transaction Approval
          </CardTitle>
          {timeLeft > 0 && (
            <p className="text-wallet-muted text-sm flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />
              Expires in {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {request?.status === 'expired' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-400 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              This request has expired.
            </div>
          )}

          {request?.description && (
            <div className="bg-wallet-bg rounded-xl p-4">
              <p className="text-white">{request.description}</p>
            </div>
          )}

          {request?.cadence_script && (
            <div>
              <button
                onClick={() => setShowScript(!showScript)}
                className="flex items-center gap-2 text-sm text-wallet-muted hover:text-white transition-colors"
              >
                <FileCode2 className="w-4 h-4" />
                Cadence Script
                {showScript ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showScript && (
                <pre className="mt-2 bg-wallet-bg rounded-xl p-3 text-xs text-wallet-muted overflow-x-auto max-h-48">
                  {request.cadence_script}
                </pre>
              )}
            </div>
          )}

          {request?.cadence_args && (
            <div className="bg-wallet-bg rounded-xl p-3">
              <p className="text-xs text-wallet-muted mb-1">Arguments</p>
              <pre className="text-xs text-white overflow-x-auto">
                {JSON.stringify(request.cadence_args, null, 2)}
              </pre>
            </div>
          )}

          {request?.status === 'pending' && (
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={handleReject}
                disabled={signing}
              >
                Decline
              </Button>
              <Button
                className="flex-1 rounded-xl bg-wallet-accent hover:bg-wallet-accent/90 text-black"
                onClick={handleApprove}
                disabled={signing}
              >
                {signing ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Signing...</>
                ) : (
                  'Approve'
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

In `wallet/src/App.tsx`, add the route alongside existing popup routes (no WalletLayout):

```tsx
import Approve from './pages/Approve';

// Inside <Routes>:
<Route path="/approve/:requestId" element={<Approve />} />
```

**Step 3: Commit**

```bash
git add wallet/src/pages/Approve.tsx wallet/src/App.tsx
git commit -m "feat: add passkey approval page to wallet app"
```

---

## Task 11: Frontend — Wallet API Client

**Files:**
- Modify: `frontend/app/lib/webhookApi.ts` (add wallet functions)

**Context:** Add wallet-related API functions to the existing webhook API client. Uses the same `request<T>()` helper and auth token pattern.

**Step 1: Add wallet API functions**

Append to `webhookApi.ts`:

```typescript
// --- Wallet API Keys ---

export interface WalletAPIKey {
  id: string;
  name: string;
  key?: string;           // Only on create
  key_prefix?: string;
  scopes: string[];
  is_active?: boolean;
  created_at: string;
  last_used?: string | null;
}

export async function listWalletKeys(): Promise<WalletAPIKey[]> {
  const data = await request<{ items: WalletAPIKey[]; count: number }>('/wallet/keys');
  return data.items ?? [];
}

export async function createWalletKey(name: string): Promise<WalletAPIKey> {
  return request<WalletAPIKey>('/wallet/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteWalletKey(id: string): Promise<void> {
  return request<void>(`/wallet/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Agent Sessions ---

export interface AgentSession {
  id: string;
  status: string;
  created_at: string;
  completed_at?: string;
  expires_at: string;
}

export async function listAgentSessions(): Promise<AgentSession[]> {
  const data = await request<{ items: AgentSession[]; count: number }>('/wallet/agent/sessions');
  return data.items ?? [];
}

export async function revokeAgentSession(id: string): Promise<void> {
  return request<void>(`/wallet/agent/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Wallet Info ---

export interface WalletInfo {
  keys: Array<{
    id: string;
    flow_address: string;
    public_key: string;
    key_index: number;
    label: string;
    sig_algo: string;
    hash_algo: string;
    source: string;
    created_at: string;
  }>;
  accounts: Array<{
    credential_id: string;
    public_key: string;
    flow_address: string;
    name: string;
    created_at: string;
  }>;
}

export async function getWalletInfo(): Promise<WalletInfo> {
  return request<WalletInfo>('/wallet/me');
}
```

**Step 2: Commit**

```bash
git add frontend/app/lib/webhookApi.ts
git commit -m "feat: add wallet API client functions to webhookApi"
```

---

## Task 12: Frontend — Developer Portal Wallet Tab

**Files:**
- Create: `frontend/app/routes/developer/wallet.tsx`
- Modify: `frontend/app/components/developer/DeveloperLayout.tsx` (add Wallet tab)

**Context:** New tab in the developer portal. Three sections: Wallet API Keys, Linked Accounts, Agent Sessions. Follows the same patterns as `/developer/keys`.

**Step 1: Add Wallet nav item to DeveloperLayout**

In `DeveloperLayout.tsx`, add to `navItems` array:

```typescript
{ label: 'Wallet', path: '/developer/wallet', icon: Wallet },
```

Import `Wallet` from `lucide-react`.

**Step 2: Create wallet page**

Create `frontend/app/routes/developer/wallet.tsx` following the same patterns as `keys.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Copy, Check, Loader2, Key, Shield, Monitor,
  Smartphone, ExternalLink
} from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import {
  listWalletKeys, createWalletKey, deleteWalletKey,
  getWalletInfo,
  type WalletAPIKey, type WalletInfo
} from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/wallet')({
  component: DeveloperWallet,
})

function DeveloperWallet() {
  // Wallet API keys state
  const [keys, setKeys] = useState<WalletAPIKey[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Wallet info state
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WalletAPIKey | null>(null)
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    try {
      setError(null)
      const data = await listWalletKeys()
      setKeys(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet keys')
    } finally {
      setKeysLoading(false)
    }
  }, [])

  const fetchWalletInfo = useCallback(async () => {
    try {
      const data = await getWalletInfo()
      setWalletInfo(data)
    } catch {
      // Wallet info may not be available if user has no keys
    } finally {
      setInfoLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
    fetchWalletInfo()
  }, [fetchKeys, fetchWalletInfo])

  // Create/delete/copy handlers follow the same pattern as keys.tsx
  // ... (implement standard CRUD modal + list pattern)

  return (
    <DeveloperLayout>
      <div className="p-4 md:p-8 space-y-8 max-w-4xl">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Wallet</h1>
          <p className="text-neutral-400 mt-1">
            Manage wallet API keys for agent signing, view linked accounts.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Section 1: Wallet API Keys */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-neutral-400" />
              Wallet API Keys
            </h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00ef8b] hover:bg-[#00ef8b]/90 text-black text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Key
            </button>
          </div>
          <p className="text-neutral-500 text-sm mb-4">
            Use these keys as <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-xs">FLOWINDEX_TOKEN</code> in your agent-wallet MCP config.
          </p>

          {keysLoading ? (
            <div className="flex items-center gap-2 text-neutral-500 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-neutral-500">
              No wallet API keys yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map(k => (
                <div key={k.id} className="flex items-center justify-between bg-neutral-800/50 border border-neutral-800 rounded-lg p-3">
                  <div>
                    <p className="text-white text-sm font-medium">{k.name}</p>
                    <p className="text-neutral-500 text-xs font-mono">{k.key_prefix}...</p>
                  </div>
                  <button
                    onClick={() => setDeleteTarget(k)}
                    className="text-neutral-500 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Linked Accounts */}
        <section>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-neutral-400" />
            Linked Accounts
          </h2>

          {infoLoading ? (
            <div className="flex items-center gap-2 text-neutral-500 py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Passkey Accounts */}
              {walletInfo?.accounts?.map(acc => (
                <div key={acc.credential_id} className="flex items-center justify-between bg-neutral-800/50 border border-neutral-800 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-5 h-5 text-neutral-400" />
                    <div>
                      <p className="text-white text-sm font-mono">{acc.flow_address}</p>
                      <p className="text-neutral-500 text-xs">{acc.name} (passkey)</p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Custodial Keys */}
              {walletInfo?.keys?.map(key => (
                <div key={key.id} className="flex items-center justify-between bg-neutral-800/50 border border-neutral-800 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <Monitor className="w-5 h-5 text-neutral-400" />
                    <div>
                      <p className="text-white text-sm font-mono">{key.flow_address}</p>
                      <p className="text-neutral-500 text-xs">{key.label || 'Custodial key'} ({key.sig_algo})</p>
                    </div>
                  </div>
                </div>
              ))}

              {(!walletInfo?.accounts?.length && !walletInfo?.keys?.length) && (
                <div className="text-center py-4 text-neutral-500">
                  No linked accounts.{' '}
                  <a href="https://wallet.flowindex.io/settings" target="_blank" rel="noopener"
                    className="text-[#00ef8b] hover:underline inline-flex items-center gap-1">
                    Manage in Wallet <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Modals: Create + Delete (same pattern as keys.tsx) */}
        {/* ... AnimatePresence modals ... */}
      </div>
    </DeveloperLayout>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/app/routes/developer/wallet.tsx frontend/app/components/developer/DeveloperLayout.tsx
git commit -m "feat: add wallet tab to developer portal"
```

---

## Task 13: Frontend — Agent Auth Callback Page

**Files:**
- Create: `frontend/app/routes/agent/auth.tsx`

**Context:** When the agent opens the login URL (`flowindex.io/agent/auth?session=xxx`), this page handles authentication and calls the backend to complete the session.

**Step 1: Create auth callback page**

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

export const Route = createFileRoute('/agent/auth')({
  component: AgentAuth,
})

function AgentAuth() {
  const { user, loading: authLoading } = useAuth()
  const [status, setStatus] = useState<'loading' | 'authenticating' | 'completing' | 'done' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const sessionId = new URLSearchParams(window.location.search).get('session')

  useEffect(() => {
    if (authLoading) return
    if (!sessionId) {
      setError('Missing session parameter')
      setStatus('error')
      return
    }
    if (!user) {
      // Redirect to login, then back here
      setStatus('authenticating')
      // The auth provider should handle redirect
      window.location.href = `/developer/login?redirect=${encodeURIComponent(window.location.href)}`
      return
    }

    // User is authenticated — complete the agent login session
    const completeLogin = async () => {
      setStatus('completing')
      try {
        const token = /* get Supabase access token */;
        const API_URL = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${API_URL}/api/v1/wallet/agent/login/${sessionId}/complete`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to complete login')
        setStatus('done')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to complete login')
        setStatus('error')
      }
    }
    completeLogin()
  }, [user, authLoading, sessionId])

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 max-w-sm w-full text-center">
        {status === 'loading' && <p className="text-neutral-400">Loading...</p>}
        {status === 'authenticating' && <p className="text-neutral-400">Redirecting to login...</p>}
        {status === 'completing' && (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-neutral-700 border-t-[#00ef8b] rounded-full mx-auto mb-4" />
            <p className="text-white">Linking wallet to agent...</p>
          </>
        )}
        {status === 'done' && (
          <>
            <div className="w-12 h-12 rounded-full bg-[#00ef8b]/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-[#00ef8b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white text-lg font-semibold">Connected!</p>
            <p className="text-neutral-400 mt-2 text-sm">
              Your wallet is now linked to the agent. You can close this window.
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-white text-lg font-semibold">Error</p>
            <p className="text-red-400 mt-2 text-sm">{error}</p>
          </>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/routes/agent/auth.tsx
git commit -m "feat: add agent auth callback page"
```

---

## Task 14: Agent-Wallet MCP — Update CloudSigner

**Files:**
- Modify: `packages/agent-wallet/src/signer/cloud.ts`
- Modify: `packages/agent-wallet/src/tools/wallet.ts`

**Context:** Connect the CloudSigner stub to real backend endpoints. The `wallet_login` tool triggers `POST /wallet/agent/login` and `wallet_login_status` polls it.

**Step 1: Update CloudSigner to use real endpoints**

```typescript
// cloud.ts — key changes:

async init(): Promise<void> {
  if (this.token) {
    // Pre-authenticated: fetch wallet info
    const res = await fetch(`${this.baseUrl}/api/v1/wallet/me`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    const data = await res.json();
    if (data.data?.keys?.length > 0) {
      const key = data.data.keys[0];
      this.flowAddress = key.flow_address;
      this.keyId = key.id;
      this.keyIndex = key.key_index;
    }
    this.ready = true;
  }
  // else: wait for interactive login via wallet_login tool
}

async signFlowTransaction(messageHex: string): Promise<string> {
  if (!this.token || !this.keyId) throw new Error('Not authenticated');
  const res = await fetch(`${this.baseUrl}/api/v1/wallet/sign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key_id: this.keyId, message: messageHex }),
  });
  const data = await res.json();
  if (!data.success && !data.data?.signature) {
    throw new Error(data.error?.message || 'Signing failed');
  }
  return data.data.signature;
}
```

**Step 2: Update wallet tools to use real login endpoints**

```typescript
// tools/wallet.ts — wallet_login handler:

// POST /wallet/agent/login
const res = await fetch(`${ctx.config.flowindexUrl}/api/v1/wallet/agent/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
});
const data = await res.json();
return {
  content: [{
    type: 'text',
    text: JSON.stringify({
      session_id: data.data.session_id,
      login_url: data.data.login_url,
      message: 'Please open this URL to authenticate your wallet',
    }),
  }],
};

// wallet_login_status handler:
const res = await fetch(`${ctx.config.flowindexUrl}/api/v1/wallet/agent/login/${sessionId}`);
const data = await res.json();
if (data.data.status === 'completed' && data.data.token) {
  // Store token in CloudSigner
  ctx.cloudSigner.setToken(data.data.token);
  await ctx.cloudSigner.init();
}
```

**Step 3: Commit**

```bash
git add packages/agent-wallet/src/signer/cloud.ts packages/agent-wallet/src/tools/wallet.ts
git commit -m "feat: connect CloudSigner + wallet tools to real backend endpoints"
```

---

## Task 15: Agent-Wallet MCP — Update PasskeySigner

**Files:**
- Modify: `packages/agent-wallet/src/signer/passkey.ts`

**Context:** Connect the PasskeySigner stub to real approval endpoints. Creates approval request, returns URL, polls for signature.

**Step 1: Update PasskeySigner**

```typescript
// passkey.ts — key changes:

async signFlowTransaction(messageHex: string): Promise<string> {
  if (!this.token) throw new Error('Not authenticated');

  // Create approval request
  const createRes = await fetch(`${this.baseUrl}/api/v1/wallet/approve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_message_hex: messageHex,
      description: this.pendingDescription || 'Transaction signing requested',
      cadence_script: this.pendingCadence,
      cadence_args: this.pendingArgs,
    }),
  });
  const createData = await createRes.json();
  const requestId = createData.data.request_id;
  const approveUrl = createData.data.approve_url;

  // Store for the approval manager to surface
  this.lastApproveUrl = approveUrl;
  this.lastRequestId = requestId;

  // Poll for approval (up to 5 minutes)
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`${this.baseUrl}/api/v1/wallet/approve/${requestId}`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    const pollData = await pollRes.json();
    if (pollData.data.status === 'approved') {
      return pollData.data.signature;
    }
    if (pollData.data.status === 'rejected' || pollData.data.status === 'expired') {
      throw new Error(`Approval ${pollData.data.status}`);
    }
  }
  throw new Error('Approval timed out');
}
```

**Step 2: Commit**

```bash
git add packages/agent-wallet/src/signer/passkey.ts
git commit -m "feat: connect PasskeySigner to real approval endpoints"
```

---

## Task 16: Build Verification & Integration Test

**Files:**
- None new — verify existing code compiles

**Step 1: Verify Go backend builds**

```bash
cd backend && go build ./...
```

Expected: No errors.

**Step 2: Verify agent-wallet builds**

```bash
cd packages/agent-wallet && bun run build
```

Expected: No errors.

**Step 3: Verify frontend builds**

```bash
cd frontend && bun run build
```

Expected: No errors (may need `NODE_OPTIONS="--max-old-space-size=8192"`).

**Step 4: Verify wallet app builds**

```bash
cd wallet && bun run build
```

Expected: No errors.

**Step 5: Commit any build fixes**

```bash
git add -A && git commit -m "fix: resolve build issues from wallet infrastructure integration"
```

---

## Task 17: README Updates

**Files:**
- Modify: `packages/agent-wallet/README.md`

**Context:** Update the agent-wallet README to document the cloud wallet login flow and passkey approval flow now that the backend endpoints exist.

**Step 1: Add Cloud Wallet section to README**

Add documentation for:
- Zero-config setup (how `wallet_login` works end-to-end)
- Pre-authenticated setup with `FLOWINDEX_TOKEN`
- Wallet API key generation via flowindex.io/developer/wallet
- Passkey approval flow description

**Step 2: Commit**

```bash
git add packages/agent-wallet/README.md
git commit -m "docs: update agent-wallet README with cloud wallet setup instructions"
```
