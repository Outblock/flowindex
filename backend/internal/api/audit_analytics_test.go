//go:build integration

package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// /status/* endpoints
// ---------------------------------------------------------------------------

func TestAudit_StatusCount(t *testing.T) {
	items := fetchEnvelopeList(t, "/status/count")
	if len(items) == 0 {
		t.Fatal("expected at least one item in data array")
	}
	obj := items[0]
	assertFieldsExist(t, obj, "block_count", "transaction_count", "max_height")

	bc := toFloat64(obj["block_count"])
	tc := toFloat64(obj["transaction_count"])
	if bc <= 0 {
		t.Errorf("block_count should be positive, got %v", bc)
	}
	if tc <= 0 {
		t.Errorf("transaction_count should be positive, got %v", tc)
	}
	t.Logf("status/count: blocks=%.0f txs=%.0f max_height=%v", bc, tc, obj["max_height"])
}

func TestAudit_StatusStat(t *testing.T) {
	items := fetchEnvelopeList(t, "/status/stat")
	if len(items) == 0 {
		t.Skip("no daily stats data available")
	}
	// Spot-check first item has date-like fields
	first := items[0]
	t.Logf("status/stat: %d entries, first keys: %v", len(items), mapKeys(first))
}

func TestAudit_StatusFlowStat(t *testing.T) {
	items := fetchEnvelopeList(t, "/status/flow/stat")
	if len(items) == 0 {
		t.Fatal("expected at least one item in data array")
	}
	obj := items[0]
	assertFieldsExist(t, obj, "min_height", "max_height", "block_count", "tx_count")

	bc := toFloat64(obj["block_count"])
	tc := toFloat64(obj["tx_count"])
	if bc <= 0 {
		t.Errorf("block_count should be positive, got %v", bc)
	}
	if tc <= 0 {
		t.Errorf("tx_count should be positive, got %v", tc)
	}
	t.Logf("status/flow/stat: blocks=%.0f txs=%.0f range=[%v..%v]",
		bc, tc, obj["min_height"], obj["max_height"])
}

func TestAudit_StatusEpoch(t *testing.T) {
	url := ctx.baseURL + "/status/epoch/status"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /status/epoch/status error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("epoch status endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /status/epoch/status status=%d (body: %.300s)", status, body)
	}

	// Parse envelope
	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	// data is an array; may be empty if no epoch data cached
	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no epoch data available (empty data array)")
	}

	obj := items[0]
	// Epoch data is from a status snapshot — check for epoch number field
	// Field names vary; log what we got
	t.Logf("status/epoch/status: keys=%v", mapKeys(obj))
}

func TestAudit_StatusTokenomics(t *testing.T) {
	url := ctx.baseURL + "/status/tokenomics"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /status/tokenomics error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("tokenomics endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /status/tokenomics status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no tokenomics data available (empty data array)")
	}

	obj := items[0]
	t.Logf("status/tokenomics: keys=%v", mapKeys(obj))
	// Should have supply-related fields if populated
	if ts, ok := obj["total_supply"]; ok {
		v := toFloat64(ts)
		if v <= 0 {
			t.Errorf("total_supply should be positive, got %v", v)
		}
	}
}

func TestAudit_StatusPrice(t *testing.T) {
	url := ctx.baseURL + "/status/price"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /status/price error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("price endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /status/price status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no price data available (price feed may be disabled)")
	}

	obj := items[0]
	assertFieldsExist(t, obj, "asset", "price")
	price := toFloat64(obj["price"])
	assertPositiveFloat(t, "price", price)
	t.Logf("status/price: asset=%v price=%v", obj["asset"], price)
}

func TestAudit_StatusPriceHistory(t *testing.T) {
	url := ctx.baseURL + "/status/price/history"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /status/price/history error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("price history endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /status/price/history status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no price history data available")
	}

	// Spot-check first item
	first := items[0]
	assertFieldsExist(t, first, "price", "as_of")
	t.Logf("status/price/history: %d entries, first price=%v as_of=%v",
		len(items), first["price"], first["as_of"])
}

