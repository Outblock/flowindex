package repository

import "testing"

func TestExtractContractFromName(t *testing.T) {
	tests := []struct {
		name     string
		expected string
	}{
		{"EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750", "99af3eea856556646c98c8b9b2548fe815240750"},
		{"EVMVMBridgedNFT_abc123", "0000000000000000000000000000000000abc123"},
		{"FlowToken", ""},
		{"EVMVMBridgedToken_", ""},
	}
	for _, tc := range tests {
		got := extractContractFromName(tc.name)
		if got != tc.expected {
			t.Errorf("extractContractFromName(%q) = %q, want %q", tc.name, got, tc.expected)
		}
	}
}

func TestDecodeCallDataForBackfill(t *testing.T) {
	// Real ERC-20 transfer call data
	data := "a9059cbb00000000000000000000000032ead959e1c100d20a36bf4356c9a31a0f7a2f3700000000000000000000000000000000000000000000000000000007ac8b6e70"
	decoded := decodeCallDataForBackfill(data)
	if decoded.callType != "erc20_transfer" {
		t.Errorf("expected erc20_transfer, got %s", decoded.callType)
	}
	if decoded.recipient != "32ead959e1c100d20a36bf4356c9a31a0f7a2f37" {
		t.Errorf("expected 32ead959..., got %s", decoded.recipient)
	}
}
