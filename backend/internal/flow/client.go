package flow

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/onflow/cadence"
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
	nodes       []string
	// Per-node spork root (inclusive). Height < minHeight cannot be served by that node.
	// Learned dynamically from NotFound errors.
	minHeights []uint64
	// Per-node temporary disable flag (unix nanos). Used to avoid repeatedly
	// selecting nodes that are currently unreachable (e.g. DNS resolver produced zero addresses).
	disabledUntil []int64
	// Parsed from hostname. Higher means "newer spork" (e.g. mainnet28 > mainnet27).
	// Used to prefer newer spork nodes for a given height in mixed historic pools.
	sporkRanks []int
	limiter    *rate.Limiter
	rr         uint32
}

// NewClient creates a new Flow gRPC client
func NewClient(url string) (*Client, error) {
	return NewClientFromEnv("FLOW_ACCESS_NODES", url)
}

// NewClientFromEnv creates a new Flow gRPC client from an env var (comma/space separated list),
// falling back to `fallback` when the env var is empty.
//
// This is useful for separating "live" nodes from "historic" nodes for backfills across sporks.
func NewClientFromEnv(envKey string, fallback string) (*Client, error) {
	nodes := parseAccessNodesFromEnv(envKey, fallback)
	clients := make([]*grpc.Client, 0, len(nodes))
	connectedNodes := make([]string, 0, len(nodes))
	ranks := make([]int, 0, len(nodes))
	var firstErr error
	for _, node := range nodes {
		c, err := grpc.NewClient(node)
		if err != nil {
			// Be tolerant here: when we configure a long list of historic spork nodes,
			// some hostnames might not resolve (or might be temporarily unavailable).
			// We'll skip and continue as long as we have at least one working node.
			if firstErr == nil {
				firstErr = fmt.Errorf("failed to connect to flow access node %s: %w", node, err)
			}
			log.Printf("[flow] Warn: failed to connect to access node %s: %v", node, err)
			continue
		}
		clients = append(clients, c)
		connectedNodes = append(connectedNodes, node)
		ranks = append(ranks, extractSporkRank(node))
	}

	if len(clients) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, fmt.Errorf("failed to connect to flow access nodes: no nodes provided")
	}

	return &Client{
		grpcClients:   clients,
		nodes:         connectedNodes,
		minHeights:    make([]uint64, len(clients)),
		disabledUntil: make([]int64, len(clients)),
		sporkRanks:    ranks,
		limiter:       newLimiterFromEnv(len(clients)),
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
	pin, err := c.PinByHeight(height)
	if err != nil {
		return nil, nil, err
	}
	return pin.GetBlockByHeight(ctx, height)
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

func (c *Client) ExecuteScriptAtLatestBlock(ctx context.Context, script []byte, args []cadence.Value) (cadence.Value, error) {
	var out cadence.Value
	err := c.withRetry(ctx, func() error {
		v, err := c.pickClient().ExecuteScriptAtLatestBlock(ctx, script, args)
		if err != nil {
			return err
		}
		out = v
		return nil
	})
	return out, err
}

func (c *Client) ExecuteScriptAtBlockHeight(ctx context.Context, height uint64, script []byte, args []cadence.Value) (cadence.Value, error) {
	var out cadence.Value
	err := c.withRetry(ctx, func() error {
		v, err := c.pickClient().ExecuteScriptAtBlockHeight(ctx, height, script, args)
		if err != nil {
			return err
		}
		out = v
		return nil
	})
	return out, err
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
	return parseAccessNodesFromEnv("FLOW_ACCESS_NODES", fallback)
}

func parseAccessNodesFromEnv(envKey string, fallback string) []string {
	raw := os.Getenv(envKey)
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
	_, cli := c.pickAnyClient()
	return cli
}

func (c *Client) pickAnyClient() (int, *grpc.Client) {
	if len(c.grpcClients) == 0 {
		return -1, nil
	}
	if len(c.grpcClients) == 1 {
		return 0, c.grpcClients[0]
	}

	start := int(atomic.AddUint32(&c.rr, 1) % uint32(len(c.grpcClients)))
	now := time.Now().UnixNano()

	for i := 0; i < len(c.grpcClients); i++ {
		idx := (start + i) % len(c.grpcClients)
		disabledUntil := atomic.LoadInt64(&c.disabledUntil[idx])
		if disabledUntil > now {
			continue
		}
		return idx, c.grpcClients[idx]
	}

	// If everything is disabled, just return the start index and let retries handle it.
	return start, c.grpcClients[start]
}

func (c *Client) pickClientForHeight(height uint64) (int, *grpc.Client) {
	if len(c.grpcClients) == 0 {
		return -1, nil
	}
	if len(c.grpcClients) == 1 {
		return 0, c.grpcClients[0]
	}

	start := int(atomic.AddUint32(&c.rr, 1) % uint32(len(c.grpcClients)))
	now := time.Now().UnixNano()

	// Prefer the newest spork node that can serve this height. This avoids randomly
	// selecting an older spork node that doesn't have newer heights.
	bestRank := -1
	for i := 0; i < len(c.grpcClients); i++ {
		idx := (start + i) % len(c.grpcClients)

		disabledUntil := atomic.LoadInt64(&c.disabledUntil[idx])
		if disabledUntil > now {
			continue
		}

		minH := atomic.LoadUint64(&c.minHeights[idx])
		if minH != 0 && height < minH {
			continue
		}

		if idx < len(c.sporkRanks) && c.sporkRanks[idx] > bestRank {
			bestRank = c.sporkRanks[idx]
		}
	}

	if bestRank >= 0 {
		for i := 0; i < len(c.grpcClients); i++ {
			idx := (start + i) % len(c.grpcClients)

			disabledUntil := atomic.LoadInt64(&c.disabledUntil[idx])
			if disabledUntil > now {
				continue
			}

			minH := atomic.LoadUint64(&c.minHeights[idx])
			if minH != 0 && height < minH {
				continue
			}

			if idx < len(c.sporkRanks) && c.sporkRanks[idx] == bestRank {
				return idx, c.grpcClients[idx]
			}
		}
	}

	// If nothing qualifies by minHeight, fall back to any available client.
	return c.pickAnyClient()
}

func (c *Client) markMinHeight(idx int, minHeight uint64) {
	if idx < 0 || idx >= len(c.minHeights) {
		return
	}

	for {
		old := atomic.LoadUint64(&c.minHeights[idx])
		if old >= minHeight {
			return
		}
		if atomic.CompareAndSwapUint64(&c.minHeights[idx], old, minHeight) {
			return
		}
	}
}

func (c *Client) disableNodeFor(idx int, d time.Duration) {
	if idx < 0 || idx >= len(c.disabledUntil) {
		return
	}
	atomic.StoreInt64(&c.disabledUntil[idx], time.Now().Add(d).UnixNano())
}

type SporkRootNotFoundError struct {
	Node       string
	RootHeight uint64
	Err        error
}

func (e *SporkRootNotFoundError) Error() string { return e.Err.Error() }
func (e *SporkRootNotFoundError) Unwrap() error { return e.Err }

type NodeUnavailableError struct {
	Node string
	Err  error
}

func (e *NodeUnavailableError) Error() string { return e.Err.Error() }
func (e *NodeUnavailableError) Unwrap() error { return e.Err }

type PinnedClient struct {
	parent *Client
	idx    int
	node   string
	cli    *grpc.Client
}

func (c *Client) PinByHeight(height uint64) (*PinnedClient, error) {
	idx, cli := c.pickClientForHeight(height)
	if cli == nil {
		return nil, fmt.Errorf("no available flow access clients")
	}
	node := ""
	if idx >= 0 && idx < len(c.nodes) {
		node = c.nodes[idx]
	}
	return &PinnedClient{
		parent: c,
		idx:    idx,
		node:   node,
		cli:    cli,
	}, nil
}

func (p *PinnedClient) Node() string {
	if p == nil {
		return ""
	}
	return p.node
}

func (p *PinnedClient) withRetry(ctx context.Context, fn func() error) error {
	return p.parent.withRetryPinned(ctx, p.idx, p.node, fn)
}

func (p *PinnedClient) GetBlockByHeight(ctx context.Context, height uint64) (*flow.Block, []*flow.Collection, error) {
	var block *flow.Block
	if err := p.withRetry(ctx, func() error {
		var err error
		block, err = p.cli.GetBlockByHeight(ctx, height)
		return err
	}); err != nil {
		return nil, nil, fmt.Errorf("failed to get block by height %d: %w", height, err)
	}

	collections := make([]*flow.Collection, 0, len(block.CollectionGuarantees))
	for _, guarantee := range block.CollectionGuarantees {
		var coll *flow.Collection
		if err := p.withRetry(ctx, func() error {
			var err error
			coll, err = p.cli.GetCollection(ctx, guarantee.CollectionID)
			return err
		}); err != nil {
			return nil, nil, fmt.Errorf("failed to get collection %s: %w", guarantee.CollectionID, err)
		}
		collections = append(collections, coll)
	}

	return block, collections, nil
}

func (p *PinnedClient) GetTransaction(ctx context.Context, txID flow.Identifier) (*flow.Transaction, error) {
	var tx *flow.Transaction
	if err := p.withRetry(ctx, func() error {
		var err error
		tx, err = p.cli.GetTransaction(ctx, txID)
		return err
	}); err != nil {
		return nil, err
	}
	return tx, nil
}

func (p *PinnedClient) GetTransactionResult(ctx context.Context, txID flow.Identifier) (*flow.TransactionResult, error) {
	var res *flow.TransactionResult
	if err := p.withRetry(ctx, func() error {
		var err error
		res, err = p.cli.GetTransactionResult(ctx, txID)
		return err
	}); err != nil {
		return nil, err
	}
	return res, nil
}

func (c *Client) withRetryPinned(ctx context.Context, idx int, node string, fn func() error) error {
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

		// If the node cannot resolve to any address, mark it disabled and let the caller repin.
		if isZeroAddressesResolverError(err) {
			c.disableNodeFor(idx, 5*time.Minute)
			return &NodeUnavailableError{Node: node, Err: err}
		}

		// Spork boundary: mark the node's min height and let the caller repin.
		if root, ok := extractSporkRootHeight(err); ok {
			c.markMinHeight(idx, root)
			return &SporkRootNotFoundError{Node: node, RootHeight: root, Err: err}
		}

		st, ok := status.FromError(err)
		if !ok {
			return err // Not a gRPC error, don't retry
		}

		switch st.Code() {
		case codes.ResourceExhausted, codes.Unavailable, codes.DeadlineExceeded:
			if i == maxRetries-1 {
				return fmt.Errorf("max retries reached: %w", err)
			}
			wait := backoff * time.Duration(1<<i)
			select {
			case <-time.After(wait):
				continue
			case <-ctx.Done():
				return ctx.Err()
			}
		default:
			return err
		}
	}
	return nil
}

