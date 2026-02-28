package matcher

import (
	"testing"
)

func TestEvaluateConditions_NumericLessThan(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_<": "100000000",
	}
	eventData := map[string]interface{}{
		"amount": "50000000",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected 50M < 100M to pass")
	}
}

func TestEvaluateConditions_NumericLessThan_Fail(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_<": "100000000",
	}
	eventData := map[string]interface{}{
		"amount": "200000000",
	}
	if EvaluateConditions(conditions, eventData) {
		t.Error("expected 200M < 100M to fail")
	}
}

func TestEvaluateConditions_StringEquals(t *testing.T) {
	conditions := map[string]interface{}{
		"from_address_==": "0xabcdef1234567890",
	}
	eventData := map[string]interface{}{
		"from_address": "0xABCDEF1234567890",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected case-insensitive address match to pass")
	}
}

func TestEvaluateConditions_StringNotEquals(t *testing.T) {
	conditions := map[string]interface{}{
		"from_address_!=": "0xabcdef1234567890",
	}
	eventData := map[string]interface{}{
		"from_address": "0xabcdef1234567890",
	}
	if EvaluateConditions(conditions, eventData) {
		t.Error("expected same address with != to fail")
	}
}

func TestEvaluateConditions_Contains(t *testing.T) {
	conditions := map[string]interface{}{
		"event_type_contains": "FlowToken",
	}
	eventData := map[string]interface{}{
		"event_type": "A.1654653399040a61.FlowToken.TokensDeposited",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected FlowToken contains check to pass")
	}
}

func TestEvaluateConditions_GreaterThan(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_>": "100",
	}
	eventData := map[string]interface{}{
		"amount": "500.5",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected 500.5 > 100 to pass")
	}
}

func TestEvaluateConditions_MultipleConditions(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_>":          "100",
		"from_address_==":   "0xabc",
	}
	eventData := map[string]interface{}{
		"amount":       "500",
		"from_address": "0xABC",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected both conditions to pass")
	}
}

func TestEvaluateConditions_MultipleConditions_OneFails(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_>":          "100",
		"from_address_==":   "0xabc",
	}
	eventData := map[string]interface{}{
		"amount":       "50",
		"from_address": "0xABC",
	}
	if EvaluateConditions(conditions, eventData) {
		t.Error("expected one failing condition to make overall result false")
	}
}

func TestEvaluateConditions_EmptyConditions(t *testing.T) {
	eventData := map[string]interface{}{
		"amount": "100",
	}
	if !EvaluateConditions(nil, eventData) {
		t.Error("expected nil conditions to return true")
	}
	if !EvaluateConditions(map[string]interface{}{}, eventData) {
		t.Error("expected empty conditions to return true")
	}
}

func TestEvaluateConditions_MissingField(t *testing.T) {
	conditions := map[string]interface{}{
		"balance_>": "100",
	}
	eventData := map[string]interface{}{
		"amount": "500",
	}
	if EvaluateConditions(conditions, eventData) {
		t.Error("expected missing field to fail")
	}
}

func TestEvaluateConditions_SkipsNonConditionKeys(t *testing.T) {
	conditions := map[string]interface{}{
		"addresses":      []string{"0xabc"},
		"min_amount":     "100",
		"direction":      "sent",
		"token_contract": "A.1654653399040a61.FlowToken",
		"amount_>":       "50",
	}
	eventData := map[string]interface{}{
		"amount": "100",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected trigger keys to be skipped and amount_> to pass")
	}
}

func TestParseConditionKey(t *testing.T) {
	tests := []struct {
		key      string
		wantF    string
		wantOp   string
	}{
		{"amount_>", "amount", ">"},
		{"amount_<", "amount", "<"},
		{"amount_>=", "amount", ">="},
		{"amount_<=", "amount", "<="},
		{"from_address_==", "from_address", "=="},
		{"from_address_!=", "from_address", "!="},
		{"event_type_contains", "event_type", "contains"},
		{"event_type_not_contains", "event_type", "not_contains"},
		{"event_type_starts_with", "event_type", "starts_with"},
		{"amount_eq", "amount", "eq"},
		{"amount_neq", "amount", "neq"},
		{"amount_gt", "amount", "gt"},
		{"amount_lt", "amount", "lt"},
		{"amount_gte", "amount", "gte"},
		{"amount_lte", "amount", "lte"},
		{"no_operator", "", ""},
	}
	for _, tt := range tests {
		f, op := ParseConditionKey(tt.key)
		if f != tt.wantF || op != tt.wantOp {
			t.Errorf("ParseConditionKey(%q) = (%q, %q), want (%q, %q)", tt.key, f, op, tt.wantF, tt.wantOp)
		}
	}
}

func TestEvaluateOp_StartsWithCaseInsensitive(t *testing.T) {
	if !EvaluateOp("starts_with", "A.1654653399040a61.FlowToken.TokensDeposited", "a.1654") {
		t.Error("expected case-insensitive starts_with to pass")
	}
}

func TestEvaluateOp_NotContains(t *testing.T) {
	if !EvaluateOp("not_contains", "FlowToken.Deposited", "FUSD") {
		t.Error("expected not_contains to pass when substring absent")
	}
	if EvaluateOp("not_contains", "FlowToken.Deposited", "flow") {
		t.Error("expected not_contains to fail when substring present (case-insensitive)")
	}
}

func TestEvaluateOp_NumericParseFailure(t *testing.T) {
	if EvaluateOp(">", "notanumber", "100") {
		t.Error("expected numeric parse failure to return false")
	}
	if EvaluateOp("<", "50", "notanumber") {
		t.Error("expected numeric parse failure to return false")
	}
}

func TestEvaluateConditions_NonStringExpectedValue(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_>": 100,
	}
	eventData := map[string]interface{}{
		"amount": "500",
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected non-string expected value to be converted via fmt.Sprintf")
	}
}

func TestEvaluateConditions_NonStringActualValue(t *testing.T) {
	conditions := map[string]interface{}{
		"amount_>": "100",
	}
	eventData := map[string]interface{}{
		"amount": 500.5,
	}
	if !EvaluateConditions(conditions, eventData) {
		t.Error("expected non-string actual value to be converted via fmt.Sprintf")
	}
}
