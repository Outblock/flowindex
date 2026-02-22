//go:build integration

package api_test

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// testContext holds bootstrap data for parameterized tests.
type testContext struct {
	baseURL     string
	blockHeight string
	txID        string
	address     string // a known account address
}

// envelope is the standard API response shape.
type envelope struct {
	Data json.RawMessage        `json:"data"`
	Meta map[string]interface{} `json:"_meta"`
}

// endpointTest defines a single endpoint test case.
type endpointTest struct {
	name         string
	path         string
	wantStatus   int
	wantEnvelope bool     // expect {data, _meta} envelope
	wantJSON     bool     // expect valid JSON (bare array or object, no envelope)
	wantFields   []string // fields expected in first item (for list endpoints) or object
}

var ctx testContext

func TestMain(m *testing.M) {
	base := os.Getenv("FLOWSCAN_API_URL")
	if base == "" {
		base = "https://backend-production-df6e.up.railway.app"
	}
	base = strings.TrimRight(base, "/")
	ctx.baseURL = base

	// Check connectivity
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(base + "/health")
	if err != nil {
		fmt.Fprintf(os.Stderr, "SKIP: API unreachable at %s: %v\n", base, err)
		os.Exit(0)
	}
	resp.Body.Close()

	// Bootstrap: get a valid block height from /status
	if status, body, err := fetchJSON(base + "/status"); err == nil && status == 200 {
		var s map[string]interface{}
		if json.Unmarshal(body, &s) == nil {
			// /status returns bare object; try both field names
			for _, key := range []string{"latest_height", "latest_block_height"} {
				if h, ok := s[key]; ok {
					ctx.blockHeight = formatHeight(h)
					break
				}
			}
		}
	}

	// Fallback: get block height from block list
	if ctx.blockHeight == "" {
		if _, body, err := fetchJSON(base + "/flow/v1/block?limit=1"); err == nil {
			ctx.blockHeight = extractFieldFromList(body, "height")
		}
	}
	if ctx.blockHeight == "" {
		ctx.blockHeight = "140900000"
	}

	// Bootstrap: get a valid transaction ID
	if _, body, err := fetchJSON(base + "/flow/v1/transaction?limit=1"); err == nil {
		ctx.txID = extractFieldFromList(body, "id")
		if ctx.txID == "" {
			ctx.txID = extractFieldFromList(body, "transaction_id")
		}
	}
	if ctx.txID == "" {
		ctx.txID = "unknown"
	}

	// Bootstrap: get a known address
	ctx.address = "0xe467b9dd11fa00df" // FlowFees, always exists
	if ctx.txID != "unknown" {
		if _, body, err := fetchJSON(base + "/flow/v1/transaction/" + ctx.txID); err == nil {
			addr := extractFieldFromObject(body, "proposer")
			if addr != "" {
				ctx.address = addr
			}
		}
	}

	fmt.Printf("Bootstrap: blockHeight=%s txID=%s address=%s\n", ctx.blockHeight, ctx.txID, ctx.address)
	os.Exit(m.Run())
}

// ---------- helpers ----------

// formatHeight converts a JSON number (possibly float64) to integer string.
func formatHeight(v interface{}) string {
	switch h := v.(type) {
	case float64:
		return fmt.Sprintf("%.0f", math.Floor(h))
	case json.Number:
		return h.String()
	default:
		return fmt.Sprintf("%v", h)
	}
}

func fetchJSON(url string) (int, []byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return resp.StatusCode, body, err
}

func extractFieldFromList(body []byte, field string) string {
	// Try envelope first
	var env envelope
	if json.Unmarshal(body, &env) == nil && env.Data != nil {
		var items []map[string]interface{}
		if json.Unmarshal(env.Data, &items) == nil && len(items) > 0 {
			if v, ok := items[0][field]; ok {
				return formatHeight(v)
			}
		}
	}
	// Try bare array
	var items []map[string]interface{}
	if json.Unmarshal(body, &items) == nil && len(items) > 0 {
		if v, ok := items[0][field]; ok {
			return formatHeight(v)
		}
	}
	return ""
}

