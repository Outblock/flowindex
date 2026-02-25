package api

import (
	"context"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

// FlowClient abstracts the subset of Flow RPC used by the API layer.
// This keeps handlers testable without needing a live gRPC connection.
type FlowClient interface {
	GetLatestBlockHeight(ctx context.Context) (uint64, error)
	GetTransaction(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.Transaction, error)
	GetTransactionResult(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.TransactionResult, error)
	GetAccount(ctx context.Context, address flowsdk.Address) (*flowsdk.Account, error)
	ExecuteScriptAtLatestBlock(ctx context.Context, script []byte, args []cadence.Value) (cadence.Value, error)
}
