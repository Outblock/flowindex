package ingester

import "strings"

// normalizeFlowAddress normalizes Flow addresses to lowercase hex without 0x prefix.
//
// Flow addresses are 8 bytes (16 hex chars). Some upstream payloads include:
// - "0x" prefix
// - the literal string "nil" for empty optionals
// - shorter hex strings (e.g. "0x1"), which we left-pad to 16 chars
//
// If the value cannot be normalized as a Flow address, returns "".
func normalizeFlowAddress(input string) string {
	s := strings.ToLower(strings.TrimSpace(input))
	if s == "" || s == "nil" || s == "<nil>" || s == "null" {
		return ""
	}

	// Some payloads may embed the address inside a wrapper string; prefer the first "0x" occurrence.
	if idx := strings.Index(s, "0x"); idx >= 0 {
		s = s[idx+2:]
	}

	s = strings.TrimPrefix(s, "0x")
	if s == "" {
		return ""
	}

	// Trim non-hex suffixes (e.g. ")" from debug strings).
	end := 0
	for end < len(s) && isHexChar(s[end]) {
		end++
	}
	s = s[:end]
	if s == "" {
		return ""
	}

	// Flow address is 8 bytes => 16 hex chars. Reject longer values (often EVM addresses).
	if len(s) > 16 {
		return ""
	}

	// Left-pad shorter addresses.
	if len(s) < 16 {
		s = strings.Repeat("0", 16-len(s)) + s
	}

	if len(s) != 16 {
		return ""
	}
	for i := 0; i < len(s); i++ {
		if !isHexChar(s[i]) {
			return ""
		}
	}
	return s
}

func isHexChar(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')
}

// normalizeEVMAddress normalizes EVM addresses (20 bytes = 40 hex chars).
// Used for COA addresses which are EVM-length, not Flow-length.
func normalizeEVMAddress(input string) string {
	s := strings.ToLower(strings.TrimSpace(input))
	if s == "" || s == "nil" || s == "<nil>" || s == "null" {
		return ""
	}

	if idx := strings.Index(s, "0x"); idx >= 0 {
		s = s[idx+2:]
	}
	s = strings.TrimPrefix(s, "0x")
	if s == "" {
		return ""
	}

	end := 0
	for end < len(s) && isHexChar(s[end]) {
		end++
	}
	s = s[:end]
	if s == "" {
		return ""
	}

	// EVM address is 20 bytes => 40 hex chars. Also accept Flow-length (16).
	if len(s) > 40 {
		return ""
	}

	// Left-pad to 40 chars for EVM addresses.
	if len(s) > 16 && len(s) < 40 {
		s = strings.Repeat("0", 40-len(s)) + s
	}

	for i := 0; i < len(s); i++ {
		if !isHexChar(s[i]) {
			return ""
		}
	}
	return s
}

