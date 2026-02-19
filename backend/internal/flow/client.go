package flow

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/onflow/cadence"
	"github.com/onflow/flow-go-sdk"
	flowgrpcconvert "github.com/onflow/flow-go-sdk/access/grpc/convert"
	"github.com/onflow/flow/protobuf/go/flow/access"
	"github.com/onflow/flow/protobuf/go/flow/entities"
	legacyaccess "github.com/onflow/flow/protobuf/go/flow/legacy/access"
	legacyentities "github.com/onflow/flow/protobuf/go/flow/legacy/entities"
	"golang.org/x/time/rate"
	grpc "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"

	flowgrpc "github.com/onflow/flow-go-sdk/access/grpc"
)

// Client wraps the Flow Access Client
type Client struct {
	grpcClients []*flowgrpc.Client
	rawClients  []access.AccessAPIClient       // Raw modern gRPC clients for JSON-CDC fallback
	legacyRaw   []legacyaccess.AccessAPIClient // Raw legacy gRPC clients (/access.AccessAPI) for old candidate sporks
	rawConns    []*grpc.ClientConn             // Raw gRPC connections (for cleanup)
	nodes       []string
	// Per-node spork root (inclusive). Height < minHeight cannot be served by that node.
	// Learned dynamically from NotFound errors.
	minHeights []uint64
	// Per-node temporary disable flag (unix nanos). Used to avoid repeatedly
	// selecting nodes that are currently unreachable (e.g. DNS resolver produced zero addresses).
	disabledUntil []int64
	// Per-node flag: 1 = bulk APIs (GetTransactionsByBlockID, GetTransactionResultsByBlockID)
	// are not supported. Set on first Unimplemented error to skip wasted round-trips.
	noBulkAPI []uint32
	limiter   *rate.Limiter
	rr        uint32
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
	clients := make([]*flowgrpc.Client, 0, len(nodes))
	rawClients := make([]access.AccessAPIClient, 0, len(nodes))
	legacyRaw := make([]legacyaccess.AccessAPIClient, 0, len(nodes))
	rawConns := make([]*grpc.ClientConn, 0, len(nodes))
	connectedNodes := make([]string, 0, len(nodes))
	var firstErr error
	dialOpts := grpcDialOptionsFromEnv()
	for _, node := range nodes {
		c, err := flowgrpc.NewClient(node, flowgrpc.WithGRPCDialOptions(dialOpts...))
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

		// Create a raw gRPC connection for JSON-CDC fallback (bypasses Cadence decoder)
		rawConn, rawErr := grpc.NewClient(node,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithDefaultCallOptions(
				grpc.MaxCallRecvMsgSize(64*1024*1024),
				grpc.MaxCallSendMsgSize(16*1024*1024),
			),
		)
		if rawErr != nil {
			log.Printf("[flow] Warn: failed to create raw gRPC connection to %s: %v", node, rawErr)
			// Non-fatal: raw fallback just won't work for this node
			rawClients = append(rawClients, nil)
			legacyRaw = append(legacyRaw, nil)
			rawConns = append(rawConns, nil)
		} else {
			rawClients = append(rawClients, access.NewAccessAPIClient(rawConn))
			legacyRaw = append(legacyRaw, legacyaccess.NewAccessAPIClient(rawConn))
			rawConns = append(rawConns, rawConn)
		}

		clients = append(clients, c)
		connectedNodes = append(connectedNodes, node)
	}

	if len(clients) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, fmt.Errorf("failed to connect to flow access nodes: no nodes provided")
	}

	c := &Client{
		grpcClients:   clients,
		rawClients:    rawClients,
		legacyRaw:     legacyRaw,
		rawConns:      rawConns,
		nodes:         connectedNodes,
		minHeights:    make([]uint64, len(clients)),
		disabledUntil: make([]int64, len(clients)),
		noBulkAPI:     make([]uint32, len(clients)),
		limiter:       newLimiterFromEnv(len(clients)),
	}
	c.initSporkMinHeights()
	return c, nil
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

