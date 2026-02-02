package flow

import (
	"context"
	"fmt"

	"github.com/onflow/flow-go-sdk"
	"github.com/onflow/flow-go-sdk/access/grpc"
)

// Client wraps the Flow Access Client
type Client struct {
	// AccessClient access.Client
	// The SDK interface changed in recent versions.
	// Using the gRPC client directly usually returns an implementation of access.Client.
	// For now, let's use the specific client to avoid interface confusion if versions mismatch.
	grpcClient *grpc.Client
}

// NewClient creates a new Flow gRPC client
func NewClient(url string) (*Client, error) {
	// Using gRPC by default as per plan (access-001.mainnet28.nodes.onflow.org:9000)
	c, err := grpc.NewClient(url)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to flow access node: %w", err)
	}

	return &Client{
		grpcClient: c,
	}, nil
}

// GetLatestBlockHeight returns the height of the latest sealed block
func (c *Client) GetLatestBlockHeight(ctx context.Context) (uint64, error) {
	// We want sealed blocks for finality
	header, err := c.grpcClient.GetLatestBlockHeader(ctx, true)
	if err != nil {
		return 0, fmt.Errorf("failed to get latest block header: %w", err)
	}
	return header.Height, nil
}

// GetBlockByHeight fetches a full block with transactions
func (c *Client) GetBlockByHeight(ctx context.Context, height uint64) (*flow.Block, []*flow.Collection, error) {
	// Fetch Block
	block, err := c.grpcClient.GetBlockByHeight(ctx, height)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get block by height %d: %w", height, err)
	}

	// For a full explorer, we need the collections and transactions.
	// Flow blocks contain Collection Guarantees, not the transactions directly.
	// We must fetch collections to get the Tx IDs.

	collections := make([]*flow.Collection, 0)

	for _, guarantee := range block.CollectionGuarantees {
		coll, err := c.grpcClient.GetCollection(ctx, guarantee.CollectionID)
		if err != nil {
			// If we fail to get a collection, the block is incomplete.
			// In a production indexer, we might retry or log this.
			// For now, return error.
			return nil, nil, fmt.Errorf("failed to get collection %s: %w", guarantee.CollectionID, err)
		}
		collections = append(collections, coll)
	}

	return block, collections, nil
}

// GetTransaction fetches transaction details
func (c *Client) GetTransaction(ctx context.Context, txID flow.Identifier) (*flow.Transaction, error) {
	tx, err := c.grpcClient.GetTransaction(ctx, txID)
	if err != nil {
		return nil, fmt.Errorf("failed to get transaction %s: %w", txID, err)
	}
	return tx, nil
}

// GetTransactionResult fetches the result (status, events)
func (c *Client) GetTransactionResult(ctx context.Context, txID flow.Identifier) (*flow.TransactionResult, error) {
	res, err := c.grpcClient.GetTransactionResult(ctx, txID)
	if err != nil {
		return nil, fmt.Errorf("failed to get transaction result %s: %w", txID, err)
	}
	return res, nil
}

// NetworkName returns the network name
func (c *Client) NetworkName() string {
	return "flow" // In real implementation, derive from URL or config
}

// GetAccount fetches account details (balance, keys, contracts)
func (c *Client) GetAccount(ctx context.Context, address flow.Address) (*flow.Account, error) {
	acc, err := c.grpcClient.GetAccount(ctx, address)
	if err != nil {
		return nil, fmt.Errorf("failed to get account %s: %w", address, err)
	}
	return acc, nil
}

// Close closes the connection
func (c *Client) Close() error {
	return c.grpcClient.Close()
}
