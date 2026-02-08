package ingester

import "testing"

func TestNormalizeFlowAddress(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"nil", ""},
		{"<nil>", ""},
		{"null", ""},
		{"0x", ""},
		{"0x1e3c78c6d580273b", "1e3c78c6d580273b"},
		{"1e3c78c6d580273b", "1e3c78c6d580273b"},
		{"0X1E3C78C6D580273B", "1e3c78c6d580273b"},
		{"0x1", "0000000000000001"},
		{"1", "0000000000000001"},
		{"0000000000000000", "0000000000000000"},
		// EVM addresses are 20 bytes (40 hex). These should not be treated as Flow addresses.
		{"0x0000000000000000000000000000000000000000", ""},
		// Wrapped debug-ish strings should still work as long as they include a 0x Flow address.
		{"Optional(0x1e3c78c6d580273b)", "1e3c78c6d580273b"},
	}

	for _, tc := range cases {
		if got := normalizeFlowAddress(tc.in); got != tc.want {
			t.Fatalf("normalizeFlowAddress(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}
