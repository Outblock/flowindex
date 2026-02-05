package ingester

import (
	"regexp"
	"strings"
)

var algoDigits = regexp.MustCompile(`\d+`)

func normalizeSignatureAlgorithm(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if digits := algoDigits.FindString(raw); digits != "" {
		return digits
	}
	switch strings.ToUpper(raw) {
	case "ECDSA_P256":
		return "1"
	case "ECDSA_SECP256K1":
		return "2"
	default:
		return raw
	}
}

func normalizeHashAlgorithm(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if digits := algoDigits.FindString(raw); digits != "" {
		return digits
	}
	switch strings.ToUpper(raw) {
	case "SHA2_256":
		return "1"
	case "SHA2_384":
		return "2"
	case "SHA3_256":
		return "3"
	case "SHA3_384":
		return "4"
	default:
		return raw
	}
}
