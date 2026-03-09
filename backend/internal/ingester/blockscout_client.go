package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// blockscoutClient fetches decoded transaction data from a Blockscout v2 API
// as a fallback when local EVM call data decoding can't handle the selector.
type blockscoutClient struct {
	baseURL    string
	httpClient *http.Client
}

func newBlockscoutClient() *blockscoutClient {
	url := strings.TrimRight(os.Getenv("BLOCKSCOUT_URL"), "/")
	if url == "" {
		url = "https://evm.flowindex.io"
	}
	return &blockscoutClient{
		baseURL: url,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// blockscoutTokenTransfer represents a single token transfer from Blockscout API.
type blockscoutTokenTransfer struct {
	From struct {
		Hash string `json:"hash"`
	} `json:"from"`
	To struct {
		Hash string `json:"hash"`
	} `json:"to"`
	Total struct {
		Value   string `json:"value"`
		Decimals string `json:"decimals"`
	} `json:"total"`
	Token struct {
		Address  string `json:"address"`
		Name     string `json:"name"`
		Symbol   string `json:"symbol"`
		Type     string `json:"type"` // "ERC-20", "ERC-721", "ERC-1155"
		Decimals string `json:"decimals"`
	} `json:"token"`
	Type    string `json:"type"` // "token_transfer", "token_minting", "token_burning"
	TokenID string `json:"token_id,omitempty"`
}

// FetchTokenTransfers queries Blockscout for token transfers in a transaction.
// Returns nil on any error (best-effort fallback).
func (c *blockscoutClient) FetchTokenTransfers(ctx context.Context, evmHash string) []blockscoutTokenTransfer {
	if c.baseURL == "" || evmHash == "" {
		return nil
	}

	hash := strings.TrimPrefix(strings.ToLower(evmHash), "0x")
	url := fmt.Sprintf("%s/api/v2/transactions/0x%s/token-transfers", c.baseURL, hash)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB max
	if err != nil {
		return nil
	}

	var result struct {
		Items []blockscoutTokenTransfer `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil
	}

	return result.Items
}