func TestAudit_StatusNodes(t *testing.T) {
	items := fetchEnvelopeList(t, "/status/nodes")
	if len(items) == 0 {
		t.Skip("no node data available")
	}

	first := items[0]
	assertFieldsExist(t, first, "node_id", "role")

	// Count roles
	roles := map[string]int{}
	for _, n := range items {
		role := toString(n["role"])
		roles[role]++
	}
	t.Logf("status/nodes: %d nodes, roles=%v", len(items), roles)
}

// ---------------------------------------------------------------------------
// /insights/* endpoints
// ---------------------------------------------------------------------------

func TestAudit_InsightsDaily(t *testing.T) {
	url := ctx.baseURL + "/insights/daily"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /insights/daily error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("insights/daily endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /insights/daily status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no daily analytics data available")
	}
	t.Logf("insights/daily: %d entries, first keys: %v", len(items), mapKeys(items[0]))
}

func TestAudit_InsightsBigTransfers(t *testing.T) {
	url := ctx.baseURL + "/insights/big-transfers?limit=5"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /insights/big-transfers error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("big-transfers endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /insights/big-transfers status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no big transfers available (price feed may be disabled)")
	}

	for i, item := range items {
		if i >= 3 {
			break
		}
		t.Logf("big-transfer[%d]: keys=%v", i, mapKeys(item))
	}
}

func TestAudit_InsightsTopContracts(t *testing.T) {
	url := ctx.baseURL + "/insights/top-contracts?limit=5"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /insights/top-contracts error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("top-contracts endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /insights/top-contracts status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no top contracts data available")
	}

	for i, item := range items {
		if i >= 3 {
			break
		}
		t.Logf("top-contract[%d]: keys=%v", i, mapKeys(item))
	}
}

func TestAudit_InsightsTokenVolume(t *testing.T) {
	url := ctx.baseURL + "/insights/token-volume?limit=5"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /insights/token-volume error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("token-volume endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /insights/token-volume status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no token volume data available (price feed may be disabled)")
	}

	for i, item := range items {
		if i >= 3 {
			break
		}
		t.Logf("token-volume[%d]: keys=%v", i, mapKeys(item))
	}
}

// ---------------------------------------------------------------------------
// /public/v1/* compat endpoints
// ---------------------------------------------------------------------------

func TestAudit_CompatTotalSupply(t *testing.T) {
	url := ctx.baseURL + "/public/v1/totalSupply"
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET /public/v1/totalSupply error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 501 {
		t.Skip("totalSupply endpoint not available")
	}
	if resp.StatusCode == 502 {
		t.Skip("totalSupply upstream unavailable (502)")
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET /public/v1/totalSupply status=%d (body: %.300s)", resp.StatusCode, body)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	text := strings.TrimSpace(string(body))
	if text == "" {
		t.Fatal("totalSupply returned empty body")
	}

	val, err := strconv.ParseFloat(text, 64)
	if err != nil {
		t.Fatalf("totalSupply is not a number: %q", text)
	}
	if val <= 0 {
		t.Errorf("totalSupply should be positive, got %v", val)
	}
	t.Logf("totalSupply: %v", val)
}

func TestAudit_CompatEpochPayout(t *testing.T) {
	url := ctx.baseURL + "/public/v1/epoch/payout?limit=2"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /public/v1/epoch/payout error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("epoch payout endpoint not available")
	}
	if status != 200 {
		t.Fatalf("GET /public/v1/epoch/payout status=%d (body: %.300s)", status, body)
	}

	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("envelope check failed")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no epoch payout data available")
	}

	first := items[0]
	assertFieldsExist(t, first, "epoch", "block_height", "fields")
	t.Logf("epoch/payout: epoch=%v block_height=%v", first["epoch"], first["block_height"])

	// Verify fields sub-object
	if fields, ok := first["fields"].(map[string]interface{}); ok {
		total := toFloat64(fields["total"])
		if total <= 0 {
			t.Errorf("payout total should be positive, got %v", total)
		}
		t.Logf("epoch/payout fields: total=%v minted=%v fromFees=%v",
			fields["total"], fields["minted"], fields["fromFees"])
	}
}
