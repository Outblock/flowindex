package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	flowaccess "github.com/onflow/flow/protobuf/go/flow/access"
	flowentities "github.com/onflow/flow/protobuf/go/flow/entities"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// TxRequest describes a transaction to simulate.
type TxRequest struct {
	Cadence     string            `json:"cadence"`
	Arguments   []json.RawMessage `json:"arguments,omitempty"`
	Authorizers []string          `json:"authorizers,omitempty"`
	Payer       string            `json:"payer,omitempty"`
}

// TxEvent is a single event emitted during simulation.
type TxEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// TxResult holds the outcome of a simulated transaction.
type TxResult struct {
	TxID            string    `json:"tx_id"`
	Success         bool      `json:"success"`
	Error           string    `json:"error,omitempty"`
	Events          []TxEvent `json:"events,omitempty"`
	ComputationUsed int64     `json:"computation_used"`
}

const (
	slowClientOperationThreshold = 500 * time.Millisecond
	slowWaitForResultThreshold   = 2 * time.Second
)

// Client talks to a Flow Emulator REST API.
type Client struct {
	baseURL    string // REST API (default port 8888)
	adminURL   string // Admin API (default port 8080) — snapshots live here
	grpcURL    string // Access API (default port 3569) — scripts and state reads
	httpClient *http.Client
	grpcMu     sync.Mutex
	grpcConn   *grpc.ClientConn
	access     flowaccess.AccessAPIClient
}

