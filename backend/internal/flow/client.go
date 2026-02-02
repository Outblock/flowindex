package flow

import (
	"context"
	"fmt"
	"time"

	"github.com/onflow/flow-go-sdk"
	"github.com/onflow/flow-go-sdk/access/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	var height uint64
	err := c.withRetry(ctx, func() error {
		header, err := c.grpcClient.GetLatestBlockHeader(ctx, true)
		if err != nil {
			return err
		}
		height = header.Height
		return nil
	})
	return height, err
}

// GetBlockByHeight fetches a full block with transactions
func (c *Client) GetBlockByHeight(ctx context.Context, height uint64) (*flow.Block, []*flow.Collection, error) {
	var block *flow.Block
	err := c.withRetry(ctx, func() error {
		var err error
		block, err = c.grpcClient.GetBlockByHeight(ctx, height)
		return err
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get block by height %d: %w", height, err)
	}

	collections := make([]*flow.Collection, 0)
	for _, guarantee := range block.CollectionGuarantees {
		var coll *flow.Collection
		err := c.withRetry(ctx, func() error {
			var err error
			coll, err = c.grpcClient.GetCollection(ctx, guarantee.CollectionID)
			return err
		})
		if err != nil {
			return nil, nil, fmt.Errorf("failed to get collection %s: %w", guarantee.CollectionID, err)
		}
		collections = append(collections, coll)
	}

	return block, collections, nil
}

// GetTransaction fetches transaction details
func (c *Client) GetTransaction(ctx context.Context, txID flow.Identifier) (*flow.Transaction, error) {
	var tx *flow.Transaction
	err := c.withRetry(ctx, func() error {
		var err error
		tx, err = c.grpcClient.GetTransaction(ctx, txID)
		return err
	})
	return tx, err
}

// GetTransactionResult fetches the result (status, events)
func (c *Client) GetTransactionResult(ctx context.Context, txID flow.Identifier) (*flow.TransactionResult, error) {
	var res *flow.TransactionResult
	err := c.withRetry(ctx, func() error {
		var err error
		res, err = c.grpcClient.GetTransactionResult(ctx, txID)
		return err
	})
	return res, err
}

// NetworkName returns the network name
func (c *Client) NetworkName() string {
	return "flow" // In real implementation, derive from URL or config
}

// GetAccount fetches account details (balance, keys, contracts)
func (c *Client) GetAccount(ctx context.Context, address flow.Address) (*flow.Account, error) {
	var acc *flow.Account
	err := c.withRetry(ctx, func() error {
		var err error
		acc, err = c.grpcClient.GetAccount(ctx, address)
		return err
	})
	return acc, err
}

func (c *Client) withRetry(ctx context.Context, fn func() error) error {
	maxRetries := 5
	backoff := 500 * time.Millisecond

	for i := 0; i < maxRetries; i++ {
		err := fn()
		if err == nil {
			return nil
		}

		st, ok := status.FromError(err)
		if !ok {
			return err // Not a gRPC error, don't retry
		}

		switch st.Code() {
		case codes.ResourceExhausted, codes.Unavailable, codes.DeadlineExceeded:
			// Retry after backoff
			if i == maxRetries-1 {
				return fmt.Errorf("max retries reached: %w", err)
			}
			wait := backoff * time.Duration(1<<i) // Exponential backoff
			select {
			case <-time.After(wait):
				continue
			case <-ctx.Done():
				return ctx.Err()
			}
		default:
			return err // Other errors are usually permanent
		}
	}
	return nil
}

// Close closes the connection
func (c *Client) Close() error {
	return c.grpcClient.Close()
}
