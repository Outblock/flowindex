package flow

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	flowgrpc "github.com/onflow/flow-go-sdk/access/grpc"
	legacyaccess "github.com/onflow/flow/protobuf/go/flow/legacy/access"
	legacyentities "github.com/onflow/flow/protobuf/go/flow/legacy/entities"
)

func testClientWithNodeCount(n int) *Client {
	return &Client{
		grpcClients:   make([]*flowgrpc.Client, n),
		minHeights:    make([]uint64, n),
		disabledUntil: make([]int64, n),
		nodes:         make([]string, n),
	}
}

func TestExtractNodeSporkKey(t *testing.T) {
	cases := []struct {
		node string
		want string
	}{
		{"access-001.mainnet28.nodes.onflow.org:9000", "mainnet28"},
		{"access-001.candidate9.nodes.onflow.org:9000", "candidate9"},
		{"access.mainnet.nodes.onflow.org:9000", ""},
		{"archive.mainnet.nodes.onflow.org:9000", ""},
		{"localhost:9000", ""},
	}

	for _, tc := range cases {
		got := extractNodeSporkKey(tc.node)
		if got != tc.want {
			t.Fatalf("extractNodeSporkKey(%q)=%q, want %q", tc.node, got, tc.want)
		}
	}
}

func TestInitSporkMinHeightsCandidateAndMainnet(t *testing.T) {
	c := testClientWithNodeCount(3)
	c.nodes[0] = "access-001.candidate7.nodes.onflow.org:9000"
	c.nodes[1] = "access-001.mainnet24.nodes.onflow.org:9000"
	c.nodes[2] = "access.mainnet.nodes.onflow.org:9000"

	c.initSporkMinHeights()

	if got, want := atomic.LoadUint64(&c.minHeights[0]), uint64(4132133); got != want {
		t.Fatalf("candidate7 minHeight=%d, want %d", got, want)
	}
	if got, want := atomic.LoadUint64(&c.minHeights[1]), uint64(65264619); got != want {
		t.Fatalf("mainnet24 minHeight=%d, want %d", got, want)
	}
	if got := atomic.LoadUint64(&c.minHeights[2]); got != 0 {
		t.Fatalf("generic endpoint minHeight=%d, want 0", got)
	}
}

func TestPickClientForHeightPrefersClosestKnownFloor(t *testing.T) {
	c := testClientWithNodeCount(4)
	atomic.StoreUint64(&c.minHeights[0], 4132133)  // candidate7
	atomic.StoreUint64(&c.minHeights[1], 4972987)  // candidate8
	atomic.StoreUint64(&c.minHeights[2], 7601063)  // mainnet1
	atomic.StoreUint64(&c.minHeights[3], 55114467) // mainnet23

	cases := []struct {
		height uint64
		want   int
	}{
		{5000000, 1},
		{7000000, 1},
		{7601063, 2},
		{60000000, 3},
	}
	for _, tc := range cases {
		got, _ := c.pickClientForHeight(tc.height)
		if got != tc.want {
			t.Fatalf("height=%d picked idx=%d, want %d", tc.height, got, tc.want)
		}
	}

	atomic.StoreInt64(&c.disabledUntil[3], time.Now().Add(10*time.Minute).UnixNano())
	got, _ := c.pickClientForHeight(60000000)
	if got != 3 {
		t.Fatalf("best-floor node should still be selected even when temporarily disabled, got idx=%d", got)
	}
}

func TestPickClientForHeightFallsBackToUnknownFloorNode(t *testing.T) {
	c := testClientWithNodeCount(3)
	atomic.StoreUint64(&c.minHeights[0], 4132133)
	atomic.StoreUint64(&c.minHeights[1], 7601063)
	atomic.StoreUint64(&c.minHeights[2], 0) // archive/generic

	got, _ := c.pickClientForHeight(10000)
	if got != 2 {
		t.Fatalf("height=10000 picked idx=%d, want 2 (unknown-floor fallback)", got)
	}
}

func TestIsUnknownAccessAPIServiceError(t *testing.T) {
	if !isUnknownAccessAPIServiceError(errors.New("rpc error: code = Unimplemented desc = unknown service flow.access.AccessAPI")) {
		t.Fatalf("expected unknown AccessAPI service error to be detected")
	}
	if isUnknownAccessAPIServiceError(errors.New("rpc error: code = NotFound desc = key not found")) {
		t.Fatalf("unexpected match for unrelated error")
	}
}

func TestGetNodeUnavailableDisableDuration(t *testing.T) {
	t.Setenv("FLOW_NODE_UNAVAILABLE_DISABLE_SEC", "")
	if got := getNodeUnavailableDisableDuration(); got != 20*time.Second {
		t.Fatalf("default disable duration=%v want 20s", got)
	}
	t.Setenv("FLOW_NODE_UNAVAILABLE_DISABLE_SEC", "0")
	if got := getNodeUnavailableDisableDuration(); got != 1*time.Second {
		t.Fatalf("min-clamped disable duration=%v want 1s", got)
	}
	t.Setenv("FLOW_NODE_UNAVAILABLE_DISABLE_SEC", "999")
	if got := getNodeUnavailableDisableDuration(); got != 300*time.Second {
		t.Fatalf("max-clamped disable duration=%v want 300s", got)
	}
}

func TestLegacyStatusToStatus(t *testing.T) {
	t.Parallel()
	if got := legacyStatusToStatus(legacyentities.TransactionStatus_SEALED); got.String() != "SEALED" {
		t.Fatalf("legacy SEALED mapped to %s", got.String())
	}
	if got := legacyStatusToStatus(legacyentities.TransactionStatus_UNKNOWN); got.String() != "UNKNOWN" {
		t.Fatalf("legacy UNKNOWN mapped to %s", got.String())
	}
}

func TestLegacyResultToMessage(t *testing.T) {
	t.Parallel()
	in := &legacyaccess.TransactionResultResponse{
		Status:       legacyentities.TransactionStatus_EXECUTED,
		StatusCode:   1,
		ErrorMessage: "boom",
		Events: []*legacyentities.Event{
			{
				Type:             "A.01.Test",
				TransactionId:    []byte{0x01, 0x02},
				TransactionIndex: 3,
				EventIndex:       4,
				Payload:          []byte(`{"type":"Event"}`),
			},
		},
	}
	out := legacyResultToMessage(in, []byte{0xaa, 0xbb})
	if out == nil {
		t.Fatalf("legacyResultToMessage returned nil")
	}
	if out.Status.String() != "EXECUTED" {
		t.Fatalf("unexpected status: %s", out.Status.String())
	}
	if out.ErrorMessage != "boom" || out.StatusCode != 1 {
		t.Fatalf("unexpected result body: %+v", out)
	}
	if len(out.Events) != 1 || out.Events[0].Type != "A.01.Test" {
		t.Fatalf("unexpected events: %+v", out.Events)
	}
}
