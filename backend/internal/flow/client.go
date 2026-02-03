package flow

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/onflow/flow-go-sdk"
	"github.com/onflow/flow-go-sdk/access/grpc"
	"golang.org/x/time/rate"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Client wraps the Flow Access Client
type Client struct {
	// AccessClient access.Client
	// The SDK interface changed in recent versions.
	// Using the gRPC client directly usually returns an implementation of access.Client.
	// For now, let's use the specific client to avoid interface confusion if versions mismatch.
	grpcClients []*grpc.Client
	limiter     *rate.Limiter
	rr          uint32
}

// NewClient creates a new Flow gRPC client
func NewClient(url string) (*Client, error) {
	nodes := parseAccessNodes(url)
	clients := make([]*grpc.Client, 0, len(nodes))
	for _, node := range nodes {
		c, err := grpc.NewClient(node)
		if err != nil {
			for _, existing := range clients {
				_ = existing.Close()
			}
			return nil, fmt.Errorf("failed to connect to flow access node %s: %w", node, err)
		}
		clients = append(clients, c)
	}

	return &Client{
		grpcClients: clients,
		limiter:     newLimiterFromEnv(len(clients)),
	}, nil
}

// GetLatestBlockHeight returns the height of the latest sealed block
func (c *Client) GetLatestBlockHeight(ctx context.Context) (uint64, error) {
	var height uint64
	err := c.withRetry(ctx, func() error {
		header, err := c.pickClient().GetLatestBlockHeader(ctx, true)
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
		block, err = c.pickClient().GetBlockByHeight(ctx, height)
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
			coll, err = c.pickClient().GetCollection(ctx, guarantee.CollectionID)
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
		tx, err = c.pickClient().GetTransaction(ctx, txID)
		return err
	})
	return tx, err
}

// GetTransactionResult fetches the result (status, events)
func (c *Client) GetTransactionResult(ctx context.Context, txID flow.Identifier) (*flow.TransactionResult, error) {
	var res *flow.TransactionResult
	err := c.withRetry(ctx, func() error {
		var err error
		res, err = c.pickClient().GetTransactionResult(ctx, txID)
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
		acc, err = c.pickClient().GetAccount(ctx, address)
		return err
	})
	return acc, err
}

func (c *Client) withRetry(ctx context.Context, fn func() error) error {
	maxRetries := 5
	backoff := 500 * time.Millisecond

	for i := 0; i < maxRetries; i++ {
		if c.limiter != nil {
			if err := c.limiter.Wait(ctx); err != nil {
				return err
			}
		}

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

func newLimiterFromEnv(nodeCount int) *rate.Limiter {
	if nodeCount < 1 {
		nodeCount = 1
	}
	if perNodeStr := os.Getenv("FLOW_RPC_RPS_PER_NODE"); perNodeStr != "" {
		if perNode, err := strconv.ParseFloat(perNodeStr, 64); err == nil {
			total := perNode * float64(nodeCount)
			if total <= 0 {
				return nil
			}
			burst := total
			if burstStr := os.Getenv("FLOW_RPC_BURST_PER_NODE"); burstStr != "" {
				if perBurst, err := strconv.ParseFloat(burstStr, 64); err == nil {
					burst = perBurst * float64(nodeCount)
				}
			}
			if burst < 1 {
				burst = 1
			}
			return rate.NewLimiter(rate.Limit(total), int(burst))
		}
	}

	rps := getEnvFloat("FLOW_RPC_RPS", 5)
	if rps <= 0 {
		return nil
	}
	burst := int(getEnvFloat("FLOW_RPC_BURST", rps))
	if burst < 1 {
		burst = 1
	}
	return rate.NewLimiter(rate.Limit(rps), burst)
}

func getEnvFloat(key string, defaultVal float64) float64 {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			return parsed
		}
	}
	return defaultVal
}

func parseAccessNodes(fallback string) []string {
	raw := os.Getenv("FLOW_ACCESS_NODES")
	if raw == "" {
		raw = fallback
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t'
	})
	nodes := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		nodes = append(nodes, p)
	}
	if len(nodes) == 0 && fallback != "" {
		nodes = append(nodes, fallback)
	}
	return nodes
}

func (c *Client) pickClient() *grpc.Client {
	if len(c.grpcClients) == 1 {
		return c.grpcClients[0]
	}
	idx := atomic.AddUint32(&c.rr, 1)
	return c.grpcClients[int(idx)%len(c.grpcClients)]
}

// Close closes the connection
func (c *Client) Close() error {
	var firstErr error
	for _, client := range c.grpcClients {
		if err := client.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
