package webhooks

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"flowscan-clone/internal/eventbus"
)

func TestBalanceMonitor_PublishesOnlyAfterBalanceChanges(t *testing.T) {
	bus := eventbus.New()
	defer bus.Close()

	received := make(chan eventbus.Event, 2)
	bus.Subscribe("balance.check", received)

	cache := &SubscriptionCache{
		byType: map[string][]Subscription{
			"balance.check": {
				{
					EventType: "balance.check",
					Conditions: json.RawMessage(
						`{"addresses":["1654653399040a61"],"token_contract":"A.1654653399040a61.FlowToken","direction":"any"}`,
					),
				},
			},
		},
		loadedAt: time.Now(),
		ttl:      time.Minute,
	}

	current := "100.0"
	monitor := &BalanceMonitor{
		bus:      bus,
		cache:    cache,
		interval: time.Second,
		lastSeen: make(map[string]string),
		queryFlowBalance: func(ctx context.Context, hexAddr string) (string, error) {
			return current, nil
		},
		queryTokenBalance: func(ctx context.Context, address, contractAddress, contractName string) (string, error) {
			t.Fatalf("token balance query should not be used for FLOW targets")
			return "", nil
		},
	}

	monitor.check(context.Background())
	select {
	case <-received:
		t.Fatal("first observation should not publish a balance.check event")
	default:
	}

	current = "80.0"
	monitor.check(context.Background())

	select {
	case evt := <-received:
		data := evt.Data.(map[string]interface{})
		if data["balance"] != "80.0" || data["previous_balance"] != "100.0" {
			t.Fatalf("unexpected balance payload: %#v", data)
		}
	case <-time.After(time.Second):
		t.Fatal("expected balance.check event after balance changed")
	}
}

func TestBalanceMonitor_UsesTokenHoldingsForNonFlowTargets(t *testing.T) {
	bus := eventbus.New()
	defer bus.Close()

	cache := &SubscriptionCache{
		byType: map[string][]Subscription{
			"balance.check": {
				{
					EventType: "balance.check",
					Conditions: json.RawMessage(
						`{"addresses":["1654653399040a61"],"token_contract":"A.b19436aae4d94622.FiatToken","direction":"any"}`,
					),
				},
			},
		},
		loadedAt: time.Now(),
		ttl:      time.Minute,
	}

	tokenQueries := 0
	monitor := &BalanceMonitor{
		bus:      bus,
		cache:    cache,
		interval: time.Second,
		lastSeen: map[string]string{
			"1654653399040a61|a.b19436aae4d94622.fiattoken": "10.0",
		},
		queryFlowBalance: func(ctx context.Context, hexAddr string) (string, error) {
			t.Fatalf("FLOW balance query should not be used for FiatToken targets")
			return "", nil
		},
		queryTokenBalance: func(ctx context.Context, address, contractAddress, contractName string) (string, error) {
			tokenQueries++
			if contractAddress != "b19436aae4d94622" || contractName != "FiatToken" {
				t.Fatalf("unexpected token query target: %s %s", contractAddress, contractName)
			}
			return "15.5", nil
		},
	}

	monitor.check(context.Background())

	if tokenQueries != 1 {
		t.Fatalf("expected one token holdings query, got %d", tokenQueries)
	}
}