// NewClient creates a new emulator client pointed at the given REST API base URL.
// The admin URL defaults to port 8080 on the same host.
func NewClient(baseURL string) *Client {
	base := strings.TrimRight(baseURL, "/")
	admin := derivePortURL(base, "8080")
	grpc := derivePortURL(base, "3569")
	return &Client{
		baseURL:  base,
		adminURL: admin,
		grpcURL:  grpc,
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

// NewClientWithAdmin creates a client with explicit REST and admin URLs.
func NewClientWithAdmin(baseURL, adminURL string) *Client {
	return NewClientWithAdminAndGRPC(baseURL, adminURL, derivePortURL(baseURL, "3569"))
}

// NewClientWithAdminAndGRPC creates a client with explicit REST, admin, and gRPC URLs.
func NewClientWithAdminAndGRPC(baseURL, adminURL, grpcURL string) *Client {
	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		adminURL: strings.TrimRight(adminURL, "/"),
		grpcURL:  strings.TrimRight(grpcURL, "/"),
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

func derivePortURL(baseURL, port string) string {
	base := strings.TrimRight(baseURL, "/")
	if idx := strings.LastIndex(base, ":"); idx > 0 {
		return base[:idx] + ":" + port
	}
	return base
}

func grpcTargetFromURL(raw string) string {
	target := strings.TrimSpace(raw)
	target = strings.TrimPrefix(target, "http://")
	target = strings.TrimPrefix(target, "https://")
	target = strings.TrimSuffix(target, "/")
	return target
}

func (c *Client) accessClient(ctx context.Context) (flowaccess.AccessAPIClient, error) {
	c.grpcMu.Lock()
	defer c.grpcMu.Unlock()

	if c.access != nil {
		return c.access, nil
	}

	target := grpcTargetFromURL(c.grpcURL)
	conn, err := grpc.DialContext(ctx, target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dialing emulator gRPC %q: %w", target, err)
	}

	c.grpcConn = conn
	c.access = flowaccess.NewAccessAPIClient(conn)
	return c.access, nil
}

// ExecuteScriptAtLatestBlock runs a read-only script against the latest sealed block.
// Arguments must already be encoded as Cadence JSON values.
func (c *Client) ExecuteScriptAtLatestBlock(ctx context.Context, script string, arguments []json.RawMessage) (json.RawMessage, error) {
	accessClient, err := c.accessClient(ctx)
	if err != nil {
		return nil, err
	}

	args := make([][]byte, 0, len(arguments))
	for _, arg := range arguments {
		args = append(args, []byte(arg))
	}

	resp, err := accessClient.ExecuteScriptAtLatestBlock(ctx, &flowaccess.ExecuteScriptAtLatestBlockRequest{
		Script:    []byte(script),
		Arguments: args,
	})
	if err != nil {
		return nil, fmt.Errorf("executing script: %w", err)
	}

	return json.RawMessage(resp.GetValue()), nil
}

// GetTokenBalances returns all fungible token vault balances for an address,
// keyed by Cadence type identifier (e.g. A.1654653399040a61.FlowToken.Vault).
func (c *Client) GetTokenBalances(ctx context.Context, address string) (map[string]string, error) {
	arg := json.RawMessage(fmt.Sprintf(`{"type":"Address","value":"0x%s"}`, strings.TrimPrefix(strings.ToLower(address), "0x")))
	value, err := c.ExecuteScriptAtLatestBlock(ctx, tokenBalanceQueryScript, []json.RawMessage{arg})
	if err != nil {
		return nil, err
	}
	return decodeCadenceStringUFix64Dictionary(value)
}

func decodeCadenceStringUFix64Dictionary(raw json.RawMessage) (map[string]string, error) {
	var result struct {
		Type  string `json:"type"`
		Value []struct {
			Key struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"key"`
			Value struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"value"`
		} `json:"value"`
	}

	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decoding Cadence dictionary: %w", err)
	}
	if result.Type != "Dictionary" {
		return nil, fmt.Errorf("unexpected Cadence value type %q", result.Type)
	}

	out := make(map[string]string, len(result.Value))
	for _, entry := range result.Value {
		if entry.Key.Type != "String" || entry.Value.Type != "UFix64" {
			continue
		}
		out[entry.Key.Value] = entry.Value.Value
	}
	return out, nil
}

// HealthCheck returns true if the emulator is reachable and has sealed blocks.
func (c *Client) HealthCheck(ctx context.Context) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/blocks?height=sealed", nil)
	if err != nil {
		return false, fmt.Errorf("building health request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("emulator health check: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("emulator returned status %d", resp.StatusCode)
	}
	return true, nil
}

// emulatorTxBody is the JSON body sent to POST /v1/transactions.
type emulatorTxBody struct {
	Script             string              `json:"script"`
	Arguments          []string            `json:"arguments"`
	ReferenceBlockID   string              `json:"reference_block_id"`
	GasLimit           string              `json:"gas_limit"`
	Payer              string              `json:"payer"`
	ProposalKey        emulatorProposalKey `json:"proposal_key"`
	Authorizers        []string            `json:"authorizers"`
	EnvelopeSignatures []emulatorSignature `json:"envelope_signatures"`
}

type emulatorProposalKey struct {
	Address        string `json:"address"`
	KeyIndex       string `json:"key_index"`
	SequenceNumber string `json:"sequence_number"`
}

type emulatorSignature struct {
	Address   string `json:"address"`
	KeyIndex  string `json:"key_index"`
	Signature string `json:"signature"`
}

// blockInfo holds the parsed block header from the emulator.
type blockInfo struct {
	ID     string
	Height int64
}

// getLatestBlock fetches the latest sealed block from the emulator.
func (c *Client) getLatestBlock(ctx context.Context) (*blockInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/blocks?height=sealed", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("blocks endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var blocks []struct {
		Header struct {
			ID     string `json:"id"`
			Height string `json:"height"`
		} `json:"header"`
	}
	if err := json.Unmarshal(body, &blocks); err != nil {
		return nil, err
	}
	if len(blocks) == 0 {
		return nil, fmt.Errorf("no sealed blocks")
	}

	height, _ := strconv.ParseInt(blocks[0].Header.Height, 10, 64)
	return &blockInfo{ID: blocks[0].Header.ID, Height: height}, nil
}

// getLatestBlockID fetches the latest sealed block ID from the emulator.
func (c *Client) getLatestBlockID(ctx context.Context) (string, error) {
	b, err := c.getLatestBlock(ctx)
	if err != nil {
		return "", err
	}
	return b.ID, nil
}

// getLatestBlockHeight fetches the latest sealed block height from the emulator.
func (c *Client) getLatestBlockHeight(ctx context.Context) (int64, error) {
	b, err := c.getLatestBlock(ctx)
	if err != nil {
		return 0, err
	}
	return b.Height, nil
}

// CommitBlock seals the current pending block, creating an empty block when no
// user transactions are pending. This is used to advance scheduled
// transactions after the initial simulation transaction has committed.
func (c *Client) CommitBlock(ctx context.Context) (*blockInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", c.adminURL+"/emulator/newBlock", nil)
	if err != nil {
		return nil, fmt.Errorf("building commit block request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("committing empty block: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("newBlock returned %d: %s", resp.StatusCode, string(body))
	}

	var block struct {
		Height  int    `json:"height"`
		BlockID string `json:"blockId"`
	}
	if err := json.Unmarshal(body, &block); err != nil {
		return nil, fmt.Errorf("parsing newBlock response: %w", err)
	}

	return &blockInfo{
		ID:     block.BlockID,
		Height: int64(block.Height),
	}, nil
}

// GetTransactionResultsByBlockID fetches all transaction results for a block
// using JSON-CDC event encoding. Blocks committed via the admin newBlock route
// contain only system transactions, with the final result always being the
// system chunk transaction. Setting excludeSystemChunk drops that last entry.
func (c *Client) GetTransactionResultsByBlockID(ctx context.Context, blockID string, excludeSystemChunk bool) ([]TxResult, error) {
	accessClient, err := c.accessClient(ctx)
	if err != nil {
		return nil, err
	}

	rawBlockID, err := hex.DecodeString(strings.TrimPrefix(blockID, "0x"))
	if err != nil {
		return nil, fmt.Errorf("decoding block id %q: %w", blockID, err)
	}

	resp, err := accessClient.GetTransactionResultsByBlockID(ctx, &flowaccess.GetTransactionsByBlockIDRequest{
		BlockId:              rawBlockID,
		EventEncodingVersion: flowentities.EventEncodingVersion_JSON_CDC_V0,
	})
	if err != nil {
		return nil, fmt.Errorf("fetching transaction results for block %s: %w", blockID, err)
	}

	results := resp.GetTransactionResults()
	if excludeSystemChunk && len(results) > 0 {
		results = results[:len(results)-1]
	}

	converted := make([]TxResult, 0, len(results))
	for _, result := range results {
		txID := hex.EncodeToString(result.GetTransactionId())
		txResult := TxResult{
			TxID:            txID,
			Success:         result.GetErrorMessage() == "",
			Error:           result.GetErrorMessage(),
			ComputationUsed: int64(result.GetComputationUsage()),
		}
		for _, ev := range result.GetEvents() {
			txResult.Events = append(txResult.Events, TxEvent{
				Type:    ev.GetType(),
				Payload: json.RawMessage(ev.GetPayload()),
			})
		}
		converted = append(converted, txResult)
	}

	return converted, nil
}

// SendTransaction submits a transaction to the emulator and waits for the result.
func (c *Client) SendTransaction(ctx context.Context, tx *TxRequest) (*TxResult, error) {
	payer := tx.Payer
	if payer == "" {
		payer = "f8d6e0586b0a20c7" // emulator service account
	}

	// Fetch latest block ID for reference
	refBlockStart := time.Now()
	refBlockID, err := c.getLatestBlockID(ctx)
	refBlockElapsed := time.Since(refBlockStart)
	if err != nil {
		log.Printf("[simulator] warning: could not fetch latest block ID, using zeros: %v", err)
		refBlockID = strings.Repeat("0", 64)
	} else if refBlockElapsed >= slowClientOperationThreshold {
		log.Printf("[simulator] fetched latest block ID in %s", refBlockElapsed)
	}

	// Base64-encode the script
	scriptB64 := base64.StdEncoding.EncodeToString([]byte(tx.Cadence))

	// Base64-encode each argument
	args := make([]string, 0, len(tx.Arguments))
	for _, arg := range tx.Arguments {
		args = append(args, base64.StdEncoding.EncodeToString(arg))
	}

	authorizers := tx.Authorizers
	if len(authorizers) == 0 {
		authorizers = []string{payer}
	}

	dummySig := generateDummySignature()

	// Build envelope signatures: one for each unique authorizer + payer
	sigSet := make(map[string]bool)
	var sigs []emulatorSignature
	for _, auth := range authorizers {
		if !sigSet[auth] {
			sigSet[auth] = true
			sigs = append(sigs, emulatorSignature{
				Address:   auth,
				KeyIndex:  "0",
				Signature: dummySig,
			})
		}
	}
	if !sigSet[payer] {
		sigs = append(sigs, emulatorSignature{
			Address:   payer,
			KeyIndex:  "0",
			Signature: dummySig,
		})
	}

	body := emulatorTxBody{
		Script:           scriptB64,
		Arguments:        args,
		ReferenceBlockID: refBlockID,
		GasLimit:         "9999",
		Payer:            payer,
		ProposalKey: emulatorProposalKey{
			Address:        payer,
			KeyIndex:       "0",
			SequenceNumber: "0",
		},
		Authorizers:        authorizers,
		EnvelopeSignatures: sigs,
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshalling tx body: %w", err)
	}

	// Retry loop: the emulator returns 400 "pending block ... is currently being
	// executed" when it hasn't finished committing the previous block. Wait and retry.
	const maxRetries = 10
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		submitStart := time.Now()
		req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/v1/transactions", bytes.NewReader(bodyBytes))
		if err != nil {
			return nil, fmt.Errorf("building tx request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("sending transaction: %w", err)
		}

		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			submitElapsed := time.Since(submitStart)
			var txResp struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(respBody, &txResp); err != nil {
				return nil, fmt.Errorf("parsing tx response: %w", err)
			}
			if txResp.ID == "" {
				return nil, fmt.Errorf("emulator returned empty tx ID")
			}
			if submitElapsed >= slowClientOperationThreshold {
				log.Printf("[simulator] transaction %s accepted in %s (attempt %d/%d)", txResp.ID, submitElapsed, attempt+1, maxRetries)
			}
			waitStart := time.Now()
			result, err := c.waitForResult(ctx, txResp.ID)
			waitElapsed := time.Since(waitStart)
			if err != nil {
				log.Printf("[simulator] transaction %s result wait failed after %s: %v", txResp.ID, waitElapsed, err)
				return nil, err
			}
			if waitElapsed >= slowWaitForResultThreshold {
				log.Printf("[simulator] transaction %s sealed in %s (success=%t events=%d)", txResp.ID, waitElapsed, result.Success, len(result.Events))
			}
			return result, nil
		}

		// Retry on "pending block" errors
		if resp.StatusCode == http.StatusBadRequest && strings.Contains(string(respBody), "pending block") {
			lastErr = fmt.Errorf("emulator returned status %d: %s", resp.StatusCode, string(respBody))
			log.Printf("[simulator] pending block, retrying in %dms (attempt %d/%d)", (attempt+1)*500, attempt+1, maxRetries)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt+1) * 500 * time.Millisecond):
			}
			continue
		}

		return nil, fmt.Errorf("emulator returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil, fmt.Errorf("emulator busy after %d retries: %w", maxRetries, lastErr)
}

// waitForResult polls the emulator for a sealed transaction result.
func (c *Client) waitForResult(ctx context.Context, txID string) (*TxResult, error) {
	start := time.Now()
	url := fmt.Sprintf("%s/v1/transaction_results/%s", c.baseURL, txID)

	for i := 0; i < 360; i++ {
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("building result request: %w", err)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("polling result: %w", err)
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("result endpoint returned %d: %s", resp.StatusCode, string(body))
		}

		var result struct {
			Status          string `json:"status"`
			StatusCode      int    `json:"status_code"`
			ErrorMessage    string `json:"error_message"`
			ComputationUsed string `json:"computation_used"`
			Events          []struct {
				Type             string `json:"type"`
				TransactionID    string `json:"transaction_id"`
				TransactionIndex string `json:"transaction_index"`
				EventIndex       string `json:"event_index"`
				Payload          string `json:"payload"` // base64-encoded
			} `json:"events"`
		}
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("parsing result: %w", err)
		}

		status := strings.ToUpper(result.Status)
		if status == "SEALED" || status == "EXECUTED" {
			txResult := &TxResult{
				TxID:    txID,
				Success: result.ErrorMessage == "",
				Error:   result.ErrorMessage,
			}

			// Parse computation used
			if result.ComputationUsed != "" {
				fmt.Sscanf(result.ComputationUsed, "%d", &txResult.ComputationUsed)
			}

			// Decode events
			for _, ev := range result.Events {
				payload, _ := base64.StdEncoding.DecodeString(ev.Payload)
				txResult.Events = append(txResult.Events, TxEvent{
					Type:    ev.Type,
					Payload: json.RawMessage(payload),
				})
			}

			elapsed := time.Since(start)
			if elapsed >= slowWaitForResultThreshold {
				log.Printf(
					"[simulator] transaction %s reached %s after %s (polls=%d, success=%t, events=%d)",
					txID,
					status,
					elapsed,
					i+1,
					txResult.Success,
					len(txResult.Events),
				)
			}

			return txResult, nil
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}

	log.Printf("[simulator] transaction %s did not seal after %s", txID, time.Since(start))
	return nil, fmt.Errorf("transaction %s did not seal after 180s", txID)
}

