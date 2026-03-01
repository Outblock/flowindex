package matcher

import (
	"encoding/json"
	"sort"
	"testing"
)

func TestRegistry_RegisterAndGet(t *testing.T) {
	r := NewRegistry()
	m := &FTTransferMatcher{}
	r.Register(m)

	got := r.Get("ft.transfer")
	if got == nil {
		t.Fatal("expected matcher, got nil")
	}
	if got.EventType() != "ft.transfer" {
		t.Fatalf("expected ft.transfer, got %s", got.EventType())
	}
}

func TestRegistry_GetUnknown(t *testing.T) {
	r := NewRegistry()
	if r.Get("nonexistent") != nil {
		t.Fatal("expected nil for unknown event type")
	}
}

func TestRegistry_EventTypes(t *testing.T) {
	r := NewRegistry()
	r.Register(&FTTransferMatcher{})
	r.Register(&NFTTransferMatcher{})

	types := r.EventTypes()
	sort.Strings(types)
	if len(types) != 2 {
		t.Fatalf("expected 2 types, got %d", len(types))
	}
	if types[0] != "ft.transfer" || types[1] != "nft.transfer" {
		t.Fatalf("unexpected types: %v", types)
	}
}

func TestAllMatchersRegistered(t *testing.T) {
	r := NewRegistry()
	RegisterAll(r)

	expected := []string{
		"balance.check",
		"ft.transfer",
		"ft.large_transfer",
		"nft.transfer",
		"address.activity",
		"contract.event",
		"staking.event",
		"defi.swap",
		"defi.liquidity",
		"account.key_change",
		"evm.transaction",
	}

	types := r.EventTypes()
	if len(types) != len(expected) {
		t.Fatalf("expected %d matchers, got %d: %v", len(expected), len(types), types)
	}

	for _, e := range expected {
		if r.Get(e) == nil {
			t.Errorf("matcher %q not registered", e)
		}
	}
}

func TestMatcherWrongDataType(t *testing.T) {
	r := NewRegistry()
	RegisterAll(r)

	// Every matcher should return Matched=false when given the wrong data type
	wrongData := "not a model struct"
	cond := json.RawMessage(`{}`)

	for _, et := range r.EventTypes() {
		m := r.Get(et)
		if m.Match(wrongData, cond).Matched {
			t.Errorf("matcher %q should return Matched=false for wrong data type", et)
		}
	}
}
