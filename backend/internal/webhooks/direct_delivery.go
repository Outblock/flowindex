package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// DirectDelivery implements WebhookDelivery by POSTing directly to endpoint URLs
// stored in the database. This is used when Svix is not configured.
type DirectDelivery struct {
	store  *Store
	client *http.Client
}

var _ WebhookDelivery = (*DirectDelivery)(nil)

func NewDirectDelivery(store *Store) *DirectDelivery {
	return &DirectDelivery{
		store: store,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (d *DirectDelivery) CreateApplication(_ context.Context, appID, name string) (string, error) {
	return appID, nil
}

func (d *DirectDelivery) CreateEndpoint(_ context.Context, appID, webhookURL string) (string, error) {
	return "direct-" + appID, nil
}

// SendMessage looks up the endpoint URL and POSTs the payload.
// appID is the user ID; the payload should contain _endpoint_id for targeted delivery.
func (d *DirectDelivery) SendMessage(ctx context.Context, appID, eventType string, payload map[string]interface{}) error {
	// Check if we have a specific endpoint_id in the payload
	if epID, ok := payload["_endpoint_id"].(string); ok && epID != "" {
		ep, err := d.store.GetEndpointByID(ctx, epID)
		if err != nil {
			return fmt.Errorf("get endpoint %s: %w", epID, err)
		}
		if !ep.IsActive {
			return fmt.Errorf("endpoint %s is not active", epID)
		}
		return d.deliverToURL(ctx, ep.URL, eventType, payload)
	}

	// Fallback: send to all active endpoints for the user
	endpoints, err := d.store.ListEndpoints(ctx, appID)
	if err != nil {
		return fmt.Errorf("list endpoints for user %s: %w", appID, err)
	}

	var lastErr error
	for _, ep := range endpoints {
		if !ep.IsActive {
			continue
		}
		if err := d.deliverToURL(ctx, ep.URL, eventType, payload); err != nil {
			log.Printf("[direct_delivery] failed to POST to %s: %v", ep.URL, err)
			lastErr = err
		}
	}
	return lastErr
}

func (d *DirectDelivery) DeleteEndpoint(_ context.Context, appID, endpointID string) error {
	return nil
}

// deliverToURL detects the endpoint type and formats the payload accordingly.
func (d *DirectDelivery) deliverToURL(ctx context.Context, url, eventType string, payload map[string]interface{}) error {
	// Normalize the payload: convert struct data fields to map via JSON round-trip
	// so that formatDiscordPayload/formatSlackPayload can access fields by string key.
	normalized := normalizePayload(payload)

	// Check for Telegram delivery (url is "telegram://<bot_token>/<chat_id>")
	if isTelegramEndpoint(url) {
		return d.deliverTelegram(ctx, url, eventType, normalized)
	}

	var body []byte
	var err error

	if isDiscordWebhook(url) {
		body, err = json.Marshal(formatDiscordPayload(eventType, normalized))
	} else if isSlackWebhook(url) {
		body, err = json.Marshal(formatSlackPayload(eventType, normalized))
	} else {
		// Strip internal fields for generic webhooks
		clean := make(map[string]interface{}, len(normalized))
		for k, v := range normalized {
			if !strings.HasPrefix(k, "_") {
				clean[k] = v
			}
		}
		body, err = json.Marshal(clean)
	}
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	return d.postToURL(ctx, url, body, eventType)
}

// normalizePayload converts struct values (like *models.TokenTransfer) to
// map[string]interface{} via JSON round-trip so field access works uniformly.
func normalizePayload(payload map[string]interface{}) map[string]interface{} {
	raw, err := json.Marshal(payload)
	if err != nil {
		return payload
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return payload
	}
	return out
}

func (d *DirectDelivery) postToURL(ctx context.Context, url string, body []byte, eventType string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-FlowIndex-Event", eventType)

	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("POST %s returned %d", url, resp.StatusCode)
	}

	log.Printf("[direct_delivery] delivered to %s: %d", url, resp.StatusCode)
	return nil
}

// --- Platform detection ---

func isDiscordWebhook(url string) bool {
	return strings.Contains(url, "discord.com/api/webhooks/") ||
		strings.Contains(url, "discordapp.com/api/webhooks/")
}

func isSlackWebhook(url string) bool {
	return strings.Contains(url, "hooks.slack.com/")
}

// --- Discord formatting ---

func formatDiscordPayload(eventType string, payload map[string]interface{}) map[string]interface{} {
	// Build a rich embed for Discord
	title := formatEventTitle(eventType)
	description := formatEventDescription(eventType, payload)

	embed := map[string]interface{}{
		"title":       title,
		"description": description,
		"color":       0x00EF8B, // FlowIndex green
		"footer": map[string]interface{}{
			"text": "FlowIndex Webhook",
		},
	}

	if ts, ok := payload["timestamp"].(string); ok {
		embed["timestamp"] = ts
	}

	// Add fields for key data
	var fields []map[string]interface{}
	if height, ok := payload["block_height"]; ok {
		fields = append(fields, map[string]interface{}{
			"name":   "Block Height",
			"value":  fmt.Sprintf("`%v`", height),
			"inline": true,
		})
	}
	if data, ok := payload["data"].(map[string]interface{}); ok {
		if from, ok := data["from_address"].(string); ok && from != "" {
			fields = append(fields, map[string]interface{}{
				"name":   "From",
				"value":  fmt.Sprintf("`%s`", truncAddr(from)),
				"inline": true,
			})
		}
		if to, ok := data["to_address"].(string); ok && to != "" {
			fields = append(fields, map[string]interface{}{
				"name":   "To",
				"value":  fmt.Sprintf("`%s`", truncAddr(to)),
				"inline": true,
			})
		}
		if amount, ok := data["amount"].(string); ok && amount != "" {
			fields = append(fields, map[string]interface{}{
				"name":   "Amount",
				"value":  amount,
				"inline": true,
			})
		}
		if tokenID, ok := data["token_id"].(string); ok && tokenID != "" {
			fields = append(fields, map[string]interface{}{
				"name":   "Token ID",
				"value":  tokenID,
				"inline": true,
			})
		}
		if contract, ok := data["contract_name"].(string); ok && contract != "" {
			fields = append(fields, map[string]interface{}{
				"name":   "Contract",
				"value":  contract,
				"inline": true,
			})
		}
		if txID, ok := data["transaction_id"].(string); ok && txID != "" {
			fields = append(fields, map[string]interface{}{
				"name":   "Transaction",
				"value":  fmt.Sprintf("[`%s`](https://flowindex.io/tx/%s)", truncAddr(txID), txID),
				"inline": false,
			})
		}
	}
	if len(fields) > 0 {
		embed["fields"] = fields
	}

	return map[string]interface{}{
		"embeds": []interface{}{embed},
	}
}

// --- Slack formatting ---

func formatSlackPayload(eventType string, payload map[string]interface{}) map[string]interface{} {
	title := formatEventTitle(eventType)
	text := formatEventDescription(eventType, payload)

	return map[string]interface{}{
		"text": fmt.Sprintf("*%s*\n%s", title, text),
	}
}

// --- Shared helpers ---

func formatEventTitle(eventType string) string {
	switch eventType {
	case "ft.transfer":
		return "💸 FT Transfer"
	case "ft.large_transfer":
		return "🐋 Whale Transfer"
	case "nft.transfer":
		return "🖼️ NFT Transfer"
	case "evm.transaction":
		return "⛓️ EVM Transaction"
	case "account.created":
		return "👤 Account Created"
	case "staking.event":
		return "🥩 Staking Event"
	case "defi.swap":
		return "🔄 DeFi Swap"
	default:
		return "📡 " + eventType
	}
}

func formatEventDescription(eventType string, payload map[string]interface{}) string {
	data, _ := payload["data"].(map[string]interface{})
	if data == nil {
		return fmt.Sprintf("Event `%s` at block %v", eventType, payload["block_height"])
	}

	switch eventType {
	case "ft.transfer", "ft.large_transfer":
		from := strVal(data, "from_address")
		to := strVal(data, "to_address")
		amount := strVal(data, "amount")
		contract := strVal(data, "contract_name")
		if contract == "" {
			contract = strVal(data, "token_contract_address")
		}
		return fmt.Sprintf("%s %s\n`%s` → `%s`", amount, contract, truncAddr(from), truncAddr(to))
	case "nft.transfer":
		from := strVal(data, "from_address")
		to := strVal(data, "to_address")
		contract := strVal(data, "contract_name")
		tokenID := strVal(data, "token_id")
		return fmt.Sprintf("**%s** #%s\n`%s` → `%s`", contract, tokenID, truncAddr(from), truncAddr(to))
	default:
		j, _ := json.Marshal(data)
		s := string(j)
		if len(s) > 300 {
			s = s[:297] + "..."
		}
		return s
	}
}

func strVal(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func truncAddr(addr string) string {
	if len(addr) <= 16 {
		return addr
	}
	return addr[:8] + "..." + addr[len(addr)-6:]
}

// --- Telegram delivery ---

func isTelegramEndpoint(url string) bool {
	return strings.HasPrefix(url, "telegram://")
}

// parseTelegramURL extracts bot token and chat ID from "telegram://<bot_token>/<chat_id>".
func parseTelegramURL(url string) (botToken, chatID string, err error) {
	trimmed := strings.TrimPrefix(url, "telegram://")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid telegram URL format: expected telegram://<bot_token>/<chat_id>")
	}
	return parts[0], parts[1], nil
}

func (d *DirectDelivery) deliverTelegram(ctx context.Context, url, eventType string, payload map[string]interface{}) error {
	botToken, chatID, err := parseTelegramURL(url)
	if err != nil {
		return err
	}

	text := formatTelegramPayload(eventType, payload)

	telegramAPI := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	body, err := json.Marshal(map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	})
	if err != nil {
		return fmt.Errorf("marshal telegram payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, telegramAPI, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create telegram request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("telegram POST: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("telegram API returned %d", resp.StatusCode)
	}

	log.Printf("[direct_delivery] delivered to telegram chat %s: %d", chatID, resp.StatusCode)
	return nil
}

func formatTelegramPayload(eventType string, payload map[string]interface{}) string {
	title := formatEventTitle(eventType)
	data, _ := payload["data"].(map[string]interface{})

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("*%s*\n", title))

	if data == nil {
		sb.WriteString(fmt.Sprintf("Event `%s` at block %v", eventType, payload["block_height"]))
		return sb.String()
	}

	switch eventType {
	case "ft.transfer", "ft.large_transfer":
		from := strVal(data, "from_address")
		to := strVal(data, "to_address")
		amount := strVal(data, "amount")
		contract := strVal(data, "contract_name")
		if contract == "" {
			contract = strVal(data, "token_contract_address")
		}
		sb.WriteString(fmt.Sprintf("%s %s\n`%s` → `%s`", amount, contract, truncAddr(from), truncAddr(to)))
	case "nft.transfer":
		from := strVal(data, "from_address")
		to := strVal(data, "to_address")
		contract := strVal(data, "contract_name")
		tokenID := strVal(data, "token_id")
		sb.WriteString(fmt.Sprintf("*%s* #%s\n`%s` → `%s`", contract, tokenID, truncAddr(from), truncAddr(to)))
	default:
		j, _ := json.Marshal(data)
		s := string(j)
		if len(s) > 300 {
			s = s[:297] + "..."
		}
		sb.WriteString(s)
	}

	if txID := strVal(data, "transaction_id"); txID != "" {
		sb.WriteString(fmt.Sprintf("\n[View Tx](https://flowindex.io/tx/%s)", txID))
	}

	return sb.String()
}
