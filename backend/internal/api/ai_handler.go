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
	Script          string `json:"script,omitempty"`
	EVMExecutions   []any  `json:"evm_executions,omitempty"`
	// Pre-analyzed fields from frontend
	ActivityType       string `json:"activity_type,omitempty"`
	ActivityLabel      string `json:"activity_label,omitempty"`
	PreliminarySummary string `json:"preliminary_summary,omitempty"`
	TransferSummary    any    `json:"transfer_summary,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicOutputConfig struct {
	Format anthropicOutputFormat `json:"format"`
}

type anthropicOutputFormat struct {
	Type   string         `json:"type"`
	Schema map[string]any `json:"schema"`
}

type anthropicRequest struct {
	Model        string                 `json:"model"`
	MaxTokens    int                    `json:"max_tokens"`
	System       string                 `json:"system"`
	Messages     []anthropicMessage     `json:"messages"`
	OutputConfig *anthropicOutputConfig `json:"output_config,omitempty"`
}

type anthropicContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicResponse struct {
	Content    []anthropicContentBlock `json:"content"`
	StopReason string                 `json:"stop_reason"`
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

// JSON Schema for structured output — guarantees valid response
var txSummarySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"summary": map[string]any{"type": "string"},
		"flows": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"from":      map[string]any{"type": "string"},
					"fromLabel": map[string]any{"type": "string"},
					"to":        map[string]any{"type": "string"},
					"toLabel":   map[string]any{"type": "string"},
					"token":     map[string]any{"type": "string"},
					"amount":    map[string]any{"type": "string"},
				},
				"required":             []string{"from", "fromLabel", "to", "toLabel", "token", "amount"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"summary", "flows"},
	"additionalProperties": false,
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

	systemPrompt := `You are an expert analyst for the **Flow blockchain**. Flow uses **Cadence**, a resource-oriented smart contract language. Transactions emit typed events like A.{address}.{ContractName}.{EventName} with structured payloads.

Key Cadence event patterns:
- TokensMinted: a new token mint (amount in event payload)
- TokensDeposited / TokensWithdrawn: token movements (amount + to/from in payload)
- Deposit / Withdrawn on FungibleToken: standard FT transfers
- FlowFees.FeesDeducted: routine tx fees (IGNORE these)
- FlowToken.TokensWithdrawn/Deposited to 0xf919ee77447b7497: fee payments (IGNORE)

The input includes:
- "script": the full Cadence transaction script
- "events": emitted events WITH payload values
- "ft_transfers": pre-parsed FT transfers (may be empty for mints)
- "activity_type"/"activity_label": pre-classified tx type
- "preliminary_summary": basic one-line summary from our frontend
- "contract_imports": Cadence contracts used

Rules for "summary":
- 1-2 concise sentences using **markdown**: bold token names, amounts, protocol names with **bold**.
- Use backticks for contract names like ` + "`JOSHIN`" + `.
- Improve on "preliminary_summary" — add specifics from script and events (e.g. mint amounts, recipients).
- NEVER explain fee mechanics or internal gas plumbing.

Rules for "flows":
- Extract from ft_transfers first. If ft_transfers is empty, extract from events (e.g. TokensMinted → show mint flow from contract to recipient).
- Each flow must use REAL 0x hex addresses from the data and REAL numeric amounts from event values.
- NEVER use placeholders. If you cannot determine a real address or amount, omit that flow.
- SKIP FlowFees and routine fee movements entirely.
- For mints: from=contract address, fromLabel=contract name, to=recipient, toLabel="Minter", token=symbol, amount=minted amount.
- Return empty array [] only if truly no meaningful token movement occurred.`

	userContent := fmt.Sprintf("Analyze this Flow blockchain transaction:\n%s", string(txJSON))

	anthropicReq := anthropicRequest{
		Model:     "claude-sonnet-4-5-20250929",
		MaxTokens: 1024,
		System:    systemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: userContent},
		},
		OutputConfig: &anthropicOutputConfig{
			Format: anthropicOutputFormat{
				Type:   "json_schema",
				Schema: txSummarySchema,
			},
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

	// Check for refusal or empty content
	if anthropicResp.StopReason == "refusal" {
		http.Error(w, `{"error":"AI refused to process this transaction"}`, http.StatusUnprocessableEntity)
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
		// Must look like real addresses (0x prefix or hex) — reject placeholders
		if !looksLikeAddress(f.From) || !looksLikeAddress(f.To) {
			continue
		}
		validated = append(validated, f)
	}
	result.Flows = validated

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": result})
}
