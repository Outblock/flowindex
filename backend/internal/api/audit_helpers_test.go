//go:build integration

package api_test

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"testing"
	"time"

	flowgrpc "github.com/onflow/flow-go-sdk/access/grpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ---------------------------------------------------------------------------
// Flow gRPC client (shared across audit tests)
// ---------------------------------------------------------------------------

const mainnetAccessNode = "access.mainnet.nodes.onflow.org:9000"

var flowClient *flowgrpc.BaseClient

func initFlowClient(t *testing.T) {
	t.Helper()
	var err error
	flowClient, err = flowgrpc.NewBaseClient(mainnetAccessNode, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("failed to create Flow gRPC client: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

var (
	reFlowAddress     = regexp.MustCompile(`^0x[0-9a-fA-F]{16}$`)
	reTokenIdentifier = regexp.MustCompile(`^A\.[0-9a-fA-F]{16}\.\w+$`)
	reEVMHash         = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
)

func assertFlowAddress(t *testing.T, addr string) {
	t.Helper()
	if !reFlowAddress.MatchString(addr) {
		t.Errorf("invalid Flow address: %q (want 0x + 16 hex chars)", addr)
	}
}

func assertTokenIdentifier(t *testing.T, id string) {
	t.Helper()
	if !reTokenIdentifier.MatchString(id) {
		t.Errorf("invalid token identifier: %q (want A.{16hex}.Name)", id)
	}
}

func assertEVMHash(t *testing.T, hash string) {
	t.Helper()
	if !reEVMHash.MatchString(hash) {
		t.Errorf("invalid EVM hash: %q (want 0x + 64 hex chars)", hash)
	}
}

func assertPositiveFloat(t *testing.T, label string, val float64) {
	t.Helper()
	if val < 0 || math.IsNaN(val) || math.IsInf(val, 0) {
		t.Errorf("%s: expected non-negative number, got %v", label, val)
	}
}

func assertNonEmpty(t *testing.T, label string, val string) {
	t.Helper()
	if val == "" {
		t.Errorf("%s: expected non-empty string", label)
	}
}

func assertTimestamp(t *testing.T, label string, val string) {
	t.Helper()
	if val == "" {
		t.Errorf("%s: expected RFC3339 timestamp, got empty string", label)
		return
	}
	if _, err := time.Parse(time.RFC3339, val); err != nil {
		// Also try RFC3339Nano
		if _, err2 := time.Parse(time.RFC3339Nano, val); err2 != nil {
			t.Errorf("%s: not a valid RFC3339 timestamp: %q (%v)", label, val, err)
		}
	}
}

func assertFieldsExist(t *testing.T, obj map[string]interface{}, fields ...string) {
	t.Helper()
	var missing []string
	for _, f := range fields {
		if _, ok := obj[f]; !ok {
			missing = append(missing, f)
		}
	}
	if len(missing) > 0 {
		t.Errorf("missing fields: %v (got keys: %v)", missing, mapKeys(obj))
	}
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

func toFloat64(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case json.Number:
		f, _ := n.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	case nil:
		return 0
	default:
		f, _ := strconv.ParseFloat(fmt.Sprintf("%v", v), 64)
		return f
	}
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	default:
		return fmt.Sprintf("%v", s)
	}
}

// ---------------------------------------------------------------------------
// Fetch helpers (build on fetchJSON + checkEnvelope from api_integration_test.go)
// ---------------------------------------------------------------------------

// fetchEnvelopeList fetches the given path, asserts the response is an envelope,
// and parses data as a JSON array of objects.
func fetchEnvelopeList(t *testing.T, path string) []map[string]interface{} {
	t.Helper()
	url := ctx.baseURL + path
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET %s error: %v", path, err)
	}
	if status != 200 {
		t.Fatalf("GET %s status=%d, want 200 (body: %.300s)", path, status, body)
	}
	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("GET %s: envelope check failed", path)
	}
	var items []map[string]interface{}
	if err := json.Unmarshal(dataRaw, &items); err != nil {
		t.Fatalf("GET %s: data is not an array: %v (data: %.300s)", path, err, dataRaw)
	}
	return items
}

// fetchEnvelopeObject fetches the given path, asserts the response is an envelope,
// and parses data as a JSON object.
func fetchEnvelopeObject(t *testing.T, path string) map[string]interface{} {
	t.Helper()
	url := ctx.baseURL + path
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET %s error: %v", path, err)
	}
	if status != 200 {
		t.Fatalf("GET %s status=%d, want 200 (body: %.300s)", path, status, body)
	}
	dataRaw, _, ok := checkEnvelope(t, body)
	if !ok {
		t.Fatalf("GET %s: envelope check failed", path)
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(dataRaw, &obj); err != nil {
		// Many detail endpoints return single-element arrays: {data: [{...}]}
		var items []map[string]interface{}
		if err2 := json.Unmarshal(dataRaw, &items); err2 == nil && len(items) > 0 {
			return items[0]
		}
		t.Fatalf("GET %s: data is not an object or single-element array: %v (data: %.300s)", path, err, dataRaw)
	}
	return obj
}

// fetchBareObject fetches the given path and parses the response as a bare JSON object.
func fetchBareObject(t *testing.T, path string) map[string]interface{} {
	t.Helper()
	url := ctx.baseURL + path
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET %s error: %v", path, err)
	}
	if status != 200 {
		t.Fatalf("GET %s status=%d, want 200 (body: %.300s)", path, status, body)
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatalf("GET %s: response is not a JSON object: %v (body: %.300s)", path, err, body)
	}
	return obj
}

// fetchItemsList fetches a URL and parses data from {items: [...]} format (used by EVM endpoints).
func fetchItemsList(t *testing.T, path string) []map[string]interface{} {
	t.Helper()
	url := ctx.baseURL + path
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET %s error: %v", path, err)
	}
	if status != 200 {
		t.Fatalf("GET %s status=%d, want 200 (body: %.300s)", path, status, body)
	}
	var wrapper struct {
		Items []map[string]interface{} `json:"items"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil {
		t.Fatalf("GET %s: cannot parse {items:[...]}: %v (body: %.300s)", path, err, body)
	}
	return wrapper.Items
}

// ---------------------------------------------------------------------------
// Numeric utility
// ---------------------------------------------------------------------------

// floatsClose returns true if a and b are within tolerance of each other.
func floatsClose(a, b, tolerance float64) bool {
	return math.Abs(a-b) <= tolerance
}
