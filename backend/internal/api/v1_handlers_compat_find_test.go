package api

import "testing"

func TestFormatFixedDecimals(t *testing.T) {
	tests := []struct {
		in       string
		decimals int
		want     string
		wantErr  bool
	}{
		{in: "164337879534488819", decimals: 8, want: "1643378795.34488819"},
		{in: "1", decimals: 8, want: "0.00000001"},
		{in: "100", decimals: 0, want: "100"},
		{in: "", decimals: 8, wantErr: true},
		{in: "1.23", decimals: 8, wantErr: true},
	}

	for _, tc := range tests {
		got, err := formatFixedDecimals(tc.in, tc.decimals)
		if tc.wantErr {
			if err == nil {
				t.Fatalf("formatFixedDecimals(%q, %d) expected error", tc.in, tc.decimals)
			}
			continue
		}
		if err != nil {
			t.Fatalf("formatFixedDecimals(%q, %d) unexpected error: %v", tc.in, tc.decimals, err)
		}
		if got != tc.want {
			t.Fatalf("formatFixedDecimals(%q, %d) = %q, want %q", tc.in, tc.decimals, got, tc.want)
		}
	}
}

func TestParseCompatTime(t *testing.T) {
	tests := []struct {
		in      string
		wantErr bool
	}{
		{in: "2026-02-18T23:00:00Z"},
		{in: "2026-02-18"},
		{in: "1704067200"},
		{in: ""},
		{in: "bad", wantErr: true},
	}

	for _, tc := range tests {
		_, err := parseCompatTime(tc.in)
		if tc.wantErr && err == nil {
			t.Fatalf("parseCompatTime(%q) expected error", tc.in)
		}
		if !tc.wantErr && err != nil {
			t.Fatalf("parseCompatTime(%q) unexpected error: %v", tc.in, err)
		}
	}
}
