package webhooks

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// RateLimiter enforces per-user rate limits based on their tier.
type RateLimiter struct {
	store    *Store
	mu       sync.Mutex
	counters map[string]*userCounter
}

type userCounter struct {
	apiCalls    int
	apiWindow   time.Time
	deliveries  int
	delivWindow time.Time
}

// NewRateLimiter creates a RateLimiter backed by the given store for tier lookups.
func NewRateLimiter(store *Store) *RateLimiter {
	return &RateLimiter{
		store:    store,
		counters: make(map[string]*userCounter),
	}
}

// CheckAPIRate enforces the per-minute API call limit for a user.
func (rl *RateLimiter) CheckAPIRate(ctx context.Context, userID string) error {
	tier, err := rl.store.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to look up user tier: %w", err)
	}
	if tier.MaxAPIRequests <= 0 {
		return nil // unlimited
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	c := rl.getOrCreate(userID)
	now := time.Now()

	// Reset window if expired (1-minute sliding window)
	if now.After(c.apiWindow) {
		c.apiCalls = 0
		c.apiWindow = now.Add(1 * time.Minute)
	}

	if c.apiCalls >= tier.MaxAPIRequests {
		return fmt.Errorf("API rate limit exceeded (%d requests/min)", tier.MaxAPIRequests)
	}

	c.apiCalls++
	return nil
}

// CheckDeliveryRate enforces the per-hour delivery limit for a user.
func (rl *RateLimiter) CheckDeliveryRate(ctx context.Context, userID string) error {
	tier, err := rl.store.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to look up user tier: %w", err)
	}
	if tier.MaxEventsPerHour <= 0 {
		return nil // unlimited
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	c := rl.getOrCreate(userID)
	now := time.Now()

	// Reset window if expired (1-hour sliding window)
	if now.After(c.delivWindow) {
		c.deliveries = 0
		c.delivWindow = now.Add(1 * time.Hour)
	}

	if c.deliveries >= tier.MaxEventsPerHour {
		return fmt.Errorf("delivery rate limit exceeded (%d events/hour)", tier.MaxEventsPerHour)
	}

	c.deliveries++
	return nil
}

// CheckSubscriptionLimit checks whether the user can create another subscription.
func (rl *RateLimiter) CheckSubscriptionLimit(ctx context.Context, userID string) error {
	tier, err := rl.store.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to look up user tier: %w", err)
	}
	if tier.MaxSubscriptions <= 0 {
		return nil // unlimited
	}

	count, err := rl.store.CountUserSubscriptions(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to count subscriptions: %w", err)
	}

	if count >= tier.MaxSubscriptions {
		return fmt.Errorf("subscription limit reached (%d/%d)", count, tier.MaxSubscriptions)
	}
	return nil
}

// CheckEndpointLimit checks whether the user can create another endpoint.
func (rl *RateLimiter) CheckEndpointLimit(ctx context.Context, userID string) error {
	tier, err := rl.store.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to look up user tier: %w", err)
	}
	if tier.MaxEndpoints <= 0 {
		return nil // unlimited
	}

	count, err := rl.store.CountUserEndpoints(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to count endpoints: %w", err)
	}

	if count >= tier.MaxEndpoints {
		return fmt.Errorf("endpoint limit reached (%d/%d)", count, tier.MaxEndpoints)
	}
	return nil
}

// getOrCreate returns the counter for a user, creating one if needed.
// Must be called with rl.mu held.
func (rl *RateLimiter) getOrCreate(userID string) *userCounter {
	c, ok := rl.counters[userID]
	if !ok {
		c = &userCounter{}
		rl.counters[userID] = c
	}
	return c
}
