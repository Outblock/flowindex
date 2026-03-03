package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ---------------------------------------------------------------------------
// Shared token-bucket map (keyed by IP or userID)
// ---------------------------------------------------------------------------

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type bucketMap struct {
	mu          sync.Mutex
	entries     map[string]*limiterEntry
	lastCleanup time.Time
	ttl         time.Duration
}

func newBucketMap(ttl time.Duration) *bucketMap {
	return &bucketMap{entries: make(map[string]*limiterEntry), ttl: ttl}
}

// allow checks the token bucket for key, creating or updating it with the given rps/burst.
func (bm *bucketMap) allow(key string, rps rate.Limit, burst int) bool {
	now := time.Now()
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// Periodic cleanup.
	if bm.lastCleanup.IsZero() || now.Sub(bm.lastCleanup) > time.Minute {
		for k, v := range bm.entries {
			if now.Sub(v.lastSeen) > bm.ttl {
				delete(bm.entries, k)
			}
		}
		bm.lastCleanup = now
	}

	ent := bm.entries[key]
	if ent == nil {
		ent = &limiterEntry{limiter: rate.NewLimiter(rps, burst), lastSeen: now}
		bm.entries[key] = ent
	} else {
		ent.lastSeen = now
		// Adjust rate if tier changed.
		if ent.limiter.Limit() != rps {
			ent.limiter.SetLimit(rps)
			ent.limiter.SetBurst(burst)
		}
	}
	return ent.limiter.Allow()
}

// ---------------------------------------------------------------------------
// Package-level state
// ---------------------------------------------------------------------------

var (
	ipBuckets    = newBucketMap(15 * time.Minute)
	userBuckets  = newBucketMap(15 * time.Minute)
	anonRPS      rate.Limit
	anonBurst    int
)

func init() {
	rps := 5.0
	if v := strings.TrimSpace(os.Getenv("API_RATE_LIMIT_RPS")); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			rps = n
		}
	}
	burst := int(rps * 2)
	if burst < 1 {
		burst = 1
	}
	if v := strings.TrimSpace(os.Getenv("API_RATE_LIMIT_BURST")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			burst = n
		}
	}
	if v := strings.TrimSpace(os.Getenv("API_RATE_LIMIT_TTL_MIN")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			ttl := time.Duration(n) * time.Minute
			ipBuckets.ttl = ttl
			userBuckets.ttl = ttl
		}
	}
	anonRPS = rate.Limit(rps)
	anonBurst = burst
}

// ---------------------------------------------------------------------------
// Tier RPS cache (avoids DB hit on every authenticated request)
// ---------------------------------------------------------------------------

const (
	tierCacheTTL    = 5 * time.Minute
	defaultAuthedRPS = 20
)

type rpsCache struct {
	mu      sync.Mutex
	entries map[string]rpsCacheEntry
}

type rpsCacheEntry struct {
	rps       int
	fetchedAt time.Time
}

var tierRPSCache = &rpsCache{entries: make(map[string]rpsCacheEntry)}

func (c *rpsCache) get(userID string) (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ent, ok := c.entries[userID]
	if !ok || time.Since(ent.fetchedAt) > tierCacheTTL {
		return 0, false
	}
	return ent.rps, true
}

func (c *rpsCache) set(userID string, rps int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[userID] = rpsCacheEntry{rps: rps, fetchedAt: time.Now()}
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	if anonRPS <= 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Exempt lightweight endpoints.
		switch {
		case r.URL.Path == "/health",
			strings.HasPrefix(r.URL.Path, "/openapi."),
			r.URL.Path == "/ws":
			next.ServeHTTP(w, r)
			return
		}

		// --- Authenticated path (X-API-Key) ---
		if apiKey := strings.TrimSpace(r.Header.Get("X-API-Key")); apiKey != "" && s.apiKeyResolver != nil {
			hash := sha256Hash(apiKey)
			userID, err := s.apiKeyResolver(r.Context(), hash)
			if err != nil || userID == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"error":"invalid_api_key","message":"the provided API key is invalid or inactive"}`))
				return
			}

			// Resolve tier RPS (cached for 5 min).
			rps := defaultAuthedRPS
			if cached, ok := tierRPSCache.get(userID); ok {
				rps = cached
			} else if s.tierRPSResolver != nil {
				if tierRPS, err := s.tierRPSResolver(r.Context(), userID); err == nil && tierRPS > 0 {
					rps = tierRPS
				}
				tierRPSCache.set(userID, rps)
			}

			limit := rate.Limit(rps)
			burst := rps * 2
			if burst < 1 {
				burst = 1
			}
			if !userBuckets.allow(userID, limit, burst) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rps))
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":"rate_limited","message":"too many requests"}`))
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// --- Unauthenticated path (IP-based) ---
		ip := clientIP(r)
		if ip == "" {
			ip = "unknown"
		}
		if !ipBuckets.allow(ip, anonRPS, anonBurst) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(int(anonRPS)))
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate_limited","message":"too many requests"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func sha256Hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
	}
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
		return xr
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
