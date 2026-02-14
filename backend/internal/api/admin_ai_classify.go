package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// JSON Schema for AI template classification structured output
var templateClassifySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"categories": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "string",
				"enum": []string{
					"FT_TRANSFER", "FT_MINT", "NFT_TRANSFER", "NFT_MINT", "NFT_PURCHASE", "NFT_LISTING",
					"STAKING", "ACCOUNT_CREATION", "ACCOUNT_SETUP", "SCHEDULED",
					"EVM_BRIDGE", "EVM_CALL", "SWAP", "LIQUIDITY",
					"CONTRACT_DEPLOY", "SYSTEM", "OTHER",
				},
			},
		},
		"label":       map[string]any{"type": "string"},
		"description": map[string]any{"type": "string"},
	},
	"required":             []string{"categories", "label", "description"},
	"additionalProperties": false,
}

const templateClassifySystemPrompt = `You are an expert classifier for **Cadence** transaction templates on the **Flow blockchain**.

You will receive a Cadence transaction script (a template, NOT a specific executed transaction). Your job is to classify what this template DOES generically.

Return structured JSON with:
- "categories": an array of 1-3 category tags from the allowed enum. Pick the most specific applicable categories.
- "label": a short human-readable badge label (2-5 words) describing this template type. Examples: "FLOW Token Transfer", "NFT Mint", "Staking Reward Claim".
- "description": a single sentence summarizing what this template does.

Category definitions:
- FT_TRANSFER: Transfers fungible tokens between accounts
- FT_MINT: Mints new fungible tokens
- NFT_TRANSFER: Transfers NFTs between accounts
- NFT_MINT: Mints new NFTs
- NFT_PURCHASE: Purchases/buys NFTs (involves payment)
- NFT_LISTING: Lists NFTs for sale on a marketplace
- STAKING: Staking, delegation, or reward operations
- ACCOUNT_CREATION: Creates new Flow accounts
- ACCOUNT_SETUP: Sets up vaults, collections, or capabilities on existing accounts
- SCHEDULED: Scheduled/delayed transaction operations
- EVM_BRIDGE: Bridges assets between Cadence and EVM
- EVM_CALL: Calls EVM contracts from Cadence
- SWAP: Token swap operations (DEX)
- LIQUIDITY: Liquidity pool add/remove operations
- CONTRACT_DEPLOY: Deploys or updates smart contracts
- SYSTEM: System-level or infrastructure transactions
- OTHER: Doesn't fit any specific category

Focus on the template's PURPOSE, not its implementation details. Be concise.`

type aiClassifyRequest struct {
	ScriptHash string `json:"script_hash"`
}

type aiClassifyBatchRequest struct {
	MinTxCount int `json:"min_tx_count"`
	Limit      int `json:"limit"`
}

type aiClassifyResult struct {
	Categories  []string `json:"categories"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
}

type aiClassifyResponse struct {
	ScriptHash  string   `json:"script_hash"`
	Categories  []string `json:"categories"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Error       string   `json:"error,omitempty"`
}

func (s *Server) classifyTemplate(ctx *http.Request, apiKey, scriptHash, scriptText string) (*aiClassifyResult, error) {
	userContent := fmt.Sprintf("Classify this Cadence transaction template:\n\n```cadence\n%s\n```", scriptText)

	anthropicReq := anthropicRequest{
		Model:     "claude-sonnet-4-5-20250929",
		MaxTokens: 512,
		System:    templateClassifySystemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: userContent},
		},
		OutputConfig: &anthropicOutputConfig{
			Format: anthropicOutputFormat{
				Type:   "json_schema",
				Schema: templateClassifySchema,
			},
		},
	}

	body, _ := json.Marshal(anthropicReq)

	httpReq, err := http.NewRequestWithContext(ctx.Context(), "POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("anthropic api: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anthropic returned %d: %s", resp.StatusCode, string(respBody))
	}

	var anthropicResp anthropicResponse
	if err := json.Unmarshal(respBody, &anthropicResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if len(anthropicResp.Content) == 0 {
		return nil, fmt.Errorf("empty response from AI")
	}

	var result aiClassifyResult
	if err := json.Unmarshal([]byte(anthropicResp.Content[0].Text), &result); err != nil {
		return nil, fmt.Errorf("invalid JSON from AI: %w", err)
	}

	return &result, nil
}

func (s *Server) handleAdminAIClassify(w http.ResponseWriter, r *http.Request) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		http.Error(w, `{"error":"ANTHROPIC_API_KEY not configured"}`, http.StatusServiceUnavailable)
		return
	}

	var req aiClassifyRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if req.ScriptHash == "" {
		http.Error(w, `{"error":"script_hash is required"}`, http.StatusBadRequest)
		return
	}

	scriptText, err := s.repo.AdminGetScriptText(r.Context(), req.ScriptHash)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"script not found: %s"}`, err.Error()), http.StatusNotFound)
		return
	}
	if scriptText == "" {
		http.Error(w, `{"error":"script text is empty"}`, http.StatusNotFound)
		return
	}

	result, err := s.classifyTemplate(r, apiKey, req.ScriptHash, scriptText)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"classification failed: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	// Save to database
	categoriesStr := ""
	if len(result.Categories) > 0 {
		for i, c := range result.Categories {
			if i > 0 {
				categoriesStr += ","
			}
			categoriesStr += c
		}
	}
	if err := s.repo.AdminUpdateScriptTemplate(r.Context(), req.ScriptHash, categoriesStr, result.Label, result.Description); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"data": aiClassifyResponse{
			ScriptHash:  req.ScriptHash,
			Categories:  result.Categories,
			Label:       result.Label,
			Description: result.Description,
		},
	})
}

func (s *Server) handleAdminAIClassifyBatch(w http.ResponseWriter, r *http.Request) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		http.Error(w, `{"error":"ANTHROPIC_API_KEY not configured"}`, http.StatusServiceUnavailable)
		return
	}

	var req aiClassifyBatchRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if req.MinTxCount <= 0 {
		req.MinTxCount = 1000
	}
	if req.Limit <= 0 || req.Limit > 50 {
		req.Limit = 20
	}

	templates, err := s.repo.AdminListUnlabeledScriptTemplates(r.Context(), req.MinTxCount, req.Limit)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"query failed: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	results := make([]aiClassifyResponse, 0, len(templates))
	for _, tmpl := range templates {
		scriptText, err := s.repo.AdminGetScriptText(r.Context(), tmpl.ScriptHash)
		if err != nil || scriptText == "" {
			results = append(results, aiClassifyResponse{
				ScriptHash: tmpl.ScriptHash,
				Error:      "script text not found",
			})
			continue
		}

		result, err := s.classifyTemplate(r, apiKey, tmpl.ScriptHash, scriptText)
		if err != nil {
			results = append(results, aiClassifyResponse{
				ScriptHash: tmpl.ScriptHash,
				Error:      err.Error(),
			})
			continue
		}

		categoriesStr := ""
		for i, c := range result.Categories {
			if i > 0 {
				categoriesStr += ","
			}
			categoriesStr += c
		}
		if saveErr := s.repo.AdminUpdateScriptTemplate(r.Context(), tmpl.ScriptHash, categoriesStr, result.Label, result.Description); saveErr != nil {
			results = append(results, aiClassifyResponse{
				ScriptHash: tmpl.ScriptHash,
				Error:      fmt.Sprintf("save failed: %s", saveErr.Error()),
			})
			continue
		}

		results = append(results, aiClassifyResponse{
			ScriptHash:  tmpl.ScriptHash,
			Categories:  result.Categories,
			Label:       result.Label,
			Description: result.Description,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": results})
}
