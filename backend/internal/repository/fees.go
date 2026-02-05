package repository

import (
	"context"
	"encoding/json"
	"strconv"
)

func (r *Repository) GetTransactionFeesByIDs(ctx context.Context, txIDs []string) (map[string]float64, error) {
	fees := make(map[string]float64)
	if len(txIDs) == 0 {
		return fees, nil
	}

	rows, err := r.db.Query(ctx, `
		SELECT transaction_id, payload
		FROM raw.events
		WHERE transaction_id = ANY($1)
		  AND (
			event_name ILIKE '%TransactionFee%'
			OR event_name ILIKE '%TransactionFees%'
			OR type ILIKE '%TransactionFee%'
			OR type ILIKE '%TransactionFees%'
		  )`,
		txIDs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var payload []byte
		if err := rows.Scan(&id, &payload); err != nil {
			return nil, err
		}
		if amount, ok := parseFeeAmount(payload); ok {
			fees[id] += amount
		}
	}
	return fees, nil
}

func parseFeeAmount(payload []byte) (float64, bool) {
	var obj interface{}
	if err := json.Unmarshal(payload, &obj); err != nil {
		return 0, false
	}
	raw, ok := extractAmount(obj)
	if !ok || raw == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

func extractAmount(v interface{}) (string, bool) {
	switch vv := v.(type) {
	case map[string]interface{}:
		if val, ok := vv["amount"]; ok {
			if s, ok := cadenceValueToString(val); ok {
				return s, true
			}
		}
		if val, ok := vv["fee"]; ok {
			if s, ok := cadenceValueToString(val); ok {
				return s, true
			}
		}
		if val, ok := vv["value"]; ok {
			if s, ok := extractAmount(val); ok {
				return s, true
			}
		}
		if fields, ok := vv["fields"].([]interface{}); ok {
			for _, field := range fields {
				fm, ok := field.(map[string]interface{})
				if !ok {
					continue
				}
				name, _ := fm["name"].(string)
				switch name {
				case "amount", "fee", "fees":
					if s, ok := cadenceValueToString(fm["value"]); ok {
						return s, true
					}
				}
			}
		}
	case []interface{}:
		for _, item := range vv {
			if s, ok := extractAmount(item); ok {
				return s, true
			}
		}
	}
	return "", false
}

func cadenceValueToString(v interface{}) (string, bool) {
	switch vv := v.(type) {
	case string:
		return vv, true
	case float64:
		return strconv.FormatFloat(vv, 'f', -1, 64), true
	case map[string]interface{}:
		if val, ok := vv["value"]; ok {
			return cadenceValueToString(val)
		}
	}
	return "", false
}