func extractFieldFromObject(body []byte, field string) string {
	// Try envelope first
	var env envelope
	if json.Unmarshal(body, &env) == nil && env.Data != nil {
		var obj map[string]interface{}
		if json.Unmarshal(env.Data, &obj) == nil {
			if v, ok := obj[field]; ok {
				return fmt.Sprintf("%v", v)
			}
		}
	}
	// Try bare object
	var obj map[string]interface{}
	if json.Unmarshal(body, &obj) == nil {
		if v, ok := obj[field]; ok {
			return fmt.Sprintf("%v", v)
		}
	}
	return ""
}

func checkEnvelope(t *testing.T, body []byte) (dataRaw json.RawMessage, meta map[string]interface{}, ok bool) {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		t.Errorf("envelope parse error: %v (body: %.200s)", err, body)
		return nil, nil, false
	}
	if env.Data == nil {
		t.Errorf("envelope missing 'data' field (body: %.200s)", body)
		return nil, nil, false
	}
	return env.Data, env.Meta, true
}

// checkBareJSON validates that body is valid JSON and optionally checks fields.
func checkBareJSON(t *testing.T, body []byte, fields []string) {
	t.Helper()
	if len(fields) == 0 {
		// Just verify it's valid JSON
		var v interface{}
		if err := json.Unmarshal(body, &v); err != nil {
			t.Errorf("invalid JSON: %v (body: %.200s)", err, body)
		}
		return
	}
	// Try as array
	var items []map[string]interface{}
	if json.Unmarshal(body, &items) == nil {
		if len(items) == 0 {
			t.Logf("array is empty, cannot check fields")
			return
		}
		checkFieldsInMap(t, items[0], fields)
		return
	}
	// Try as object
	var obj map[string]interface{}
	if json.Unmarshal(body, &obj) == nil {
		checkFieldsInMap(t, obj, fields)
		return
	}
	t.Errorf("response is neither array nor object (body: %.200s)", body)
}

func checkFieldsInFirstItem(t *testing.T, dataRaw json.RawMessage, fields []string) {
	t.Helper()
	if len(fields) == 0 {
		return
	}
	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		// Maybe it's a single object
		var obj map[string]interface{}
		if err2 := json.Unmarshal(dataRaw, &obj); err2 != nil {
			t.Errorf("data is neither array nor object: %v / %v (data: %.200s)", err, err2, dataRaw)
			return
		}
		checkFieldsInMap(t, obj, fields)
		return
	}
	if len(items) == 0 {
		t.Logf("data array is empty, cannot check fields")
		return
	}
	checkFieldsInMap(t, items[0], fields)
}

func checkFieldsInMap(t *testing.T, item map[string]interface{}, fields []string) {
	t.Helper()
	var missing []string
	for _, f := range fields {
		if _, ok := item[f]; !ok {
			missing = append(missing, f)
		}
	}
	if len(missing) > 0 {
		t.Errorf("missing fields: %v (got keys: %v)", missing, mapKeys(item))
	}
}

func mapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func runEndpointTests(t *testing.T, tests []endpointTest) {
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			url := ctx.baseURL + tc.path
			status, body, err := fetchJSON(url)
			if err != nil {
				t.Fatalf("GET %s error: %v", tc.path, err)
			}
			if status != tc.wantStatus {
				t.Errorf("GET %s status=%d, want %d (body: %.200s)", tc.path, status, tc.wantStatus, body)
				return
			}
			if tc.wantEnvelope {
				dataRaw, _, ok := checkEnvelope(t, body)
				if ok && len(tc.wantFields) > 0 {
					checkFieldsInFirstItem(t, dataRaw, tc.wantFields)
				}
			} else if tc.wantJSON {
				checkBareJSON(t, body, tc.wantFields)
			}
		})
	}
}

func sub(path string) string {
	r := strings.NewReplacer(
		"{height}", ctx.blockHeight,
		"{id}", ctx.txID,
		"{address}", ctx.address,
	)
	return r.Replace(path)
}

// ---------- test groups ----------