func (c *Client) GetAccountAtBlockHeight(ctx context.Context, address flow.Address, blockHeight uint64) (*flow.Account, error) {
	var acc *flow.Account
	err := c.withRetry(ctx, func() error {
		var err error
		acc, err = c.pickClient().GetAccountAtBlockHeight(ctx, address, blockHeight)
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

func (c *Client) pickClient() *flowgrpc.Client {
	_, cli := c.pickAnyClient()
	return cli
}

func (c *Client) pickAnyClient() (int, *flowgrpc.Client) {
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

func (c *Client) pickClientForHeight(height uint64) (int, *flowgrpc.Client) {
	if len(c.grpcClients) == 0 {
		return -1, nil
	}
	if len(c.grpcClients) == 1 {
		return 0, c.grpcClients[0]
	}

	start := int(atomic.AddUint32(&c.rr, 1) % uint32(len(c.grpcClients)))
	now := time.Now().UnixNano()

	// Determine the strict best known floor (largest minHeight <= target), regardless
	// of temporary disabled state. This keeps us on the correct spork lane.
	var bestMin uint64
	hasBest := false
	for i := 0; i < len(c.grpcClients); i++ {
		idx := (start + i) % len(c.grpcClients)
		minH := atomic.LoadUint64(&c.minHeights[idx])
		if minH != 0 && height < minH {
			continue
		}
		if minH == 0 {
			continue
		}
		if !hasBest || minH > bestMin {
			bestMin = minH
			hasBest = true
		}
	}

	if hasBest {
		disabledBest := -1
		for i := 0; i < len(c.grpcClients); i++ {
			idx := (start + i) % len(c.grpcClients)
			minH := atomic.LoadUint64(&c.minHeights[idx])
			if minH == bestMin {
				disabledUntil := atomic.LoadInt64(&c.disabledUntil[idx])
				if disabledUntil <= now {
					return idx, c.grpcClients[idx]
				}
				if disabledBest == -1 {
					disabledBest = idx
				}
			}
		}
		// If all best-floor nodes are temporarily disabled, keep using that spork
		// instead of falling back to older sporks that cannot serve this height.
		if disabledBest >= 0 {
			return disabledBest, c.grpcClients[disabledBest]
		}
	}

	// No known floor can serve this height. Try an unknown-floor node (archive or
	// generic endpoint) before full fallback.
	for i := 0; i < len(c.grpcClients); i++ {
		idx := (start + i) % len(c.grpcClients)
		disabledUntil := atomic.LoadInt64(&c.disabledUntil[idx])
		if disabledUntil > now {
			continue
		}
		if atomic.LoadUint64(&c.minHeights[idx]) == 0 {
			return idx, c.grpcClients[idx]
		}
	}

	// If nothing qualifies by minHeight, fall back to any available client.
	return c.pickAnyClient()
}

// MarkNodeMinHeight permanently records that the node at idx cannot serve heights below minHeight.
// This is used by the block fetcher to exclude nodes that return NotFound for specific heights.
func (c *Client) MarkNodeMinHeight(idx int, minHeight uint64) {
	c.markMinHeight(idx, minHeight)
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
	Node      string
	NodeIndex int // Index in the client pool, used by callers to mark minHeight.
	Err       error
}

func (e *NodeUnavailableError) Error() string { return e.Err.Error() }
func (e *NodeUnavailableError) Unwrap() error { return e.Err }

// NodeExhaustedError is returned when a node is rate-limited (ResourceExhausted)
// even after all retries. The caller can temporarily disable the node and try another.
type NodeExhaustedError struct {
	Node      string
	NodeIndex int
	Err       error
}

func (e *NodeExhaustedError) Error() string { return e.Err.Error() }
func (e *NodeExhaustedError) Unwrap() error { return e.Err }

// DisableNodeFor temporarily disables a node for the given duration.
func (c *Client) DisableNodeFor(idx int, d time.Duration) {
	c.disableNodeFor(idx, d)
}

type PinnedClient struct {
	parent *Client
	idx    int
	node   string
	cli    *flowgrpc.Client
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

func (p *PinnedClient) NodeIndex() int {
	return p.idx
}

// NoBulkAPI returns true if the pinned node does not support bulk transaction APIs.
func (p *PinnedClient) NoBulkAPI() bool {
	return atomic.LoadUint32(&p.parent.noBulkAPI[p.idx]) == 1
}

// MarkNoBulkAPI records that the pinned node does not support bulk transaction APIs.
func (c *Client) MarkNoBulkAPI(idx int) {
	if idx >= 0 && idx < len(c.noBulkAPI) {
		atomic.StoreUint32(&c.noBulkAPI[idx], 1)
	}
}

func (p *PinnedClient) withRetry(ctx context.Context, fn func() error) error {
	return p.parent.withRetryPinned(ctx, p.idx, p.node, fn)
}

func (p *PinnedClient) GetBlockByHeight(ctx context.Context, height uint64) (*flow.Block, []*flow.Collection, error) {
	var block *flow.Block
	if err := p.withRetry(ctx, func() error {
		var err error
		block, err = p.cli.GetBlockByHeight(ctx, height)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			block, err = p.getBlockByHeightLegacy(ctx, height)
		}
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
			if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
				coll, err = p.getCollectionLegacy(ctx, guarantee.CollectionID)
			}
			return err
		}); err != nil {
			return nil, nil, fmt.Errorf("failed to get collection %s: %w", guarantee.CollectionID, err)
		}
		collections = append(collections, coll)
	}

	return block, collections, nil
}

// GetBlockHeaderByHeight fetches the block header + collection guarantees, but does not
// fetch collections. This is significantly cheaper than GetBlockByHeight for ingestion.
func (p *PinnedClient) GetBlockHeaderByHeight(ctx context.Context, height uint64) (*flow.Block, error) {
	var block *flow.Block
	if err := p.withRetry(ctx, func() error {
		var err error
		block, err = p.cli.GetBlockByHeight(ctx, height)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			block, err = p.getBlockByHeightLegacy(ctx, height)
		}
		return err
	}); err != nil {
		return nil, fmt.Errorf("failed to get block by height %d: %w", height, err)
	}
	return block, nil
}

// GetTransactionsByBlockID fetches all transactions for a block in a single RPC call.
func (p *PinnedClient) GetTransactionsByBlockID(ctx context.Context, blockID flow.Identifier) ([]*flow.Transaction, error) {
	var txs []*flow.Transaction
	if err := p.withRetry(ctx, func() error {
		var err error
		txs, err = p.cli.GetTransactionsByBlockID(ctx, blockID)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			// Legacy candidate access API has no bulk tx-by-block endpoint.
			return status.Error(codes.Unimplemented, "legacy access API does not support GetTransactionsByBlockID")
		}
		return err
	}); err != nil {
		return nil, err
	}
	return txs, nil
}