// WaitForBlockReady polls the emulator until no pending block is being executed.
// This prevents the "pending block ... is currently being executed" race condition
// when a new transaction is submitted immediately after the previous one seals.
func (c *Client) WaitForBlockReady(ctx context.Context) error {
	start := time.Now()
	pendingPolls := 0
	// Quick test: try a lightweight blocks query. If the emulator is still
	// committing a block, any /v1/ endpoint may return 400 with "pending block".
	for i := 0; i < 20; i++ {
		req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/blocks?height=sealed", nil)
		if err != nil {
			return err
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return err
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			elapsed := time.Since(start)
			if elapsed >= slowClientOperationThreshold {
				log.Printf("[simulator] emulator became block-ready after %s (pending_polls=%d)", elapsed, pendingPolls)
			}
			return nil // emulator is ready
		}
		if strings.Contains(string(body), "pending block") {
			pendingPolls++
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
			continue
		}
		// Non-pending-block error, assume ready
		elapsed := time.Since(start)
		if elapsed >= slowClientOperationThreshold {
			log.Printf("[simulator] block-ready probe returned non-pending response after %s (status=%d)", elapsed, resp.StatusCode)
		}
		return nil
	}
	log.Printf("[simulator] emulator still had pending block after %s (pending_polls=%d)", time.Since(start), pendingPolls)
	return fmt.Errorf("emulator still has pending block after 5s")
}