func TestIntegration_Base(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"health", "/health", 200, false, false, nil},
		{"status", "/status", 200, false, true, []string{"latest_height", "chain_id"}},
		{"openapi_yaml", "/openapi.yaml", 200, false, false, nil},
		{"openapi_json", "/openapi.json", 200, false, false, nil},
	})
}

func TestIntegration_Legacy(t *testing.T) {
	// Legacy endpoints return bare arrays/objects (no envelope)
	runEndpointTests(t, []endpointTest{
		{"blocks_list", "/blocks", 200, false, true, []string{"height", "id"}},
		{"block_by_id", sub("/blocks/{height}"), 200, false, true, []string{"height"}},
		{"transactions_list", "/transactions", 200, false, true, []string{"id"}},
		{"transaction_by_id", sub("/transactions/{id}"), 200, false, true, []string{"id"}},
		{"account_detail", sub("/accounts/{address}"), 200, false, true, []string{"address"}},
		{"account_transactions", sub("/accounts/{address}/transactions"), 200, false, true, nil},
		{"account_token_transfers", sub("/accounts/{address}/token-transfers"), 200, false, true, nil},
		{"account_nft_transfers", sub("/accounts/{address}/nft-transfers"), 200, false, true, nil},
		{"account_stats", sub("/accounts/{address}/stats"), 200, false, true, []string{"address"}},
		{"stats_daily", "/stats/daily", 200, false, true, nil},
		{"stats_network", "/stats/network", 200, false, true, nil},
	})
}

func TestIntegration_FlowBlocks(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"block_list", "/flow/v1/block?limit=5", 200, true, false, []string{"height", "id", "timestamp"}},
		{"block_detail", sub("/flow/v1/block/{height}"), 200, true, false, []string{"height", "id"}},
		{"block_transactions", sub("/flow/v1/block/{height}/transaction"), 200, true, false, nil},
		{"block_service_events", sub("/flow/v1/block/{height}/service-event"), 200, true, false, nil},
	})
}

func TestIntegration_FlowTransactions(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"tx_list", "/flow/v1/transaction?limit=5", 200, true, false, []string{"id"}},
		{"tx_detail", sub("/flow/v1/transaction/{id}"), 200, true, false, []string{"id"}},
	})
}

func TestIntegration_FlowAccounts(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"account_list", "/flow/v1/account?limit=5", 200, true, false, nil},
		{"account_detail", sub("/flow/v1/account/{address}"), 200, true, false, nil},
		{"account_txs", sub("/flow/v1/account/{address}/transaction?limit=5"), 200, true, false, nil},
		{"account_ft_transfers", sub("/flow/v1/account/{address}/ft/transfer?limit=5"), 200, true, false, nil},
		{"account_nft_transfers", sub("/flow/v1/account/{address}/nft/transfer?limit=5"), 200, true, false, nil},
		{"account_ft_holdings", sub("/flow/v1/account/{address}/ft/holding"), 200, true, false, nil},
		{"account_ft_list", sub("/flow/v1/account/{address}/ft"), 200, true, false, nil},
		{"account_nft_list", sub("/flow/v1/account/{address}/nft"), 200, true, false, nil},
	})
}

func TestIntegration_FlowFT(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"ft_list", "/flow/v1/ft", 200, true, false, nil},
		{"ft_transfers", "/flow/v1/ft/transfer?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_FlowNFT(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"nft_list", "/flow/v1/nft", 200, true, false, nil},
		{"nft_transfers", "/flow/v1/nft/transfer?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_FlowContracts(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"contract_list", "/flow/v1/contract?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_FlowEVM(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"evm_tx_list", "/flow/v1/evm/transaction?limit=5", 200, true, false, nil},
		{"evm_token_list", "/flow/v1/evm/token?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_FlowStaking(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"node_list", "/flow/v1/node?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_StatusV1(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"count", "/status/v1/count", 200, true, false, nil},
		{"stat", "/status/v1/stat", 200, true, false, nil},
		{"trend_daily", "/status/v1/stat/daily/trend", 200, true, false, nil},
		{"trend_hourly", "/status/v1/stat/hourly/trend", 200, true, false, nil},
		{"flow_stat", "/status/v1/flow/stat", 200, true, false, nil},
		{"epoch_status", "/status/v1/epoch/status", 200, true, false, nil},
		{"epoch_stat", "/status/v1/epoch/stat", 200, true, false, nil},
		{"tokenomics", "/status/v1/tokenomics", 200, true, false, nil},
	})
}

