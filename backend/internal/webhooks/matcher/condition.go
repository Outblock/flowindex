package matcher

import (
	"fmt"
	"strconv"
	"strings"
)

// operatorsByLength lists all supported operators ordered longest-first so that
// ParseConditionKey matches the most specific suffix (e.g. "_not_contains" before "_contains").
var operatorsByLength = []string{
	"not_contains",
	"starts_with",
	"contains",
	">=",
	"<=",
	"!=",
	"==",
	"gte",
	"lte",
	"neq",
	"gt",
	"lt",
	"eq",
	">",
	"<",
}

// triggerConditionKeys are keys that belong to trigger configuration rather
// than generic field conditions. EvaluateConditions skips these.
var triggerConditionKeys = map[string]bool{
	"addresses":        true,
	"direction":        true,
	"token_contract":   true,
	"min_amount":       true,
	"collection":       true,
	"token_ids":        true,
	"contract_address": true,
	"event_names":      true,
	"roles":            true,
	"node_id":          true,
	"from":             true,
	"to":               true,
	"min_value":        true,
	"cron":             true,
	"timezone":         true,
	"subtypes":         true,
}

// IsTriggerConditionKey returns true if key is a known trigger config key
// that should not be treated as a generic field condition.
func IsTriggerConditionKey(key string) bool {
	return triggerConditionKeys[key]
}

// ParseConditionKey splits a key like "from_address_==" into field "from_address"
// and operator "==". It tries the longest operator suffix first. Returns ("", "")
// if no known operator suffix is found.
func ParseConditionKey(key string) (field, op string) {
	for _, operator := range operatorsByLength {
		suffix := "_" + operator
		if strings.HasSuffix(key, suffix) {
			return key[:len(key)-len(suffix)], operator
		}
	}
	return "", ""
}

// EvaluateConditions returns true if ALL generic conditions in the map pass
// (AND logic). Trigger-specific keys and keys without a recognised operator
// suffix are silently skipped. A nil or empty map returns true.
func EvaluateConditions(conditions map[string]interface{}, eventData map[string]interface{}) bool {
	for key, expected := range conditions {
		// Skip trigger-specific configuration keys.
		if IsTriggerConditionKey(key) {
			continue
		}

		field, op := ParseConditionKey(key)
		if op == "" {
			// Not a recognised condition key; skip.
			continue
		}

		// Look up actual value in event data.
		actual, ok := eventData[field]
		if !ok {
			return false
		}

		actualStr := toStr(actual)
		expectedStr := toStr(expected)

		if !EvaluateOp(op, actualStr, expectedStr) {
			return false
		}
	}
	return true
}

// EvaluateOp compares actual against expected using the given operator.
// String operations are case-insensitive. Numeric operators attempt float64
// parsing and return false on failure.
func EvaluateOp(op, actual, expected string) bool {
	switch op {
	case "==", "eq":
		return strings.EqualFold(actual, expected)
	case "!=", "neq":
		return !strings.EqualFold(actual, expected)
	case ">", "gt":
		a, b, ok := parseFloats(actual, expected)
		return ok && a > b
	case "<", "lt":
		a, b, ok := parseFloats(actual, expected)
		return ok && a < b
	case ">=", "gte":
		a, b, ok := parseFloats(actual, expected)
		return ok && a >= b
	case "<=", "lte":
		a, b, ok := parseFloats(actual, expected)
		return ok && a <= b
	case "contains":
		return strings.Contains(strings.ToLower(actual), strings.ToLower(expected))
	case "not_contains":
		return !strings.Contains(strings.ToLower(actual), strings.ToLower(expected))
	case "starts_with":
		return strings.HasPrefix(strings.ToLower(actual), strings.ToLower(expected))
	default:
		return false
	}
}

// parseFloats attempts to parse both strings as float64.
func parseFloats(a, b string) (float64, float64, bool) {
	fa, err := strconv.ParseFloat(a, 64)
	if err != nil {
		return 0, 0, false
	}
	fb, err := strconv.ParseFloat(b, 64)
	if err != nil {
		return 0, 0, false
	}
	return fa, fb, true
}

// toStr converts an arbitrary value to its string representation.
func toStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}
