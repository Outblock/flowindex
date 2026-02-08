package ingester

import (
	"testing"

	"github.com/onflow/cadence"
)

func TestFlattenCadenceValueOptionalNil(t *testing.T) {
	t.Parallel()

	w := &Worker{}
	got := w.flattenCadenceValue(cadence.NewOptional(nil))
	if got != nil {
		t.Fatalf("expected nil, got %#v", got)
	}
}

func TestFlattenCadenceValueOptionalAddress(t *testing.T) {
	t.Parallel()

	w := &Worker{}
	addr := cadence.NewAddress([8]byte{0x1e, 0x3c, 0x78, 0xc6, 0xd5, 0x80, 0x27, 0x3b})
	got := w.flattenCadenceValue(cadence.NewOptional(addr))
	// cadence.Address.Hex() returns the canonical hex form for DB storage (no 0x prefix).
	want := "1e3c78c6d580273b"
	if s, ok := got.(string); !ok || s != want {
		t.Fatalf("expected %q, got %#v", want, got)
	}
}