// GetTransactionResultsByBlockID fetches all transaction results (status + events) for a block
// in a single RPC call.
func (p *PinnedClient) GetTransactionResultsByBlockID(ctx context.Context, blockID flow.Identifier) ([]*flow.TransactionResult, error) {
	var results []*flow.TransactionResult
	if err := p.withRetry(ctx, func() error {
		var err error
		results, err = p.cli.GetTransactionResultsByBlockID(ctx, blockID)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			// Legacy candidate access API has no bulk results-by-block endpoint.
			return status.Error(codes.Unimplemented, "legacy access API does not support GetTransactionResultsByBlockID")
		}
		return err
	}); err != nil {
		return nil, err
	}
	return results, nil
}

// GetExecutionResultForBlockID fetches execution result for a block.
func (p *PinnedClient) GetExecutionResultForBlockID(ctx context.Context, blockID flow.Identifier) (*flow.ExecutionResult, error) {
	var result *flow.ExecutionResult
	if err := p.withRetry(ctx, func() error {
		var err error
		result, err = p.cli.GetExecutionResultForBlockID(ctx, blockID)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			return status.Error(codes.Unimplemented, "legacy access API does not support GetExecutionResultForBlockID")
		}
		return err
	}); err != nil {
		return nil, err
	}
	return result, nil
}

func (p *PinnedClient) GetCollection(ctx context.Context, collID flow.Identifier) (*flow.Collection, error) {
	var coll *flow.Collection
	if err := p.withRetry(ctx, func() error {
		var err error
		coll, err = p.cli.GetCollection(ctx, collID)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			coll, err = p.getCollectionLegacy(ctx, collID)
		}
		return err
	}); err != nil {
		return nil, err
	}
	return coll, nil
}

func (p *PinnedClient) GetTransaction(ctx context.Context, txID flow.Identifier) (*flow.Transaction, error) {
	var tx *flow.Transaction
	if err := p.withRetry(ctx, func() error {
		var err error
		tx, err = p.cli.GetTransaction(ctx, txID)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			tx, err = p.getTransactionLegacy(ctx, txID)
		}
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
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			res, err = p.getTransactionResultLegacy(ctx, txID)
		}
		return err
	}); err != nil {
		return nil, err
	}
	return res, nil
}

// GetTransactionResultByIndex fetches a single transaction result by block ID and index.
// This is required for system transactions on newer spork nodes that reject requests without a block ID.
func (p *PinnedClient) GetTransactionResultByIndex(ctx context.Context, blockID flow.Identifier, index uint32) (*flow.TransactionResult, error) {
	var res *flow.TransactionResult
	if err := p.withRetry(ctx, func() error {
		var err error
		res, err = p.cli.GetTransactionResultByIndex(ctx, blockID, index)
		if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
			return status.Error(codes.Unimplemented, "legacy access API does not support GetTransactionResultByIndex")
		}
		return err
	}); err != nil {
		return nil, err
	}
	return res, nil
}

