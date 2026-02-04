package api

import (
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

var apiIPLimiter = newIPLimiterFromEnv()

func newIPLimiterFromEnv() *ipLimiter {
	rps := 10.0
	if v := strings.TrimSpace(os.Getenv("API_RATE_LIMIT_RPS")); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			rps = n
		}
	}
	burst := 20
	if v := strings.TrimSpace(os.Getenv("API_RATE_LIMIT_BURST")); v != "" {
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

func rateLimitMiddleware(next http.Handler) http.Handler {
	// Disable if rps <= 0
	if apiIPLimiter == nil || apiIPLimiter.rps <= 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Exempt lightweight endpoints and tooling endpoints.
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

func (l *ipLimiter) allow(ip string) bool {
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

	ent := l.entries[ip]
	if ent == nil {
		ent = &ipLimiterEntry{
			limiter:  rate.NewLimiter(l.rps, l.burst),
			lastSeen: now,
		}
		l.entries[ip] = ent
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
