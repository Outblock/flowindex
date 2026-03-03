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

type ipLimiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type ipLimiter struct {
	mu          sync.Mutex
	entries     map[string]*ipLimiterEntry
	lastCleanup time.Time

	rps   rate.Limit
	burst int
	ttl   time.Duration
}

// Package-level limiters initialised once from env vars.
var (
	apiIPLimiter    = newIPLimiterFromEnv("API_RATE_LIMIT_RPS", 30, "API_RATE_LIMIT_BURST", 60)
	apiAuthedLimiter = newIPLimiterFromEnv("API_RATE_LIMIT_AUTHED_RPS", 300, "API_RATE_LIMIT_AUTHED_BURST", 600)
)

func newIPLimiterFromEnv(rpsEnv string, rpsDefault float64, burstEnv string, burstDefault int) *ipLimiter {
	rps := rpsDefault
	if v := strings.TrimSpace(os.Getenv(rpsEnv)); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			rps = n
		}
	}
	burst := burstDefault
	if v := strings.TrimSpace(os.Getenv(burstEnv)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			burst = n
		}
	}
	ttl := 15 * time.Minute
	if v := strings.TrimSpace(os.Getenv("API_RATE_LIMIT_TTL_MIN")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			ttl = time.Duration(n) * time.Minute
		}
	}
	return &ipLimiter{
		entries: make(map[string]*ipLimiterEntry),
		rps:     rate.Limit(rps),
		burst:   burst,
		ttl:     ttl,
	}
}

// rateLimitMiddleware is a method on Server so it can access apiKeyResolver.
func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	// Disable if rps <= 0
	if apiIPLimiter == nil || apiIPLimiter.rps <= 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Exempt lightweight endpoints.
		switch {
		case r.URL.Path == "/health":
			next.ServeHTTP(w, r)
			return
		case strings.HasPrefix(r.URL.Path, "/openapi."):
			next.ServeHTTP(w, r)
			return
		case r.URL.Path == "/ws":
			next.ServeHTTP(w, r)
			return
		}

		// Check for API key — authenticated requests get higher limits.
		if apiKey := strings.TrimSpace(r.Header.Get("X-API-Key")); apiKey != "" && s.apiKeyResolver != nil {
			hash := sha256Hash(apiKey)
			userID, err := s.apiKeyResolver(r.Context(), hash)
			if err != nil || userID == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"error":"invalid_api_key","message":"the provided API key is invalid or inactive"}`))
				return
			}

			// Rate-limit by userID with higher limits.
			if !apiAuthedLimiter.allow(userID) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(int(apiAuthedLimiter.rps)))
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":"rate_limited","message":"too many requests"}`))
				return
			}

			next.ServeHTTP(w, r)
			return
		}

		// Unauthenticated — IP-based low rate limit.
		ip := clientIP(r)
		if ip == "" {
			ip = "unknown"
		}

		if !apiIPLimiter.allow(ip) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(int(apiIPLimiter.rps)))
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate_limited","message":"too many requests"}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}

func sha256Hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func (l *ipLimiter) allow(key string) bool {
	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	// Periodic cleanup (amortized).
	if l.lastCleanup.IsZero() || now.Sub(l.lastCleanup) > time.Minute {
		for k, v := range l.entries {
			if now.Sub(v.lastSeen) > l.ttl {
				delete(l.entries, k)
			}
		}
		l.lastCleanup = now
	}

	ent := l.entries[key]
	if ent == nil {
		ent = &ipLimiterEntry{
			limiter:  rate.NewLimiter(l.rps, l.burst),
			lastSeen: now,
		}
		l.entries[key] = ent
	} else {
		ent.lastSeen = now
	}

	return ent.limiter.Allow()
}

func clientIP(r *http.Request) string {
	// Prefer X-Forwarded-For, set by our nginx proxy.
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