func TestIntegration_DefiV1(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"pairs", "/defi/v1/pair", 200, true, false, nil},
		{"events", "/defi/v1/events?limit=5", 200, true, false, nil},
		{"latest_block", "/defi/v1/latest-block", 200, true, false, nil},
		{"latest_swap", "/defi/v1/latest-swap", 200, true, false, nil},
		{"assets", "/defi/v1/asset", 200, true, false, nil},
	})
}

func TestIntegration_StakingV1(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"delegators", "/staking/v1/delegator", 200, true, false, nil},
		{"epoch_stats", "/staking/v1/epoch/stats", 200, true, false, nil},
		{"rewards_paid", "/staking/v1/rewards/paid", 200, true, false, nil},
		{"rewards_staking", "/staking/v1/rewards/staking", 200, true, false, nil},
		{"tokenomics", "/staking/v1/tokenomics", 200, true, false, nil},
	})
}

func TestIntegration_SimpleV1(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"simple_blocks", "/simple/v1/blocks?limit=5", 200, true, false, nil},
		{"simple_events", "/simple/v1/events?limit=5", 200, true, false, nil},
		{"simple_transaction", "/simple/v1/transaction?limit=5", 200, true, false, nil},
		// transaction/events requires transaction_hash query param
		{"simple_tx_events", sub("/simple/v1/transaction/events?transaction_hash={id}"), 200, true, false, nil},
		{"simple_rewards", "/simple/v1/rewards", 501, false, false, nil},
		{"simple_node_rewards", "/simple/v1/node_rewards", 501, false, false, nil},
	})
}

func TestIntegration_NFTV0(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"nft_holding", "/nft/v0/TopShot/holding?limit=5", 200, true, false, nil},
		{"nft_item", "/nft/v0/TopShot/item?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_Accounting(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"account_detail", sub("/accounting/v1/account/{address}"), 200, true, false, nil},
		{"account_txs", sub("/accounting/v1/account/{address}/transaction?limit=5"), 200, true, false, nil},
		{"account_ft_transfers", sub("/accounting/v1/account/{address}/ft/transfer?limit=5"), 200, true, false, nil},
		{"account_ft", sub("/accounting/v1/account/{address}/ft"), 200, true, false, nil},
		{"account_nft", sub("/accounting/v1/account/{address}/nft"), 200, true, false, nil},
		{"tax_report", sub("/accounting/v1/account/{address}/tax-report"), 200, true, false, nil},
		{"tx_list", "/accounting/v1/transaction?limit=5", 200, true, false, nil},
		{"nft_transfers", "/accounting/v1/nft/transfer?limit=5", 200, true, false, nil},
	})
}

func TestIntegration_PublicV1(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"public_account", sub("/public/v1/account/{address}"), 200, true, false, nil},
		{"epoch_payout", "/public/v1/epoch/payout", 200, false, false, nil},
		{"resolver", "/public/v1/resolver?name=flowscan", 501, false, false, nil},
	})
}

func TestIntegration_WalletV1(t *testing.T) {
	runEndpointTests(t, []endpointTest{
		{"participation", sub("/wallet/v1/participation/{address}"), 501, false, false, nil},
		{"participation_aggregate", sub("/wallet/v1/participation/{address}/aggregate"), 501, false, false, nil},
		{"participation_count", sub("/wallet/v1/participation/{address}/count"), 501, false, false, nil},
	})
}

func TestIntegration_BulkV1(t *testing.T) {
	// bulk/v1/contract returns bare array
	runEndpointTests(t, []endpointTest{
		{"bulk_contract", "/bulk/v1/contract?limit=5", 200, false, true, nil},
	})
}
