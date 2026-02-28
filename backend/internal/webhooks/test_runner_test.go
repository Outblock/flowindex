package webhooks

import (
	"encoding/json"
	"testing"

	"flowscan-clone/internal/webhooks/matcher"
)

func newTestRegistry() *matcher.Registry {
	reg := matcher.NewRegistry()
	matcher.RegisterAll(reg)
	return reg
}

func TestBuildMockEventData_FTTransfer(t *testing.T) {
	// Verify defaults
	data := BuildMockEventData("ft.transfer", nil)
	if data["from_address"] != "1654653399040a61" {
		t.Errorf("expected default from_address, got %v", data["from_address"])
	}
	if data["amount"] != "100.0" {
		t.Errorf("expected default amount 100.0, got %v", data["amount"])
	}
	if data["contract_name"] != "FlowToken" {
		t.Errorf("expected default contract_name FlowToken, got %v", data["contract_name"])
	}

	// Verify overrides
	data = BuildMockEventData("ft.transfer", map[string]interface{}{
		"amount":       "500.0",
		"from_address": "abc123",
	})
	if data["amount"] != "500.0" {
		t.Errorf("expected overridden amount 500.0, got %v", data["amount"])
	}
	if data["from_address"] != "abc123" {
		t.Errorf("expected overridden from_address, got %v", data["from_address"])
	}
	// Non-overridden fields should keep defaults
	if data["contract_name"] != "FlowToken" {
		t.Errorf("expected default contract_name to remain, got %v", data["contract_name"])
	}
}

func TestBuildMockEventData_AllTypes(t *testing.T) {
	types := []string{
		"ft.transfer", "ft.large_transfer", "nft.transfer",
		"contract.event", "address.activity", "staking.event",
		"evm.transaction", "account.key_change", "defi.swap", "defi.liquidity",
	}
	for _, et := range types {
		data := BuildMockEventData(et, nil)
		if data["tx_id"] != mockTxID {
			t.Errorf("[%s] expected tx_id to be set, got %v", et, data["tx_id"])
		}
	}
}

func TestRunWorkflowTest_MatcherPass(t *testing.T) {
	reg := newTestRegistry()

	// ft.transfer with min_amount=100, amount=500 => pass
	cond := json.RawMessage(`{"min_amount": 100}`)
	overrides := map[string]interface{}{"amount": "500.0"}

	result := RunPathTest(reg, "ft.transfer", cond, overrides)
	if result.TriggerStatus != "pass" {
		t.Fatalf("expected trigger pass, got %s (error: %s)", result.TriggerStatus, result.TriggerError)
	}
	if result.EventData == nil {
		t.Fatal("expected event data to be populated")
	}
	if result.EventData["amount"] != "500.0" {
		t.Errorf("expected amount 500.0 in event data, got %v", result.EventData["amount"])
	}
}

func TestRunWorkflowTest_MatcherFail(t *testing.T) {
	reg := newTestRegistry()

	// ft.transfer with min_amount=1000, amount=50 => fail (trigger)
	cond := json.RawMessage(`{"min_amount": 1000}`)
	overrides := map[string]interface{}{"amount": "50.0"}

	result := RunPathTest(reg, "ft.transfer", cond, overrides)
	if result.TriggerStatus != "fail" {
		t.Fatalf("expected trigger fail, got %s", result.TriggerStatus)
	}
}

func TestRunWorkflowTest_ConditionPass(t *testing.T) {
	reg := newTestRegistry()

	// ft.transfer: trigger passes (no min_amount), generic condition amount_> 100
	cond := json.RawMessage(`{"amount_>": "100"}`)
	overrides := map[string]interface{}{"amount": "500.0"}

	result := RunPathTest(reg, "ft.transfer", cond, overrides)
	if result.TriggerStatus != "pass" {
		t.Fatalf("expected pass, got %s (error: %s)", result.TriggerStatus, result.TriggerError)
	}
	if len(result.Conditions) != 1 {
		t.Fatalf("expected 1 condition result, got %d", len(result.Conditions))
	}
	cr := result.Conditions[0]
	if cr.Field != "amount" {
		t.Errorf("expected field 'amount', got %q", cr.Field)
	}
	if cr.Operator != ">" {
		t.Errorf("expected operator '>', got %q", cr.Operator)
	}
	if cr.Status != "pass" {
		t.Errorf("expected condition pass, got %s", cr.Status)
	}
}

func TestRunWorkflowTest_ConditionFail(t *testing.T) {
	reg := newTestRegistry()

	// ft.transfer: trigger passes, generic condition amount_> 1000 with amount=500
	cond := json.RawMessage(`{"amount_>": "1000"}`)
	overrides := map[string]interface{}{"amount": "500.0"}

	result := RunPathTest(reg, "ft.transfer", cond, overrides)
	// The trigger itself passes (no min_amount filter), but the condition fails
	if result.TriggerStatus != "fail" {
		t.Fatalf("expected fail (condition), got %s", result.TriggerStatus)
	}
	if len(result.Conditions) != 1 {
		t.Fatalf("expected 1 condition result, got %d", len(result.Conditions))
	}
	cr := result.Conditions[0]
	if cr.Status != "fail" {
		t.Errorf("expected condition fail, got %s", cr.Status)
	}
	if cr.Actual != "500.0" {
		t.Errorf("expected actual '500.0', got %q", cr.Actual)
	}
	if cr.Expected != "1000" {
		t.Errorf("expected expected '1000', got %q", cr.Expected)
	}
}

func TestRunWorkflowTest_UnknownEventType(t *testing.T) {
	reg := newTestRegistry()

	result := RunPathTest(reg, "unknown.type", nil, nil)
	if result.TriggerStatus != "fail" {
		t.Fatalf("expected fail for unknown event type, got %s", result.TriggerStatus)
	}
	if result.TriggerError == "" {
		t.Fatal("expected trigger error message")
	}
}

func TestRunWorkflowTest_NFTTransfer(t *testing.T) {
	reg := newTestRegistry()

	cond := json.RawMessage(`{}`)
	result := RunPathTest(reg, "nft.transfer", cond, nil)
	if result.TriggerStatus != "pass" {
		t.Fatalf("expected pass for nft.transfer, got %s (error: %s)", result.TriggerStatus, result.TriggerError)
	}
	if result.EventData["nft_id"] != "1" {
		t.Errorf("expected nft_id '1', got %v", result.EventData["nft_id"])
	}
}

func TestRunWorkflowTest_EVMTransaction(t *testing.T) {
	reg := newTestRegistry()

	cond := json.RawMessage(`{}`)
	result := RunPathTest(reg, "evm.transaction", cond, nil)
	if result.TriggerStatus != "pass" {
		t.Fatalf("expected pass for evm.transaction, got %s (error: %s)", result.TriggerStatus, result.TriggerError)
	}
}

func TestRunWorkflowTest_DefiSwap(t *testing.T) {
	reg := newTestRegistry()

	cond := json.RawMessage(`{}`)
	result := RunPathTest(reg, "defi.swap", cond, nil)
	if result.TriggerStatus != "pass" {
		t.Fatalf("expected pass for defi.swap, got %s (error: %s)", result.TriggerStatus, result.TriggerError)
	}
}
