package ingester

import (
	"fmt"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestShouldMarkNodeMinHeight(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "not found tx", err: status.Error(codes.NotFound, "transaction result not found"), want: false},
		{name: "not found block by height", err: status.Error(codes.NotFound, "block with height 12000167 not found"), want: false},
		{name: "spork root in message", err: fmt.Errorf("rpc error: code = NotFound desc = block with height 7601062 not found: spork root block height 7601063"), want: true},
		{name: "unavailable", err: status.Error(codes.Unavailable, "transport closed"), want: false},
		{name: "unknown service", err: status.Error(codes.Unimplemented, "unknown service flow.access.AccessAPI"), want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := shouldMarkNodeMinHeight(tc.err)
			if got != tc.want {
				t.Fatalf("shouldMarkNodeMinHeight(%v)=%v want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestIsMissingCollectionError(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "not found collection key", err: status.Error(codes.NotFound, "could not look up collection: key not found"), want: true},
		{name: "not found no known collection", err: status.Error(codes.NotFound, "no known collection with ID"), want: true},
		{name: "not found tx", err: status.Error(codes.NotFound, "transaction result not found"), want: false},
		{name: "unavailable collection", err: status.Error(codes.Unavailable, "collection backend unavailable"), want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isMissingCollectionError(tc.err)
			if got != tc.want {
				t.Fatalf("isMissingCollectionError(%v)=%v want %v", tc.err, got, tc.want)
			}
		})
	}
}
