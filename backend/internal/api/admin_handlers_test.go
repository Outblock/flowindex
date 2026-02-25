package api

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
	flowgrpc "github.com/onflow/flow-go-sdk/access/grpc"
)

// realFlowClient wraps a live gRPC client for integration testing.
type realFlowClient struct {
	client *flowgrpc.Client
}

func (c *realFlowClient) GetLatestBlockHeight(ctx context.Context) (uint64, error) {
	block, err := c.client.GetLatestBlock(ctx, true)
	if err != nil {
		return 0, err
	}
	return block.Height, nil
}
func (c *realFlowClient) GetTransaction(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.Transaction, error) {
	return c.client.GetTransaction(ctx, txID)
}
func (c *realFlowClient) GetTransactionResult(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.TransactionResult, error) {
	return c.client.GetTransactionResult(ctx, txID)
}
func (c *realFlowClient) GetAccount(ctx context.Context, address flowsdk.Address) (*flowsdk.Account, error) {
	return c.client.GetAccount(ctx, address)
}
func (c *realFlowClient) ExecuteScriptAtLatestBlock(ctx context.Context, script []byte, args []cadence.Value) (cadence.Value, error) {
	return c.client.ExecuteScriptAtLatestBlock(ctx, script, args)
}

func newTestFlowClient(t *testing.T) FlowClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := flowgrpc.NewClient("access-001.mainnet28.nodes.onflow.org:9000")
	if err != nil {
		t.Skipf("cannot connect to Flow mainnet: %v", err)
	}
	// Quick ping
	_, err = client.GetLatestBlock(ctx, true)
	if err != nil {
		t.Skipf("cannot reach Flow mainnet: %v", err)
	}
	return &realFlowClient{client: client}
}

func TestFetchFTMetadata_RawCombinedScript(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	client := newTestFlowClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	script := adminFTCombinedScript()
	t.Logf("FTCombined script:\n%s", script)

	addr := flowsdk.HexToAddress("1654653399040a61")
	nameVal, _ := cadence.NewString("FlowToken")
	v, err := client.ExecuteScriptAtLatestBlock(ctx, []byte(script), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		t.Fatalf("FTCombined script failed: %v", err)
	}
	t.Logf("FTCombined result type: %T, value: %v", v, v)
}

func TestFetchFTMetadata_FlowToken(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	client := newTestFlowClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// FlowToken: contract_address=1654653399040a61, contract_name=FlowToken
	md, ok := fetchFTMetadataViaClient(ctx, client, "1654653399040a61", "FlowToken")
	if !ok {
		t.Fatal("fetchFTMetadataViaClient returned false for FlowToken")
	}
	fmt.Printf("FlowToken metadata:\n")
	fmt.Printf("  Name:         %s\n", md.Name)
	fmt.Printf("  Symbol:       %s\n", md.Symbol)
	fmt.Printf("  Decimals:     %d\n", md.Decimals)
	fmt.Printf("  Description:  %s\n", md.Description)
	fmt.Printf("  ExternalURL:  %s\n", md.ExternalURL)
	fmt.Printf("  VaultPath:    %s\n", md.VaultPath)
	fmt.Printf("  ReceiverPath: %s\n", md.ReceiverPath)
	fmt.Printf("  BalancePath:  %s\n", md.BalancePath)
	fmt.Printf("  Logo len:     %d\n", len(md.Logo))

	if md.Name == "" {
		t.Error("expected non-empty name")
	}
	if md.Symbol == "" {
		t.Error("expected non-empty symbol")
	}
}