func (c *Client) createSnapshot(ctx context.Context, name string, replace bool) (string, error) {
	form := url.Values{}
	form.Set("name", name)
	if replace {
		form.Set("replace", "true")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.adminURL+"/emulator/snapshots", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("building snapshot request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("creating snapshot: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("snapshot create returned %d: %s", resp.StatusCode, string(respBody))
	}

	var snapResp struct {
		BlockHeight string `json:"block_height"`
		Context     string `json:"context"`
	}
	if err := json.Unmarshal(respBody, &snapResp); err != nil {
		log.Printf("[simulator] warning: could not parse snapshot response: %v", err)
	}

	return snapResp.BlockHeight, nil
}

// CreateSnapshot creates a named snapshot of the emulator state.
// Returns the snapshot block height or an error.
func (c *Client) CreateSnapshot(ctx context.Context, name string) (string, error) {
	return c.createSnapshot(ctx, name, false)
}

// CreateOrReplaceSnapshot creates a snapshot, replacing an existing one with the same name.
func (c *Client) CreateOrReplaceSnapshot(ctx context.Context, name string) (string, error) {
	return c.createSnapshot(ctx, name, true)
}

// RevertSnapshot reverts the emulator state to a named snapshot.
func (c *Client) RevertSnapshot(ctx context.Context, name string) error {
	req, err := http.NewRequestWithContext(ctx, "PUT", fmt.Sprintf("%s/emulator/snapshots/%s", c.adminURL, name), nil)
	if err != nil {
		return fmt.Errorf("building revert request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("reverting snapshot: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("snapshot revert returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// generateDummySignature creates a valid ECDSA P256 signature for use with --skip-tx-validation.
// The emulator requires valid signature format even when skipping verification.
func generateDummySignature() string {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return base64.StdEncoding.EncodeToString(make([]byte, 64))
	}
	hash := sha256.Sum256([]byte("simulator-dummy"))
	r, s, err := ecdsa.Sign(rand.Reader, key, hash[:])
	if err != nil {
		return base64.StdEncoding.EncodeToString(make([]byte, 64))
	}
	// Flow uses raw r||s encoding, 32 bytes each for P256
	sig := make([]byte, 64)
	rBytes := r.Bytes()
	sBytes := s.Bytes()
	copy(sig[32-len(rBytes):32], rBytes)
	copy(sig[64-len(sBytes):64], sBytes)
	return base64.StdEncoding.EncodeToString(sig)
}
