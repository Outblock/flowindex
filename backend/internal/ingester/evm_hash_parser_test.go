package ingester

import (
	"encoding/hex"
	"testing"
)

func TestIsEVMTransactionExecutedEvent(t *testing.T) {
	cases := []struct {
		typ  string
		want bool
	}{
		{"A.e467b9dd11fa00df.EVM.TransactionExecuted", true}, // mainnet
		{"A.8c5303eaa26202d6.EVM.TransactionExecuted", true}, // testnet
		{"A.e467b9dd11fa00df.EVM.BlockExecuted", false},
		{"A.f919ee77447b7497.FlowFees.FeesDeducted", false},
	}
	for _, tc := range cases {
		if got := isEVMTransactionExecutedEvent(tc.typ); got != tc.want {
			t.Fatalf("isEVMTransactionExecutedEvent(%q)=%v want %v", tc.typ, got, tc.want)
		}
	}
}

func TestExtractEVMHashFromPayload_String(t *testing.T) {
	payload := map[string]interface{}{
		"hash": "0xDeAdbeEf",
	}
	got := extractEVMHashFromPayload(payload)
	want := "deadbeef"
	if got != want {
		t.Fatalf("extractEVMHashFromPayload string=%q want %q", got, want)
	}
}

func TestExtractEVMHashFromPayload_BytesArray(t *testing.T) {
	// json.Unmarshal produces []interface{} with float64 values.
	payload := map[string]interface{}{
		"transactionHash": []interface{}{float64(0x8f), float64(0x68), float64(0x69)},
	}
	got := extractEVMHashFromPayload(payload)
	want := "8f6869"
	if got != want {
		t.Fatalf("extractEVMHashFromPayload bytes=%q want %q", got, want)
	}
}

func TestDecodeFlowDirectCall(t *testing.T) {
	// Real payload from tx 0x17b6bfde16f2524a90cc3e2c30f4f6f864c31f8eca297a6c72f31f5d11c37c4d
	// This is a Flow EVM direct call (0xff prefix) sending FLOW from COA to an EVM address.
	raw, _ := hex.DecodeString("fff83f81ff05940000000000000000000000023f199186b7535df194ae0a739c3724bb5cd2bdcf73764c87a5a6ec21a3808aa968163f0a57b4000000840100000008")
	decoded, ok := decodeEVMTransactionPayload(raw)
	if !ok {
		t.Fatal("decodeEVMTransactionPayload returned false for Flow direct call payload")
	}
	wantFrom := "0000000000000000000000023f199186b7535df1"
	wantTo := "ae0a739c3724bb5cd2bdcf73764c87a5a6ec21a3"
	if decoded.From != wantFrom {
		t.Errorf("From = %q, want %q", decoded.From, wantFrom)
	}
	if decoded.To != wantTo {
		t.Errorf("To = %q, want %q", decoded.To, wantTo)
	}
	if decoded.Value == "" || decoded.Value == "0" {
		t.Errorf("Value should be non-zero, got %q", decoded.Value)
	}
	t.Logf("Decoded direct call: from=%s to=%s value=%s gasLimit=%d nonce=%d",
		decoded.From, decoded.To, decoded.Value, decoded.GasLimit, decoded.Nonce)
}

func TestDecodeFlowDirectCall_FirstExec(t *testing.T) {
	// First EVM execution from the same transaction — internal COA-to-COA call
	raw, _ := hex.DecodeString("fff84081ff01940000000000000000000000010000000000000000940000000000000000000000023f199186b7535df1808aa968163f0a57b4000000825b048302181a")
	decoded, ok := decodeEVMTransactionPayload(raw)
	if !ok {
		t.Fatal("decodeEVMTransactionPayload returned false for Flow direct call payload")
	}
	if decoded.From == "" {
		t.Error("From should not be empty")
	}
	if decoded.To == "" {
		t.Error("To should not be empty")
	}
	t.Logf("Decoded direct call #1: from=%s to=%s value=%s", decoded.From, decoded.To, decoded.Value)
}
