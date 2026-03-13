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
	apiKey     string
	httpClient *http.Client
}

func newBlockscoutClient() *blockscoutClient {
	url := strings.TrimRight(os.Getenv("BLOCKSCOUT_URL"), "/")
	if url == "" {
		url = "https://evm.flowindex.io"
	}
	return &blockscoutClient{
		baseURL: url,
		apiKey:  os.Getenv("BLOCKSCOUT_API_KEY"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *blockscoutClient) newRequest(ctx context.Context, rawURL string) (*http.Request, error) {
	// Blockscout requires apikey as a query param (header auth doesn't bypass rate limits)
	if c.apiKey != "" {
		sep := "?"
		if strings.Contains(rawURL, "?") {
			sep = "&"
		}
		rawURL += sep + "apikey=" + c.apiKey
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	return req, nil
}

// blockscoutSmartContractListItem represents a contract from the list endpoint.
type blockscoutSmartContractListItem struct {
	Address struct {
		Hash           string `json:"hash"`
		Name           string `json:"name"`
		IsContract     bool   `json:"is_contract"`
		IsVerified     bool   `json:"is_verified"`
		ProxyType      string `json:"proxy_type"`
		Implementations []struct {
			Address string `json:"address"`
			Name    string `json:"name"`
		} `json:"implementations"`
	} `json:"address"`
	Name                string `json:"name"`
	CompilerVersion     string `json:"compiler_version"`
	Language            string `json:"language"`
	LicenseType         string `json:"license_type"`
	OptimizationEnabled bool   `json:"optimization_enabled"`
	VerifiedAt          string `json:"verified_at"`
}

// blockscoutContractDetail represents the full contract detail (with ABI + source).
type blockscoutContractDetail struct {
	Name                string          `json:"name"`
	ABI                 json.RawMessage `json:"abi"`
	SourceCode          string          `json:"source_code"`
	CompilerVersion     string          `json:"compiler_version"`
	Language            string          `json:"language"`
	LicenseType         string          `json:"license_type"`
	OptimizationEnabled bool            `json:"optimization_enabled"`
	VerifiedAt          string          `json:"verified_at"`
	ProxyType           string          `json:"proxy_type"`
	Implementations     []struct {
		Address string `json:"address"`
		Name    string `json:"name"`
	} `json:"implementations"`
}

// blockscoutAddress represents an address from the Blockscout API.
type blockscoutAddress struct {
	Hash       string `json:"hash"`
	Name       string `json:"name"`
	IsContract bool   `json:"is_contract"`
	IsVerified bool   `json:"is_verified"`
	PublicTags []struct {
		Label string `json:"label"`
	} `json:"public_tags"`
	Token *struct {
		Name   string `json:"name"`
		Symbol string `json:"symbol"`
	} `json:"token"`
}

// FetchVerifiedContractsList paginates through the verified contracts list.
// Returns list items (without ABI/source). Use FetchContractDetail for full data.
func (c *blockscoutClient) FetchVerifiedContractsList(ctx context.Context, since string) ([]blockscoutSmartContractListItem, error) {
	if c.baseURL == "" {
		return nil, nil
	}

	var all []blockscoutSmartContractListItem
	nextParams := ""

	for {
		url := fmt.Sprintf("%s/api/v2/smart-contracts?limit=50", c.baseURL)
		if nextParams != "" {
			url += "&" + nextParams
		}

		req, err := c.newRequest(ctx, url)
		if err != nil {
			return all, fmt.Errorf("create request: %w", err)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return all, fmt.Errorf("fetch contracts: %w", err)
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20)) // 10MB
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return all, fmt.Errorf("status %d: %s", resp.StatusCode, string(body[:min(200, len(body))]))
		}
		if err != nil {
			return all, fmt.Errorf("read body: %w", err)
		}

		var result struct {
			Items          []blockscoutSmartContractListItem `json:"items"`
			NextPageParams map[string]interface{}            `json:"next_page_params"`
		}
		if err := json.Unmarshal(body, &result); err != nil {
			return all, fmt.Errorf("decode response: %w", err)
		}

		if len(result.Items) == 0 {
			break
		}

		// If incremental, stop when we reach already-synced contracts
		if since != "" {
			stopped := false
			for _, item := range result.Items {
				if item.VerifiedAt != "" && item.VerifiedAt <= since {
					stopped = true
					break
				}
				all = append(all, item)
			}
			if stopped {
				break
			}
		} else {
			all = append(all, result.Items...)
		}

		if result.NextPageParams == nil {
			break
		}

		// Build next page query string
		var parts []string
		for k, v := range result.NextPageParams {
			parts = append(parts, fmt.Sprintf("%s=%v", k, v))
		}
		nextParams = strings.Join(parts, "&")
	}

	return all, nil
}

// FetchContractDetail fetches full contract data (ABI, source code) for a single address.
func (c *blockscoutClient) FetchContractDetail(ctx context.Context, evmAddress string) (*blockscoutContractDetail, error) {
	if c.baseURL == "" || evmAddress == "" {
		return nil, nil
	}

	addr := strings.TrimPrefix(strings.ToLower(evmAddress), "0x")
	url := fmt.Sprintf("%s/api/v2/smart-contracts/0x%s", c.baseURL, addr)

	req, err := c.newRequest(ctx, url)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d for contract 0x%s", resp.StatusCode, addr)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20)) // 10MB for source code
	if err != nil {
		return nil, err
	}

	var result blockscoutContractDetail
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// FetchAddress fetches metadata for a single address.
func (c *blockscoutClient) FetchAddress(ctx context.Context, evmAddress string) (*blockscoutAddress, error) {
	if c.baseURL == "" || evmAddress == "" {
		return nil, nil
	}

	addr := strings.TrimPrefix(strings.ToLower(evmAddress), "0x")
	url := fmt.Sprintf("%s/api/v2/addresses/0x%s", c.baseURL, addr)

	req, err := c.newRequest(ctx, url)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d for address 0x%s", resp.StatusCode, addr)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var result blockscoutAddress
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return &result, nil
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

	req, err := c.newRequest(ctx, url)
	if err != nil {
		return nil
	}

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