func (p *PinnedClient) getBlockByHeightLegacy(ctx context.Context, height uint64) (*flow.Block, error) {
	cli := p.parent.legacyClient(p.idx)
	if cli == nil {
		return nil, fmt.Errorf("legacy access API client not available for node %s", p.node)
	}
	resp, err := cli.GetBlockByHeight(ctx, &legacyaccess.GetBlockByHeightRequest{Height: height})
	if err != nil {
		return nil, err
	}
	block, err := flowgrpcconvert.MessageToBlock(legacyBlockToMessage(resp.GetBlock()))
	if err != nil {
		return nil, err
	}
	return block, nil
}

func (p *PinnedClient) getCollectionLegacy(ctx context.Context, collID flow.Identifier) (*flow.Collection, error) {
	cli := p.parent.legacyClient(p.idx)
	if cli == nil {
		return nil, fmt.Errorf("legacy access API client not available for node %s", p.node)
	}
	idBytes, _ := hex.DecodeString(collID.String())
	resp, err := cli.GetCollectionByID(ctx, &legacyaccess.GetCollectionByIDRequest{Id: idBytes})
	if err != nil {
		return nil, err
	}
	coll, err := flowgrpcconvert.MessageToCollection(legacyCollectionToMessage(resp.GetCollection()))
	if err != nil {
		return nil, err
	}
	return &coll, nil
}

func (p *PinnedClient) getTransactionLegacy(ctx context.Context, txID flow.Identifier) (*flow.Transaction, error) {
	cli := p.parent.legacyClient(p.idx)
	if cli == nil {
		return nil, fmt.Errorf("legacy access API client not available for node %s", p.node)
	}
	idBytes, _ := hex.DecodeString(txID.String())
	resp, err := cli.GetTransaction(ctx, &legacyaccess.GetTransactionRequest{Id: idBytes})
	if err != nil {
		return nil, err
	}
	tx, err := flowgrpcconvert.MessageToTransaction(legacyTransactionToMessage(resp.GetTransaction()))
	if err != nil {
		return nil, err
	}
	return &tx, nil
}