func isZeroAddressesResolverError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "name resolver error: produced zero addresses") ||
		strings.Contains(msg, "produced zero addresses")
}

func extractSporkRootHeight(err error) (uint64, bool) {
	if err == nil {
		return 0, false
	}
	const needle = "spork root block height "
	msg := err.Error()
	idx := strings.Index(msg, needle)
	if idx == -1 {
		return 0, false
	}
	rest := msg[idx+len(needle):]
	n := 0
	for n < len(rest) {
		ch := rest[n]
		if ch < '0' || ch > '9' {
			break
		}
		n++
	}
	if n == 0 {
		return 0, false
	}
	v, parseErr := strconv.ParseUint(rest[:n], 10, 64)
	if parseErr != nil || v == 0 {
		return 0, false
	}
	return v, true
}

func extractSporkRank(node string) int {
	// We expect hostnames like: access-001.mainnet28.nodes.onflow.org:9000
	const needle = "mainnet"
	idx := strings.Index(node, needle)
	if idx == -1 {
		return 0
	}
	rest := node[idx+len(needle):]
	n := 0
	for n < len(rest) {
		ch := rest[n]
		if ch < '0' || ch > '9' {
			break
		}
		n++
	}
	if n == 0 {
		return 0
	}
	v, err := strconv.Atoi(rest[:n])
	if err != nil || v < 0 {
		return 0
	}
	return v
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
