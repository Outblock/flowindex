package api

import (
	"net/http"
	"sync"
	"time"
)

// responseCache is a simple in-memory cache for slow API responses.
// Each entry stores the serialized JSON response and an expiry time.
type responseCache struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry
}

type cacheEntry struct {
	body      []byte
	expiresAt time.Time
}

var apiCache = &responseCache{
	entries: make(map[string]*cacheEntry),
}

// get returns cached response bytes if the key exists and hasn't expired.
func (c *responseCache) get(key string) ([]byte, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		return nil, false
	}
	return e.body, true
}

// set stores a response in the cache with the given TTL.
func (c *responseCache) set(key string, body []byte, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = &cacheEntry{
		body:      body,
		expiresAt: time.Now().Add(ttl),
	}
}

// cachedHandler wraps an http.Handler to cache its JSON response for the given TTL.
// The cache key is the request URL path + query string.
func cachedHandler(ttl time.Duration, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Path + "?" + r.URL.RawQuery

		if body, ok := apiCache.get(key); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			w.Write(body)
			return
		}

		// Capture the response
		rec := &responseRecorder{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}
		handler(rec, r)

		// Only cache successful responses
		if rec.statusCode >= 200 && rec.statusCode < 300 && len(rec.body) > 0 {
			apiCache.set(key, rec.body, ttl)
		}
	}
}

// responseRecorder captures the response body while still writing to the client.
type responseRecorder struct {
	http.ResponseWriter
	statusCode int
	body       []byte
}

func (r *responseRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	r.body = append(r.body, b...)
	return r.ResponseWriter.Write(b)
}