func TestFetchFTMetadata_USDC(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	client := newTestFlowClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// FiatToken (USDC): contract_address=b19436aae4d94622, contract_name=FiatToken
	// NOTE: FiatToken is in a "recovered" state on mainnet — resolveView/resolveContractView
	// both panic. This token cannot provide metadata via standard MetadataViews.
	md, ok := fetchFTMetadataViaClient(ctx, client, "b19436aae4d94622", "FiatToken")
	if !ok {
		t.Skip("FiatToken is in recovered state on mainnet, metadata not available via scripts")
	}
	fmt.Printf("USDC metadata:\n")
	fmt.Printf("  Name:         %s\n", md.Name)
	fmt.Printf("  Symbol:       %s\n", md.Symbol)
	fmt.Printf("  Decimals:     %d\n", md.Decimals)
	fmt.Printf("  Description:  %s\n", md.Description)
	fmt.Printf("  Logo len:     %d\n", len(md.Logo))

	if md.Symbol == "" {
		t.Error("expected non-empty symbol for USDC")
	}
}

func TestFetchFTMetadata_FlovatarDustToken(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	client := newTestFlowClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// FlovatarDustToken: A.921ea449dffec68a.FlovatarDustToken
	md, ok := fetchFTMetadataViaClient(ctx, client, "921ea449dffec68a", "FlovatarDustToken")
	if !ok {
		t.Fatal("fetchFTMetadataViaClient returned false for FlovatarDustToken")
	}
	fmt.Printf("FlovatarDustToken metadata:\n")
	fmt.Printf("  Name:         %s\n", md.Name)
	fmt.Printf("  Symbol:       %s\n", md.Symbol)
	fmt.Printf("  Description:  %s\n", md.Description)
	fmt.Printf("  VaultPath:    %s\n", md.VaultPath)
	fmt.Printf("  ReceiverPath: %s\n", md.ReceiverPath)
	fmt.Printf("  BalancePath:  %s\n", md.BalancePath)
	fmt.Printf("  Logo len:     %d\n", len(md.Logo))

	if md.Name == "" {
		t.Error("expected non-empty name")
	}
}

func TestFetchFTMetadata_USDCFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	client := newTestFlowClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// USDCFlow: A.f1ab99c82dee3526.USDCFlow
	md, ok := fetchFTMetadataViaClient(ctx, client, "f1ab99c82dee3526", "USDCFlow")
	if !ok {
		t.Fatal("fetchFTMetadataViaClient returned false for USDCFlow")
	}
	fmt.Printf("USDCFlow metadata:\n")
	fmt.Printf("  Name:         %s\n", md.Name)
	fmt.Printf("  Symbol:       %s\n", md.Symbol)
	fmt.Printf("  Description:  %s\n", md.Description)
	fmt.Printf("  ExternalURL:  %s\n", md.ExternalURL)
	fmt.Printf("  VaultPath:    %s\n", md.VaultPath)
	fmt.Printf("  ReceiverPath: %s\n", md.ReceiverPath)
	fmt.Printf("  BalancePath:  %s\n", md.BalancePath)
	fmt.Printf("  Logo len:     %d\n", len(md.Logo))

	if md.Name == "" {
		t.Error("expected non-empty name")
	}
	if md.Symbol == "" {
		t.Error("expected non-empty symbol")
	}
}

func TestFetchNFTCollectionMetadata_TopShot(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	client := newTestFlowClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// TopShot: contract_address=0b2a3299cc857e29, contract_name=TopShot
	md, ok := fetchNFTCollectionMetadataViaClient(ctx, client, "0b2a3299cc857e29", "TopShot")
	if !ok {
		t.Fatal("fetchNFTCollectionMetadataViaClient returned false for TopShot")
	}
	fmt.Printf("TopShot collection metadata:\n")
	fmt.Printf("  Name:         %s\n", md.Name)
	fmt.Printf("  Symbol:       %s\n", md.Symbol)
	fmt.Printf("  Description:  %s\n", md.Description)
	fmt.Printf("  ExternalURL:  %s\n", md.ExternalURL)
	fmt.Printf("  SquareImage:  %d bytes\n", len(md.SquareImage))
	fmt.Printf("  BannerImage:  %d bytes\n", len(md.BannerImage))

	if md.Name == "" {
		t.Error("expected non-empty name")
	}
}
