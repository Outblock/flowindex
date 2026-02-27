package webhooks

import (
	"context"
	"log"
	"sync"
	"time"
)

// SubscriptionCache caches active subscriptions grouped by event type.
// It uses a TTL-based invalidation strategy with double-check locking
// to ensure thread safety while minimising database queries.
type SubscriptionCache struct {
	store    *Store
	ttl      time.Duration
	mu       sync.RWMutex
	byType   map[string][]Subscription
	loadedAt time.Time
}

// NewSubscriptionCache creates a new SubscriptionCache that refreshes
// from the store every ttl duration.
func NewSubscriptionCache(store *Store, ttl time.Duration) *SubscriptionCache {
	return &SubscriptionCache{
		store:  store,
		ttl:    ttl,
		byType: make(map[string][]Subscription),
	}
}

// GetByType returns cached subscriptions for the given event type.
// If the cache is stale (older than TTL), it refreshes from the database.
func (c *SubscriptionCache) GetByType(eventType string) []Subscription {
	// Fast path: read lock, check if cache is still fresh
	c.mu.RLock()
	if time.Since(c.loadedAt) < c.ttl {
		subs := c.byType[eventType]
		c.mu.RUnlock()
		return subs
	}
	c.mu.RUnlock()

	// Slow path: write lock, double-check, refresh if still stale
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock; another goroutine may
	// have refreshed while we were waiting.
	if time.Since(c.loadedAt) < c.ttl {
		return c.byType[eventType]
	}

	c.refreshLocked()
	return c.byType[eventType]
}

// Invalidate forces the cache to refresh on the next GetByType call.
func (c *SubscriptionCache) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loadedAt = time.Time{} // zero time => always stale
}

// refreshLocked reloads all subscription data from the store.
// Caller must hold c.mu in write mode.
func (c *SubscriptionCache) refreshLocked() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Fetch all active subscriptions grouped by event type.
	// We query each known event type. In practice the set of event types
	// is small (10-15) so this is acceptable.
	newByType := make(map[string][]Subscription)

	for _, et := range SupportedEventTypes {
		subs, err := c.store.GetActiveSubscriptionsByType(ctx, et)
		if err != nil {
			log.Printf("[cache] error loading subscriptions for %s: %v", et, err)
			continue
		}
		if len(subs) > 0 {
			newByType[et] = subs
		}
	}

	c.byType = newByType
	c.loadedAt = time.Now()

	total := 0
	for _, subs := range newByType {
		total += len(subs)
	}
	log.Printf("[cache] refreshed: %d subscriptions across %d event types", total, len(newByType))
}
