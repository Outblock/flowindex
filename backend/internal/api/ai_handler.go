package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"time"
)

var hexAddrRe = regexp.MustCompile(`^(?:0x)?[0-9a-fA-F]{8,40}$`)

// looksLikeAddress checks if a string looks like a real blockchain address
// (hex with optional 0x prefix, 8-40 chars). Rejects placeholders like "Transaction Signer".
func looksLikeAddress(s string) bool {
	return hexAddrRe.MatchString(s)
}

type aiTxSummaryRequest struct {
	ID              string `json:"id"`
	Status          string `json:"status,omitempty"`
	IsEVM           bool   `json:"is_evm,omitempty"`
	Events          []any  `json:"events,omitempty"`
	FTTransfers     []any  `json:"ft_transfers,omitempty"`
	DefiEvents      []any  `json:"defi_events,omitempty"`
	Tags            []any  `json:"tags,omitempty"`
	ContractImports []any  `json:"contract_imports,omitempty"`
	ScriptSummary   string `json:"script_summary,omitempty"`
	EVMExecutions   []any  `json:"evm_executions,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system"`
	Messages  []anthropicMessage `json:"messages"`
}

type anthropicContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicResponse struct {
	Content []anthropicContentBlock `json:"content"`
}

type aiFlow struct {
	From      string `json:"from"`
	FromLabel string `json:"fromLabel"`
	To        string `json:"to"`
	ToLabel   string `json:"toLabel"`
	Token     string `json:"token"`
	Amount    string `json:"amount"`
}

type aiTxSummaryResponse struct {
	Summary string   `json:"summary"`
	Flows   []aiFlow `json:"flows"`
}

func (s *Server) handleAITxSummary(w http.ResponseWriter, r *http.Request) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		http.Error(w, `{"error":"ANTHROPIC_API_KEY not configured"}`, http.StatusServiceUnavailable)
		return
	}

	var req aiTxSummaryRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	txJSON, _ := json.Marshal(req)

	systemPrompt := `You analyze Flow blockchain transactions. Return ONLY raw JSON (no markdown fences).

The input includes pre-analyzed fields from our frontend:
- "activity_type" / "activity_label": classified tx type (e.g. "ft" / "FT Transfer", "swap" / "Swap", "deploy" / "Deploy")
- "preliminary_summary": a basic one-line summary already generated (e.g. "Sent 100 FLOW to 0xabc...def")
- "transfer_summary": structured summary with token directions, amounts, counterparties

Use these to inform your response — refine and improve them, don't ignore them.

Rules:
- "summary": ONE concise sentence. Improve on "preliminary_summary" — add protocol names, clearer descriptions, or context from events. Do NOT explain fee mechanics or internal plumbing.
- "flows": Array of ACTUAL token movements from ft_transfers/defi_events data ONLY. Each object: {"from":"0xRealAddr","fromLabel":"short name","to":"0xRealAddr","toLabel":"short name","token":"SYMBOL","amount":"123.45"}
  - Use real 0x hex addresses and real numeric amounts from the input data. NEVER use placeholders.
  - SKIP routine fee deposits/withdrawals (FlowToken fee movements to 0xf919ee77447b7497 or FlowFees).
  - If no meaningful user-initiated token transfers exist, return empty flows array [].

Output format: {"summary":"...","flows":[...]}`

	userContent := fmt.Sprintf("Analyze this Flow blockchain transaction:\n%s", string(txJSON))

	anthropicReq := anthropicRequest{
		Model:     "claude-sonnet-4-5-20250929",
		MaxTokens: 1024,
		System:    systemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: userContent},
		},
	}

	body, _ := json.Marshal(anthropicReq)

	httpReq, err := http.NewRequestWithContext(r.Context(), "POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		http.Error(w, `{"error":"failed to create request"}`, http.StatusInternalServerError)
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"anthropic api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		http.Error(w, `{"error":"failed to read response"}`, http.StatusBadGateway)
		return
	}

	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"anthropic returned %d","detail":%s}`, resp.StatusCode, string(respBody)), http.StatusBadGateway)
		return
	}

	var anthropicResp anthropicResponse
	if err := json.Unmarshal(respBody, &anthropicResp); err != nil {
		http.Error(w, `{"error":"failed to parse anthropic response"}`, http.StatusBadGateway)
		return
	}

	if len(anthropicResp.Content) == 0 {
		http.Error(w, `{"error":"empty response from AI"}`, http.StatusBadGateway)
		return
	}

	text := anthropicResp.Content[0].Text

	var result aiTxSummaryResponse
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		http.Error(w, `{"error":"AI returned invalid JSON"}`, http.StatusBadGateway)
		return
	}

	// Validate summary
	if result.Summary == "" {
		http.Error(w, `{"error":"AI returned empty summary"}`, http.StatusBadGateway)
		return
	}

	// Validate and filter flows — only keep entries with real addresses and amounts
	validated := make([]aiFlow, 0, len(result.Flows))
	for _, f := range result.Flows {
		if f.From == "" || f.To == "" || f.Token == "" || f.Amount == "" {
			continue
		}
		// Must look like real addresses (0x prefix or 16-char hex) — reject placeholders
		if !looksLikeAddress(f.From) || !looksLikeAddress(f.To) {
			continue
		}
		validated = append(validated, f)
	}
	result.Flows = validated

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": result})
}