func (p *PinnedClient) getTransactionResultLegacy(ctx context.Context, txID flow.Identifier) (*flow.TransactionResult, error) {
	cli := p.parent.legacyClient(p.idx)
	if cli == nil {
		return nil, fmt.Errorf("legacy access API client not available for node %s", p.node)
	}
	idBytes, _ := hex.DecodeString(txID.String())
	resp, err := cli.GetTransactionResult(ctx, &legacyaccess.GetTransactionRequest{Id: idBytes})
	if err != nil {
		return nil, err
	}
	result, err := flowgrpcconvert.MessageToTransactionResult(legacyResultToMessage(resp, idBytes), nil)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// RawEvent holds event data from raw gRPC without Cadence type decoding.
type RawEvent struct {
	Type             string
	TransactionID    string
	TransactionIndex uint32
	EventIndex       uint32
	Payload          []byte // Raw JSON-CDC bytes
}

// RawTransactionResult holds tx result from raw gRPC without Cadence decoding.
type RawTransactionResult struct {
	Status       flow.TransactionStatus
	StatusCode   uint
	ErrorMessage string
	Events       []RawEvent
	BlockHeight  uint64
}

// GetTransactionResultRaw fetches a transaction result using raw gRPC with JSON-CDC encoding,
// bypassing the SDK's Cadence decoder. This avoids panics from unsupported Cadence types
// like "Restriction kind" in old spork data.
func (p *PinnedClient) GetTransactionResultRaw(ctx context.Context, txID flow.Identifier) (*RawTransactionResult, error) {
	if p.idx < 0 || p.idx >= len(p.parent.rawClients) || p.parent.rawClients[p.idx] == nil {
		if !p.parent.hasLegacyRawClient(p.idx) {
			return nil, fmt.Errorf("raw gRPC client not available for node %s", p.node)
		}
	}

	idBytes, _ := hex.DecodeString(txID.String())

	var resp *access.TransactionResultResponse
	var legacyResp *legacyaccess.TransactionResultResponse
	if err := p.withRetry(ctx, func() error {
		var err error
		if rawCli := p.parent.rawClients[p.idx]; rawCli != nil {
			resp, err = rawCli.GetTransactionResult(ctx, &access.GetTransactionRequest{
				Id:                   idBytes,
				EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
			})
			if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
				legacyResp, err = p.parent.legacyClient(p.idx).GetTransactionResult(ctx, &legacyaccess.GetTransactionRequest{
					Id: idBytes,
				})
			}
		} else if p.parent.hasLegacyRawClient(p.idx) {
			legacyResp, err = p.parent.legacyClient(p.idx).GetTransactionResult(ctx, &legacyaccess.GetTransactionRequest{
				Id: idBytes,
			})
		} else {
			err = fmt.Errorf("raw gRPC client not available for node %s", p.node)
		}
		return err
	}); err != nil {
		return nil, err
	}

	if resp == nil && legacyResp != nil {
		resp = legacyResultToMessage(legacyResp, idBytes)
	}
	if resp == nil {
		return nil, fmt.Errorf("empty tx result response for %s", txID)
	}

	result := &RawTransactionResult{
		StatusCode:   uint(resp.StatusCode),
		ErrorMessage: resp.ErrorMessage,
		BlockHeight:  resp.BlockHeight,
	}

	// Map protobuf status to SDK status
	switch resp.Status {
	case entities.TransactionStatus_SEALED:
		result.Status = flow.TransactionStatusSealed
	case entities.TransactionStatus_EXECUTED:
		result.Status = flow.TransactionStatusExecuted
	case entities.TransactionStatus_FINALIZED:
		result.Status = flow.TransactionStatusFinalized
	case entities.TransactionStatus_PENDING:
		result.Status = flow.TransactionStatusPending
	case entities.TransactionStatus_EXPIRED:
		result.Status = flow.TransactionStatusExpired
	default:
		result.Status = flow.TransactionStatusUnknown
	}

	for _, evt := range resp.Events {
		result.Events = append(result.Events, RawEvent{
			Type:             evt.Type,
			TransactionID:    hex.EncodeToString(evt.TransactionId),
			TransactionIndex: evt.TransactionIndex,
			EventIndex:       evt.EventIndex,
			Payload:          evt.Payload,
		})
	}

	return result, nil
}

// GetTransactionResultsByBlockIDRaw fetches ALL transaction results for a block using raw gRPC
// with JSON-CDC encoding, completely bypassing the SDK's Cadence decoder.
// This is the bulk equivalent of GetTransactionResultRaw — one RPC call instead of N.
func (p *PinnedClient) GetTransactionResultsByBlockIDRaw(ctx context.Context, blockID flow.Identifier) ([]*RawTransactionResult, error) {
	if p.idx < 0 || p.idx >= len(p.parent.rawClients) || p.parent.rawClients[p.idx] == nil {
		if !p.parent.hasLegacyRawClient(p.idx) {
			return nil, fmt.Errorf("raw gRPC client not available for node %s", p.node)
		}
	}

	idBytes, _ := hex.DecodeString(blockID.String())

	var resp *access.TransactionResultsResponse
	if err := p.withRetry(ctx, func() error {
		var err error
		if rawCli := p.parent.rawClients[p.idx]; rawCli != nil {
			resp, err = rawCli.GetTransactionResultsByBlockID(ctx, &access.GetTransactionsByBlockIDRequest{
				BlockId:              idBytes,
				EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
			})
			if err != nil && isUnknownAccessAPIServiceError(err) && p.parent.hasLegacyRawClient(p.idx) {
				// Legacy API has no bulk-by-block tx results endpoint.
				return status.Error(codes.Unimplemented, "legacy access API does not support GetTransactionResultsByBlockID")
			}
		} else if p.parent.hasLegacyRawClient(p.idx) {
			return status.Error(codes.Unimplemented, "legacy access API does not support GetTransactionResultsByBlockID")
		} else {
			err = fmt.Errorf("raw gRPC client not available for node %s", p.node)
		}
		return err
	}); err != nil {
		return nil, err
	}

	results := make([]*RawTransactionResult, 0, len(resp.TransactionResults))
	for _, tr := range resp.TransactionResults {
		r := &RawTransactionResult{
			StatusCode:   uint(tr.StatusCode),
			ErrorMessage: tr.ErrorMessage,
			BlockHeight:  tr.BlockHeight,
		}
		switch tr.Status {
		case entities.TransactionStatus_SEALED:
			r.Status = flow.TransactionStatusSealed
		case entities.TransactionStatus_EXECUTED:
			r.Status = flow.TransactionStatusExecuted
		case entities.TransactionStatus_FINALIZED:
			r.Status = flow.TransactionStatusFinalized
		case entities.TransactionStatus_PENDING:
			r.Status = flow.TransactionStatusPending
		case entities.TransactionStatus_EXPIRED:
			r.Status = flow.TransactionStatusExpired
		default:
			r.Status = flow.TransactionStatusUnknown
		}
		for _, evt := range tr.Events {
			r.Events = append(r.Events, RawEvent{
				Type:             evt.Type,
				TransactionID:    hex.EncodeToString(evt.TransactionId),
				TransactionIndex: evt.TransactionIndex,
				EventIndex:       evt.EventIndex,
				Payload:          evt.Payload,
			})
		}
		results = append(results, r)
	}
	return results, nil
}

