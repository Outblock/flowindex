package ingester

import (
	"encoding/hex"
	"encoding/json"
	"math"
	"math/big"
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

func extractEVMPayloadBytes(payload map[string]interface{}) []byte {
	for _, key := range []string{"payload", "transaction", "tx", "raw", "txPayload", "transactionPayload", "rawTransaction"} {
		if v, ok := payload[key]; ok {
			if b := extractEVMBytes(v); len(b) > 0 {
				return b
			}
		}
	}
	return nil
}

func extractEVMHexField(payload map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if v, ok := payload[key]; ok {
			if h := normalizeEVMHashValue(v); h != "" {
				return h
			}
		}
	}
	return ""
}

func extractEVMBigIntString(payload map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if v, ok := payload[key]; ok {
			if s, ok := parseBigIntString(v); ok {
				return s
			}
		}
	}
	return ""
}

func extractEVMUint64(payload map[string]interface{}, keys ...string) uint64 {
	for _, key := range keys {
		if v, ok := payload[key]; ok {
			if val, ok := parseUint64Value(v); ok {
				return val
			}
			if s, ok := parseBigIntString(v); ok {
				if bi, ok := new(big.Int).SetString(s, 10); ok && bi.IsUint64() {
					return bi.Uint64()
				}
			}
		}
	}
	return 0
}

func extractEVMInt(payload map[string]interface{}, keys ...string) int {
	for _, key := range keys {
		if v, ok := payload[key]; ok {
			if val, ok := parseIntValue(v); ok {
				return val
			}
			if s, ok := parseBigIntString(v); ok {
				if bi, ok := new(big.Int).SetString(s, 10); ok && bi.IsInt64() {
					return int(bi.Int64())
				}
			}
		}
	}
	return 0
}

func extractEVMString(payload map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if v, ok := payload[key]; ok {
			if s, ok := parseStringValue(v); ok {
				return s
			}
		}
	}
	return ""
}

func extractEVMLogsJSON(payload map[string]interface{}) string {
	v, ok := payload["logs"]
	if !ok {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	if string(b) == "null" {
		return ""
	}
	return string(b)
}

func extractEVMBytes(value interface{}) []byte {
	switch v := value.(type) {
	case string:
		hexStr := normalizeEVMHex(v)
		if hexStr == "" {
			return nil
		}
		out, err := hex.DecodeString(hexStr)
		if err != nil {
			return nil
		}
		return out
	case []byte:
		if len(v) == 0 {
			return nil
		}
		return v
	case []interface{}:
		if b, ok := bytesFromInterfaceArray(v); ok && len(b) > 0 {
			return b
		}
	}
	return nil
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

func parseBigIntString(value interface{}) (string, bool) {
	switch v := value.(type) {
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return "", false
		}
		lower := strings.ToLower(s)
		if strings.HasPrefix(lower, "0x") {
			s = lower[2:]
			if s == "" {
				return "", false
			}
			if bi, ok := new(big.Int).SetString(s, 16); ok {
				return bi.String(), true
			}
			return "", false
		}
		if bi, ok := new(big.Int).SetString(s, 10); ok {
			return bi.String(), true
		}
		return "", false
	case json.Number:
		return parseBigIntString(v.String())
	case float64:
		if v < 0 || v != math.Trunc(v) {
			return "", false
		}
		return new(big.Int).SetUint64(uint64(v)).String(), true
	case uint64:
		return new(big.Int).SetUint64(v).String(), true
	case uint32:
		return new(big.Int).SetUint64(uint64(v)).String(), true
	case uint16:
		return new(big.Int).SetUint64(uint64(v)).String(), true
	case uint8:
		return new(big.Int).SetUint64(uint64(v)).String(), true
	case int64:
		if v < 0 {
			return "", false
		}
		return new(big.Int).SetInt64(v).String(), true
	case int32:
		if v < 0 {
			return "", false
		}
		return new(big.Int).SetInt64(int64(v)).String(), true
	case int16:
		if v < 0 {
			return "", false
		}
		return new(big.Int).SetInt64(int64(v)).String(), true
	case int8:
		if v < 0 {
			return "", false
		}
		return new(big.Int).SetInt64(int64(v)).String(), true
	case int:
		if v < 0 {
			return "", false
		}
		return new(big.Int).SetInt64(int64(v)).String(), true
	case []byte:
		if len(v) == 0 {
			return "", false
		}
		return new(big.Int).SetBytes(v).String(), true
	case []interface{}:
		if b, ok := bytesFromInterfaceArray(v); ok && len(b) > 0 {
			return new(big.Int).SetBytes(b).String(), true
		}
	}
	return "", false
}

func parseUint64Value(value interface{}) (uint64, bool) {
	switch v := value.(type) {
	case uint64:
		return v, true
	case uint32:
		return uint64(v), true
	case uint16:
		return uint64(v), true
	case uint8:
		return uint64(v), true
	case int:
		if v < 0 {
			return 0, false
		}
		return uint64(v), true
	case int64:
		if v < 0 {
			return 0, false
		}
		return uint64(v), true
	case int32:
		if v < 0 {
			return 0, false
		}
		return uint64(v), true
	case int16:
		if v < 0 {
			return 0, false
		}
		return uint64(v), true
	case int8:
		if v < 0 {
			return 0, false
		}
		return uint64(v), true
	case float64:
		if v < 0 || v != math.Trunc(v) {
			return 0, false
		}
		return uint64(v), true
	case json.Number:
		return parseUint64Value(v.String())
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0, false
		}
		lower := strings.ToLower(s)
		if strings.HasPrefix(lower, "0x") {
			n, err := strconv.ParseUint(lower[2:], 16, 64)
			if err != nil {
				return 0, false
			}
			return n, true
		}
		n, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			return 0, false
		}
		return n, true
	}
	return 0, false
}

func parseIntValue(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		if v < math.MinInt32 || v > math.MaxInt32 {
			return 0, false
		}
		return int(v), true
	case int32:
		return int(v), true
	case int16:
		return int(v), true
	case int8:
		return int(v), true
	case uint64:
		if v > math.MaxInt32 {
			return 0, false
		}
		return int(v), true
	case uint32:
		if v > math.MaxInt32 {
			return 0, false
		}
		return int(v), true
	case uint16:
		return int(v), true
	case uint8:
		return int(v), true
	case float64:
		if v != math.Trunc(v) || v > math.MaxInt32 || v < math.MinInt32 {
			return 0, false
		}
		return int(v), true
	case json.Number:
		return parseIntValue(v.String())
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0, false
		}
		lower := strings.ToLower(s)
		if strings.HasPrefix(lower, "0x") {
			n, err := strconv.ParseInt(lower[2:], 16, 32)
			if err != nil {
				return 0, false
			}
			return int(n), true
		}
		n, err := strconv.ParseInt(s, 10, 32)
		if err != nil {
			return 0, false
		}
		return int(n), true
	}
	return 0, false
}

func parseStringValue(value interface{}) (string, bool) {
	switch v := value.(type) {
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return "", false
		}
		return s, true
	case json.Number:
		return v.String(), true
	}
	return "", false
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
