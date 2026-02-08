package ingester

import "testing"

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