func (c *Client) withRetryPinned(ctx context.Context, idx int, node string, fn func() error) error {
	maxRetries := 8
	backoff := 500 * time.Millisecond
	maxBackoff := 30 * time.Second

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
			c.disableNodeFor(idx, getNodeUnavailableDisableDuration())
			return &NodeUnavailableError{Node: node, NodeIndex: idx, Err: err}
		}
		// Some very old candidate nodes do not implement modern AccessAPI at all.
		// If legacy AccessAPI is available for this node, let the caller fallback.
		// Otherwise disable for a long window so history backfill doesn't keep hammering.
		if isUnknownAccessAPIServiceError(err) {
			if c.hasLegacyRawClient(idx) {
				return err
			}
			c.disableNodeFor(idx, 12*time.Hour)
			return &NodeUnavailableError{Node: node, NodeIndex: idx, Err: err}
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
		case codes.NotFound:
			// The node cannot serve this data (likely a spork boundary without
			// an explicit root height in the error message). Return
			// NodeUnavailableError so the caller can repin to another node
			// and permanently mark this node's minimum servable height.
			return &NodeUnavailableError{Node: node, NodeIndex: idx, Err: err}
		case codes.ResourceExhausted:
			if i == maxRetries-1 {
				return &NodeExhaustedError{Node: node, NodeIndex: idx, Err: err}
			}
		case codes.Unavailable, codes.DeadlineExceeded:
			if i == maxRetries-1 {
				return fmt.Errorf("max retries reached: %w", err)
			}
			wait := backoff * time.Duration(1<<i)
			if wait > maxBackoff {
				wait = maxBackoff
			}
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

func (c *Client) hasLegacyRawClient(idx int) bool {
	return idx >= 0 && idx < len(c.legacyRaw) && c.legacyRaw[idx] != nil
}

func (c *Client) legacyClient(idx int) legacyaccess.AccessAPIClient {
	if !c.hasLegacyRawClient(idx) {
		return nil
	}
	return c.legacyRaw[idx]
}

func isZeroAddressesResolverError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "name resolver error: produced zero addresses") ||
		strings.Contains(msg, "produced zero addresses")
}

func isUnknownAccessAPIServiceError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "unknown service flow.access.AccessAPI")
}

func getNodeUnavailableDisableDuration() time.Duration {
	sec := int(getEnvFloat("FLOW_NODE_UNAVAILABLE_DISABLE_SEC", 20))
	if sec < 1 {
		sec = 1
	}
	if sec > 300 {
		sec = 300
	}
	return time.Duration(sec) * time.Second
}

func extractSporkRootHeight(err error) (uint64, bool) {
	if err == nil {
		return 0, false
	}
	msg := err.Error()

	// Primary: explicit spork root height in error message
	const needle = "spork root block height "
	if idx := strings.Index(msg, needle); idx != -1 {
		if v, ok := parseLeadingUint64(msg[idx+len(needle):]); ok {
			return v, true
		}
	}

	return 0, false
}

func parseLeadingUint64(s string) (uint64, bool) {
	n := 0
	for n < len(s) && s[n] >= '0' && s[n] <= '9' {
		n++
	}
	if n == 0 {
		return 0, false
	}
	v, err := strconv.ParseUint(s[:n], 10, 64)
	if err != nil || v == 0 {
		return 0, false
	}
	return v, true
}

