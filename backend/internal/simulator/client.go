package simulator

import (
	"bytes"
	"context"
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
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new emulator client pointed at the given base URL.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
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

// SendTransaction submits a transaction to the emulator and waits for the result.
func (c *Client) SendTransaction(ctx context.Context, tx *TxRequest) (*TxResult, error) {
	payer := tx.Payer
	if payer == "" {
		payer = "f8d6e0586b0a20c7" // emulator service account
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

	dummySig := base64.StdEncoding.EncodeToString([]byte("dummy"))

	body := emulatorTxBody{
		Script:           scriptB64,
		Arguments:        args,
		ReferenceBlockID: strings.Repeat("0", 64),
		GasLimit:         "9999",
		Payer:            payer,
		ProposalKey: emulatorProposalKey{
			Address:        payer,
			KeyIndex:       "0",
			SequenceNumber: "0",
		},
		Authorizers: authorizers,
		EnvelopeSignatures: []emulatorSignature{
			{
				Address:   payer,
				KeyIndex:  "0",
				Signature: dummySig,
			},
		},
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshalling tx body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/v1/transactions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("building tx request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sending transaction: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("emulator returned status %d: %s", resp.StatusCode, string(respBody))
	}

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

// waitForResult polls the emulator for a sealed transaction result.
func (c *Client) waitForResult(ctx context.Context, txID string) (*TxResult, error) {
	url := fmt.Sprintf("%s/v1/transaction_results/%s", c.baseURL, txID)

	for i := 0; i < 30; i++ {
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

		if result.Status == "SEALED" || result.Status == "EXECUTED" {
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
		case <-time.After(200 * time.Millisecond):
		}
	}

	return nil, fmt.Errorf("transaction %s did not seal after 30 polls", txID)
}

// CreateSnapshot creates a named snapshot of the emulator state.
// Returns the snapshot block height or an error.
func (c *Client) CreateSnapshot(ctx context.Context, name string) (string, error) {
	body, _ := json.Marshal(map[string]string{"name": name})
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/emulator/snapshots", bytes.NewReader(body))
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
	req, err := http.NewRequestWithContext(ctx, "PUT", fmt.Sprintf("%s/emulator/snapshots/%s", c.baseURL, name), nil)
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
