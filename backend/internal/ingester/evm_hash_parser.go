package ingester

import (
	"encoding/hex"
	"math"
	"strconv"
	"strings"
)

func isEVMTransactionExecutedEvent(eventType string) bool {
	return strings.Contains(eventType, "EVM.TransactionExecuted")
}

func extractEVMHashFromPayload(payload interface{}) string {
	m, ok := payload.(map[string]interface{})
	if !ok {
		return ""
	}

	keys := []string{"hash", "transactionHash", "txHash", "evmHash"}
	for _, key := range keys {
		if v, ok := m[key]; ok {
			if h := normalizeEVMHashValue(v); h != "" {
				return h
			}
		}
	}
	return ""
}

func normalizeEVMHashValue(value interface{}) string {
	switch v := value.(type) {
	case string:
		return normalizeEVMHex(v)
	case []byte:
		if len(v) == 0 {
			return ""
		}
		return hex.EncodeToString(v)
	case []interface{}:
		if b, ok := bytesFromInterfaceArray(v); ok && len(b) > 0 {
			return hex.EncodeToString(b)
		}
	}
	return ""
}

func normalizeEVMHex(input string) string {
	s := strings.TrimSpace(input)
	if s == "" {
		return ""
	}
	s = strings.ToLower(s)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "0x"), "\\x")
	return s
}

func bytesFromInterfaceArray(values []interface{}) ([]byte, bool) {
	out := make([]byte, 0, len(values))
	for _, v := range values {
		b, ok := interfaceToByte(v)
		if !ok {
			return nil, false
		}
		out = append(out, b)
	}
	return out, true
}

func interfaceToByte(value interface{}) (byte, bool) {
	switch v := value.(type) {
	case uint8:
		return v, true
	case uint16:
		if v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case uint32:
		if v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case uint64:
		if v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case int:
		if v < 0 || v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case int8:
		if v < 0 {
			return 0, false
		}
		return byte(v), true
	case int16:
		if v < 0 || v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case int32:
		if v < 0 || v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case int64:
		if v < 0 || v > math.MaxUint8 {
			return 0, false
		}
		return byte(v), true
	case float64:
		if v < 0 || v > math.MaxUint8 || v != math.Trunc(v) {
			return 0, false
		}
		return byte(v), true
	case string:
		return parseByteString(v)
	default:
		return 0, false
	}
}

func parseByteString(value string) (byte, bool) {
	s := strings.TrimSpace(value)
	if s == "" {
		return 0, false
	}
	if strings.HasPrefix(strings.ToLower(s), "0x") {
		s = s[2:]
		if len(s) == 0 {
			return 0, false
		}
		if n, err := strconv.ParseUint(s, 16, 8); err == nil {
			return byte(n), true
		}
		return 0, false
	}
	if n, err := strconv.ParseUint(s, 10, 8); err == nil {
		return byte(n), true
	}
	if n, err := strconv.ParseUint(s, 16, 8); err == nil {
		return byte(n), true
	}
	return 0, false
}
