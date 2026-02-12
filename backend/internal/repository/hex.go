package repository

import (
	"encoding/hex"
	"strconv"
	"strings"
)

func normalizeHex(input string) string {
	if input == "" {
		return ""
	}
	trimmed := strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(input), "0x"), "\\x")
	return trimmed
}

func hexToBytes(input string) []byte {
	normalized := normalizeHex(input)
	if normalized == "" {
		return nil
	}
	out, err := hex.DecodeString(normalized)
	if err != nil {
		return nil
	}
	return out
}

func bytesToHex(input []byte) string {
	if len(input) == 0 {
		return ""
	}
	return hex.EncodeToString(input)
}

func sliceHexToBytes(values []string) [][]byte {
	if len(values) == 0 {
		return nil
	}
	out := make([][]byte, len(values))
	for i, v := range values {
		out[i] = hexToBytes(v)
	}
	return out
}

func sliceBytesToHex(values [][]byte) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = bytesToHex(v)
	}
	return out
}

func parseSmallInt(input string) *int16 {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return nil
	}
	n, err := strconv.Atoi(trimmed)
	if err != nil {
		return nil
	}
	v := int16(n)
	return &v
}

func nullIfEmptyBytes(value []byte) interface{} {
	if len(value) == 0 {
		return nil
	}
	return value
}

func hexToBytesOrNull(input string) interface{} {
	b := hexToBytes(input)
	if len(b) == 0 {
		return nil
	}
	return b
}
