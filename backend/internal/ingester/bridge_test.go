//go:build integration

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

// TestBridgeEVMAddress connects to Flow mainnet and checks whether our Cadence script
// can detect EVM bridge addresses for well-known NFT collections.
func TestBridgeEVMAddress(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	client, err := grpc.NewClient("access-001.mainnet28.nodes.onflow.org:9000")
	if err != nil {
		t.Fatalf("failed to connect to Flow mainnet: %v", err)
	}

	script := cadenceNFTCollectionDisplayScript()

	// Well-known NFT collections on Flow mainnet
	collections := []struct {
		address string
		name    string
	}{
		{"0b2a3299cc857e29", "TopShot"},              // NBA TopShot
		{"1d7e57aa55817448", "NFTStorefrontV2"},       // Storefront
		{"86b4a0010a71cfc3", "Momentables"},           // Momentables
		{"2d2750f240198f91", "MatrixWorldFlowFestNFT"},// MatrixWorld
		{"329feb3ab062d289", "CNN_NFT"},               // CNN NFTs
		{"e4cf4bdc1751c65d", "PackNFT"},               // PackNFT (Dapper)
		{"921ea449dffec68a", "Flovatar"},              // Flovatar
		{"f8d6e0586b0a20c7", "FlowToken"},             // not NFT, just to see error
		{"49a7cda3a1eecc29", "NFTCatalog"},            // NFT Catalog
		{"e467b9dd11fa00df", "FlowFees"},              // not NFT
		{"7e60df042a9c0868", "FlowToken"},             // FlowToken on alt addr
		{"2d4c3caffbeab845", "FLOAT"},                 // FLOAT
		{"097bafa4e0b48eef", "TopShotShardedCollection"}, // TopShot alt
	}

	bridgedCount := 0
	for _, c := range collections {
		addr := flowsdk.HexToAddress(c.address)
		nameVal, _ := cadence.NewString(c.name)

		result, err := client.ExecuteScriptAtLatestBlock(ctx, []byte(script), []cadence.Value{
			cadence.NewAddress([8]byte(addr)),
			nameVal,
		})

		if err != nil {
			t.Logf("SCRIPT ERROR  %-40s @ 0x%s: %v", c.name, c.address, err)
			continue
		}

		v := unwrapOptional(result)
		if v == nil {
			t.Logf("NULL RESULT   %-40s @ 0x%s", c.name, c.address)
			continue
		}

		s, ok := v.(cadence.Struct)
		if !ok {
			t.Logf("NOT STRUCT    %-40s @ 0x%s: %T", c.name, c.address, v)
			continue
		}

		fields := s.FieldsMappedByName()
		evmAddr := cadenceToString(fields["evmAddress"])
		displayVal := unwrapOptional(fields["display"])
		hasDisplay := displayVal != nil

		if evmAddr != "" {
			bridgedCount++
			t.Logf("BRIDGED       %-40s @ 0x%s -> EVM: %s (display=%v)", c.name, c.address, evmAddr, hasDisplay)
		} else {
			t.Logf("NOT BRIDGED   %-40s @ 0x%s (display=%v)", c.name, c.address, hasDisplay)
		}
	}

	fmt.Printf("\n=== Summary: %d / %d collections have EVM bridge addresses ===\n", bridgedCount, len(collections))
}

// TestBridgeEVMAddressDirectScript tests the cadenceBridgeOnlyScript() function
// that is used by the worker's bridge backfill.
func TestBridgeEVMAddressDirectScript(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client, err := grpc.NewClient("access-001.mainnet28.nodes.onflow.org:9000")
	if err != nil {
		t.Fatalf("failed to connect to Flow mainnet: %v", err)
	}

	script := cadenceBridgeOnlyScript()

	// Test with known type identifiers
	identifiers := []string{
		"A.0b2a3299cc857e29.TopShot.NFT",
		"A.921ea449dffec68a.Flovatar.NFT",
		"A.2d4c3caffbeab845.FLOAT.NFT",
		"A.329feb3ab062d289.CNN_NFT.NFT",
		"A.86b4a0010a71cfc3.Momentables.NFT",
		"A.e4cf4bdc1751c65d.PackNFT.NFT",
	}

	for _, id := range identifiers {
		idVal, _ := cadence.NewString(id)
		result, err := client.ExecuteScriptAtLatestBlock(ctx, []byte(script), []cadence.Value{idVal})
		if err != nil {
			t.Logf("ERROR   %s: %v", id, err)
			continue
		}

		v := unwrapOptional(result)
		if v == nil {
			t.Logf("NO EVM  %s", id)
		} else {
			t.Logf("EVM     %s -> %s", id, v)
		}
	}
}