func legacyBlockToMessage(b *legacyentities.Block) *entities.Block {
	if b == nil {
		return nil
	}
	out := &entities.Block{
		Id:                   b.Id,
		ParentId:             b.ParentId,
		Height:               b.Height,
		Timestamp:            b.Timestamp,
		CollectionGuarantees: make([]*entities.CollectionGuarantee, 0, len(b.CollectionGuarantees)),
		BlockSeals:           make([]*entities.BlockSeal, 0, len(b.BlockSeals)),
		Signatures:           b.Signatures,
	}
	for _, cg := range b.CollectionGuarantees {
		out.CollectionGuarantees = append(out.CollectionGuarantees, &entities.CollectionGuarantee{
			CollectionId: cg.CollectionId,
			Signatures:   cg.Signatures,
		})
	}
	for _, bs := range b.BlockSeals {
		out.BlockSeals = append(out.BlockSeals, &entities.BlockSeal{
			BlockId:                    bs.BlockId,
			ExecutionReceiptId:         bs.ExecutionReceiptId,
			ExecutionReceiptSignatures: bs.ExecutionReceiptSignatures,
			ResultApprovalSignatures:   bs.ResultApprovalSignatures,
		})
	}
	return out
}

func legacyCollectionToMessage(c *legacyentities.Collection) *entities.Collection {
	if c == nil {
		return nil
	}
	return &entities.Collection{
		Id:             c.Id,
		TransactionIds: c.TransactionIds,
	}
}

func legacyTransactionToMessage(t *legacyentities.Transaction) *entities.Transaction {
	if t == nil {
		return nil
	}
	out := &entities.Transaction{
		Script:             t.Script,
		Arguments:          t.Arguments,
		ReferenceBlockId:   t.ReferenceBlockId,
		GasLimit:           t.GasLimit,
		Payer:              t.Payer,
		Authorizers:        t.Authorizers,
		PayloadSignatures:  make([]*entities.Transaction_Signature, 0, len(t.PayloadSignatures)),
		EnvelopeSignatures: make([]*entities.Transaction_Signature, 0, len(t.EnvelopeSignatures)),
	}
	if t.ProposalKey != nil {
		out.ProposalKey = &entities.Transaction_ProposalKey{
			Address:        t.ProposalKey.Address,
			KeyId:          t.ProposalKey.KeyId,
			SequenceNumber: t.ProposalKey.SequenceNumber,
		}
	}
	for _, sig := range t.PayloadSignatures {
		out.PayloadSignatures = append(out.PayloadSignatures, &entities.Transaction_Signature{
			Address:   sig.Address,
			KeyId:     sig.KeyId,
			Signature: sig.Signature,
		})
	}
	for _, sig := range t.EnvelopeSignatures {
		out.EnvelopeSignatures = append(out.EnvelopeSignatures, &entities.Transaction_Signature{
			Address:   sig.Address,
			KeyId:     sig.KeyId,
			Signature: sig.Signature,
		})
	}
	return out
}

func legacyResultToMessage(r *legacyaccess.TransactionResultResponse, txID []byte) *access.TransactionResultResponse {
	if r == nil {
		return nil
	}
	out := &access.TransactionResultResponse{
		Status:           legacyStatusToStatus(r.Status),
		StatusCode:       r.StatusCode,
		ErrorMessage:     r.ErrorMessage,
		TransactionId:    txID,
		BlockHeight:      0,
		Events:           make([]*entities.Event, 0, len(r.Events)),
		Metadata:         nil,
		BlockId:          nil,
		CollectionId:     nil,
		ComputationUsage: 0,
	}
	for _, evt := range r.Events {
		out.Events = append(out.Events, &entities.Event{
			Type:             evt.Type,
			TransactionId:    evt.TransactionId,
			TransactionIndex: evt.TransactionIndex,
			EventIndex:       evt.EventIndex,
			Payload:          evt.Payload,
		})
	}
	return out
}

func legacyStatusToStatus(s legacyentities.TransactionStatus) entities.TransactionStatus {
	switch s {
	case legacyentities.TransactionStatus_PENDING:
		return entities.TransactionStatus_PENDING
	case legacyentities.TransactionStatus_FINALIZED:
		return entities.TransactionStatus_FINALIZED
	case legacyentities.TransactionStatus_EXECUTED:
		return entities.TransactionStatus_EXECUTED
	case legacyentities.TransactionStatus_SEALED:
		return entities.TransactionStatus_SEALED
	case legacyentities.TransactionStatus_EXPIRED:
		return entities.TransactionStatus_EXPIRED
	default:
		return entities.TransactionStatus_UNKNOWN
	}
}

