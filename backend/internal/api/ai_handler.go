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
	Summary   string   `json:"summary"`
	Flows     []aiFlow `json:"flows"`
	RiskScore int      `json:"risk_score"`
	RiskLabel string   `json:"risk_label"`
	Tips      []string `json:"tips"`
}

// JSON Schema for structured output
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
		"risk_score": map[string]any{"type": "integer"},
		"risk_label": map[string]any{"type": "string"},
		"tips": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	},
	"required":             []string{"summary", "flows", "risk_score", "risk_label", "tips"},
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

	systemPrompt := `You are an expert security analyst for the **Flow blockchain**. Flow uses **Cadence**, a resource-oriented smart contract language. Transactions emit typed events like A.{address}.{ContractName}.{EventName} with structured payloads.

Key Cadence event patterns:
- TokensMinted: new token mint (amount in event payload)
- TokensDeposited / TokensWithdrawn: token movements (amount + to/from in payload)
- Deposit / Withdrawn on FungibleToken: standard FT transfers
- AccountKeyAdded / AccountKeyRemoved: key management (HIGH RISK if unexpected)
- FlowFees.FeesDeducted: routine tx fees (IGNORE in flows)
- FlowToken to 0xf919ee77447b7497: fee payments (IGNORE in flows)

The input includes:
- "script": full Cadence transaction script
- "events": emitted events WITH payload values
- "ft_transfers": pre-parsed FT transfers
- "activity_type"/"activity_label": pre-classified tx type
- "preliminary_summary": basic one-line summary
- "contract_imports": Cadence contracts used

=== SUMMARY ===
- 1-2 concise sentences with **markdown**: **bold** for token names, amounts, protocol names.
- Backticks for contract names like ` + "`JOSHIN`" + `.
- Add specifics from script and events. NEVER explain fee mechanics.

=== FLOWS ===
- CRITICAL: Use the "ft_transfers" array as your PRIMARY source for flows. These are pre-aggregated: each entry already has the correct total "amount" and "transfer_count" (number of individual transfers combined). Copy from/to addresses and amounts EXACTLY as given. Do NOT re-derive or re-sum from events.
- If ft_transfers is empty, THEN extract from events (TokensMinted, TokensDeposited, etc.).
- REAL 0x hex addresses, REAL numeric amounts only. NEVER use placeholders.
- SKIP FlowFees and routine fee movements.
- For mints: from=contract address, fromLabel=contract name, to=recipient, toLabel="Minter".
- Use the token_symbol field (e.g. "DUST") as the "token" value in flows, NOT the full contract identifier.
- Empty array [] if no meaningful token movement.

=== RISK SCORE (0-100) ===
Evaluate transaction safety:
- 0-20 (Safe): Normal transfers, mints, swaps, standard DeFi operations
- 21-50 (Caution): Unusual patterns, large transfers, unfamiliar contracts
- 51-80 (Warning): Key changes, authorization changes, bulk withdrawals, interacting with unverified contracts
- 81-100 (Dangerous): Draining ALL tokens from account, adding attacker keys + removing owner keys, unauthorized authorizer patterns, known phishing contract signatures, destroying resources/vaults

Key risk indicators:
- AccountKeyAdded + AccountKeyRemoved in same tx = potential account takeover
- Withdrawing ALL of a token balance = potential drain attack
- Script removes keys with full weight (1000) = ownership transfer
- Multiple high-value token withdrawals to unknown addresses
- Script modifies AuthAccount capabilities in suspicious ways

=== RISK LABEL ===
One of: "Safe", "Caution", "Warning", "Dangerous"

=== TIPS ===
1-3 short actionable tips for the user:
- For safe txs: brief confirmation like "Standard token mint, no concerns."
- For risky txs: specific warnings like "This tx removes your account key — verify you authorized this."
- Always mention what the user should verify or be aware of.`

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

	if result.Summary == "" {
		http.Error(w, `{"error":"AI returned empty summary"}`, http.StatusBadGateway)
		return
	}

	// Clamp risk score
	if result.RiskScore < 0 {
		result.RiskScore = 0
	} else if result.RiskScore > 100 {
		result.RiskScore = 100
	}

	// Validate and filter flows
	validated := make([]aiFlow, 0, len(result.Flows))
	for _, f := range result.Flows {
		if f.From == "" || f.To == "" || f.Token == "" || f.Amount == "" {
			continue
		}
		if !looksLikeAddress(f.From) || !looksLikeAddress(f.To) {
			continue
		}
		validated = append(validated, f)
	}
	result.Flows = validated

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": result})
}
