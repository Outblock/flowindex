package ingester

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
	"github.com/onflow/flow-go-sdk/access/grpc"
)

func testFTCombinedScript(t *testing.T, addrHex, name string) map[string]string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := grpc.NewClient("access-001.mainnet28.nodes.onflow.org:9000")
	if err != nil {
		t.Fatalf("failed to create flow client: %v", err)
	}

	contractAddr := flowsdk.HexToAddress(addrHex)
	contractName, _ := cadence.NewString(name)

	val, err := client.ExecuteScriptAtLatestBlock(ctx, []byte(cadenceFTCombinedScript()), []cadence.Value{
		cadence.NewAddress([8]byte(contractAddr)),
		contractName,
	})
	if err != nil {
		t.Fatalf("script execution failed: %v", err)
	}

	opt, ok := val.(cadence.Optional)
	if !ok {
		t.Fatalf("expected Optional, got %T", val)
	}
	if opt.Value == nil {
		t.Skipf("%s returned nil — contract may not implement FTDisplay", name)
	}

	st, ok := opt.Value.(cadence.Struct)
	if !ok {
		t.Fatalf("expected Struct, got %T", opt.Value)
	}

	fields := st.FieldsMappedByName()
	result := map[string]string{
		"name":        cadenceToString(fields["name"]),
		"symbol":      cadenceToString(fields["symbol"]),
		"totalSupply": cadenceUFix64ToString(fields["totalSupply"]),
		"evmAddress":  cadenceToString(fields["evmAddress"]),
	}

	for k, v := range result {
		fmt.Printf("  %s: %s\n", k, v)
	}
	return result
}

// TestFTCombinedScript_FlowToken tests FlowToken metadata + totalSupply on mainnet.
func TestFTCombinedScript_FlowToken(t *testing.T) {
	fmt.Println("=== FlowToken ===")
	r := testFTCombinedScript(t, "1654653399040a61", "FlowToken")

	if r["name"] == "" {
		t.Error("name is empty")
	}
	if r["totalSupply"] == "" || r["totalSupply"] == "0.00000000" {
		t.Errorf("totalSupply is empty or zero: %q", r["totalSupply"])
	}
}

// TestFTCombinedScript_USDC tests USDC (FiatToken) metadata + totalSupply on mainnet.
func TestFTCombinedScript_USDC(t *testing.T) {
	fmt.Println("=== USDC (FiatToken) ===")
	testFTCombinedScript(t, "a983fecbed621163", "FiatToken")
}

// TestFTCombinedScript_stFlowToken tests stFlowToken (Increment.fi) on mainnet.
func TestFTCombinedScript_stFlowToken(t *testing.T) {
	fmt.Println("=== stFlowToken ===")
	testFTCombinedScript(t, "d6f80565193ad727", "stFlowToken")
}
