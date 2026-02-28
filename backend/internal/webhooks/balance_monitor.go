package webhooks

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	flowsdk "github.com/onflow/flow-go-sdk"

	"flowscan-clone/internal/eventbus"
	flowclient "flowscan-clone/internal/flow"
)

// BalanceMonitor periodically checks FLOW token balances for subscribed
// addresses and publishes balance.check events to the event bus.
type BalanceMonitor struct {
	bus      *eventbus.Bus
	cache    *SubscriptionCache
	client   *flowclient.Client
	interval time.Duration
}

// NewBalanceMonitor creates a BalanceMonitor that checks balances every interval.
func NewBalanceMonitor(bus *eventbus.Bus, cache *SubscriptionCache, client *flowclient.Client, interval time.Duration) *BalanceMonitor {
	return &BalanceMonitor{
		bus:      bus,
		cache:    cache,
		client:   client,
		interval: interval,
	}
}

// Run starts the periodic balance check loop until context is cancelled.
func (bm *BalanceMonitor) Run(ctx context.Context) {
	log.Printf("[balance_monitor] started (interval=%s)", bm.interval)
	ticker := time.NewTicker(bm.interval)
	defer ticker.Stop()

	// Run once immediately on startup.
	bm.check(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Println("[balance_monitor] shutting down")
			return
		case <-ticker.C:
			bm.check(ctx)
		}
	}
}

// check iterates all balance.check subscriptions, extracts unique addresses,
// queries their FLOW balance, and publishes events.
func (bm *BalanceMonitor) check(ctx context.Context) {
	subs := bm.cache.GetByType("balance.check")
	if len(subs) == 0 {
		return
	}

	// Collect unique addresses across all balance.check subscriptions.
	addrSet := make(map[string]bool)
	for _, sub := range subs {
		addrs := extractAddresses(sub.Conditions)
		for _, a := range addrs {
			addrSet[strings.ToLower(strings.TrimPrefix(a, "0x"))] = true
		}
	}

	if len(addrSet) == 0 {
		return
	}

	now := time.Now()
	published := 0

	for addr := range addrSet {
		balance, err := bm.queryBalance(ctx, addr)
		if err != nil {
			log.Printf("[balance_monitor] failed to query balance for %s: %v", addr, err)
			continue
		}

		// Balance is in UFix64 (1 FLOW = 100_000_000 units).
		balanceFlow := float64(balance) / 100_000_000.0

		data := map[string]interface{}{
			"address":     addr,
			"balance":     fmt.Sprintf("%.8f", balanceFlow),
			"balance_raw": balance,
			"token":       "FLOW",
		}

		bm.bus.Publish(eventbus.Event{
			Type:      "balance.check",
			Height:    0,
			Timestamp: now,
			Data:      data,
		})
		published++
	}

	if published > 0 {
		log.Printf("[balance_monitor] published %d balance checks", published)
	}
}

// queryBalance queries the Flow blockchain for the account's FLOW balance.
func (bm *BalanceMonitor) queryBalance(ctx context.Context, hexAddr string) (uint64, error) {
	addr := flowsdk.HexToAddress(hexAddr)
	account, err := bm.client.GetAccount(ctx, addr)
	if err != nil {
		return 0, err
	}
	return account.Balance, nil
}

// extractAddresses parses the addresses field from subscription conditions JSON.
func extractAddresses(conditions json.RawMessage) []string {
	if len(conditions) == 0 {
		return nil
	}
	var cond struct {
		Addresses json.RawMessage `json:"addresses"`
	}
	if err := json.Unmarshal(conditions, &cond); err != nil || len(cond.Addresses) == 0 {
		return nil
	}

	// Try array of strings
	var arr []string
	if err := json.Unmarshal(cond.Addresses, &arr); err == nil {
		return arr
	}
	// Try single comma-separated string
	var s string
	if err := json.Unmarshal(cond.Addresses, &s); err == nil && s != "" {
		parts := strings.Split(s, ",")
		result := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				result = append(result, p)
			}
		}
		return result
	}
	return nil
}