func extractNodeSporkKey(node string) string {
	for _, network := range []string{"mainnet", "candidate"} {
		idx := strings.Index(node, network)
		if idx == -1 {
			continue
		}
		rest := node[idx+len(network):]
		n := 0
		for n < len(rest) {
			ch := rest[n]
			if ch < '0' || ch > '9' {
				break
			}
			n++
		}
		if n == 0 {
			continue
		}
		v, err := strconv.Atoi(rest[:n])
		if err != nil || v < 0 {
			continue
		}
		return fmt.Sprintf("%s%d", network, v)
	}
	return ""
}

// sporkRootHeights maps node spork key to root block height.
// Each spork access node can only serve blocks at or above its root height.
// Source: https://raw.githubusercontent.com/onflow/flow/refs/heads/master/sporks.json
var sporkRootHeights = map[string]uint64{
	"candidate4": 1065711,
	"candidate5": 2033592,
	"candidate6": 3187931,
	"candidate7": 4132133,
	"candidate8": 4972987,
	"candidate9": 6483246,
	"mainnet1":   7601063,
	"mainnet2":   8742959,
	"mainnet3":   9737133,
	"mainnet4":   9992020,
	"mainnet5":   12020337,
	"mainnet6":   12609237,
	"mainnet7":   13404174,
	"mainnet8":   13950742,
	"mainnet9":   14892104,
	"mainnet10":  15791891,
	"mainnet11":  16755602,
	"mainnet12":  17544523,
	"mainnet13":  18587478,
	"mainnet14":  19050753,
	"mainnet15":  21291692,
	"mainnet16":  23830813,
	"mainnet17":  27341470,
	"mainnet18":  31735955,
	"mainnet19":  35858811,
	"mainnet20":  40171634,
	"mainnet21":  44950207,
	"mainnet22":  47169687,
	"mainnet23":  55114467,
	"mainnet24":  65264619,
	"mainnet25":  85981135,
	"mainnet26":  88226267,
	"mainnet27":  130290659,
	"mainnet28":  137390146,
}

// mainnetSporkRootHeights maps spork number to the root block height for that spork.
// Deprecated: kept for backward compatibility with tests/tools referencing this symbol.
var mainnetSporkRootHeights = map[int]uint64{
	1:  7601063,
	2:  8742959,
	3:  9737133,
	4:  9992020,
	5:  12020337,
	6:  12609237,
	7:  13404174,
	8:  13950742,
	9:  14892104,
	10: 15791891,
	11: 16755602,
	12: 17544523,
	13: 18587478,
	14: 19050753,
	15: 21291692,
	16: 23830813,
	17: 27341470,
	18: 31735955,
	19: 35858811,
	20: 40171634,
	21: 44950207,
	22: 47169687,
	23: 55114467,
	24: 65264619,
	25: 85981135,
	26: 88226267,
	27: 130290659,
	28: 137390146,
}

// initSporkMinHeights pre-populates minHeights for nodes whose hostnames contain
// a known spork key (mainnet/candidate), so pickClientForHeight can immediately
// skip nodes that cannot serve a given height range.
func (c *Client) initSporkMinHeights() {
	for i := range c.nodes {
		key := extractNodeSporkKey(c.nodes[i])
		if root, ok := sporkRootHeights[key]; ok {
			atomic.StoreUint64(&c.minHeights[i], root)
			log.Printf("[flow] Node %s (%s) → minHeight %d", c.nodes[i], key, root)
		}
	}
}

func grpcDialOptionsFromEnv() []grpc.DialOption {
	// Batching Access API calls (e.g. GetTransactionResultsByBlockID) can exceed the default 4MB
	// gRPC receive limit on busy blocks. Allow a larger payload so history backfill doesn't stall.
	//
	// Defaults: 64MB recv, 16MB send. Override with FLOW_GRPC_MAX_RECV_MB/FLOW_GRPC_MAX_SEND_MB.
	maxRecv := int(getEnvFloat("FLOW_GRPC_MAX_RECV_MB", 64) * 1024 * 1024)
	maxSend := int(getEnvFloat("FLOW_GRPC_MAX_SEND_MB", 16) * 1024 * 1024)
	const minBytes = 4 * 1024 * 1024
	if maxRecv < minBytes {
		maxRecv = minBytes
	}
	if maxSend < minBytes {
		maxSend = minBytes
	}
	return []grpc.DialOption{
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(maxRecv),
			grpc.MaxCallSendMsgSize(maxSend),
		),
	}
}

// Close closes the connection
func (c *Client) Close() error {
	var firstErr error
	for _, client := range c.grpcClients {
		if err := client.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	for _, conn := range c.rawConns {
		if conn != nil {
			if err := conn.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}
