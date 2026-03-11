package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// TxRequest describes a transaction to simulate.
type TxRequest struct {
	Cadence     string              `json:"cadence"`
	Arguments   []json.RawMessage   `json:"arguments,omitempty"`
	Authorizers []string            `json:"authorizers,omitempty"`
	Payer       string              `json:"payer,omitempty"`
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

// Client talks to a Flow Emulator REST API.
type Client struct {
	baseURL    string // REST API (default port 8888)
	adminURL   string // Admin API (default port 8080) — snapshots live here
	httpClient *http.Client
}

// NewClient creates a new emulator client pointed at the given REST API base URL.
// The admin URL defaults to port 8080 on the same host.
func NewClient(baseURL string) *Client {
	base := strings.TrimRight(baseURL, "/")
	// Derive admin URL: replace port with 8080
	admin := base
	if idx := strings.LastIndex(base, ":"); idx > 0 {
		admin = base[:idx] + ":8080"
	}
	return &Client{
		baseURL:  base,
		adminURL: admin,
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

// NewClientWithAdmin creates a client with explicit REST and admin URLs.
func NewClientWithAdmin(baseURL, adminURL string) *Client {
	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		adminURL: strings.TrimRight(adminURL, "/"),
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
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

// getLatestBlockID fetches the latest sealed block ID from the emulator.
func (c *Client) getLatestBlockID(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/blocks?height=sealed", nil)
	if err != nil {
		return "", err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var blocks []struct {
		Header struct {
			ID string `json:"id"`
		} `json:"header"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&blocks); err != nil {
		return "", err
	}
	if len(blocks) == 0 {
		return "", fmt.Errorf("no sealed blocks")
	}
	return blocks[0].Header.ID, nil
}

// SendTransaction submits a transaction to the emulator and waits for the result.
func (c *Client) SendTransaction(ctx context.Context, tx *TxRequest) (*TxResult, error) {
	payer := tx.Payer
	if payer == "" {
		payer = "f8d6e0586b0a20c7" // emulator service account
	}

	// Fetch latest block ID for reference
	refBlockID, err := c.getLatestBlockID(ctx)
	if err != nil {
		log.Printf("[simulator] warning: could not fetch latest block ID, using zeros: %v", err)
		refBlockID = strings.Repeat("0", 64)
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
		Script:             scriptB64,
		Arguments:          args,
		ReferenceBlockID:   refBlockID,
		GasLimit:           "9999",
		Payer:              payer,
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
			var txResp struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(respBody, &txResp); err != nil {
				return nil, fmt.Errorf("parsing tx response: %w", err)
			}
			if txResp.ID == "" {
				return nil, fmt.Errorf("emulator returned empty tx ID")
			}
			return c.waitForResult(ctx, txResp.ID)
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

			return txResult, nil
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}

	return nil, fmt.Errorf("transaction %s did not seal after 180s", txID)
}

// WaitForBlockReady polls the emulator until no pending block is being executed.
// This prevents the "pending block ... is currently being executed" race condition
// when a new transaction is submitted immediately after the previous one seals.
func (c *Client) WaitForBlockReady(ctx context.Context) error {
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
			return nil // emulator is ready
		}
		if strings.Contains(string(body), "pending block") {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
			continue
		}
		// Non-pending-block error, assume ready
		return nil
	}
	return fmt.Errorf("emulator still has pending block after 5s")
}

// CreateSnapshot creates a named snapshot of the emulator state.
// Returns the snapshot block height or an error.
func (c *Client) CreateSnapshot(ctx context.Context, name string) (string, error) {
	body, _ := json.Marshal(map[string]string{"name": name})
	req, err := http.NewRequestWithContext(ctx, "POST", c.adminURL+"/emulator/snapshots", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("building snapshot request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

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
