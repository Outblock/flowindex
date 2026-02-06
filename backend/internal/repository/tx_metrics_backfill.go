package repository

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type TxMetricsBackfillConfig struct {
	StartHeight int64
	EndHeight   int64
	BatchSize   int64
	Sleep       time.Duration
}

func (r *Repository) BackfillTxMetrics(ctx context.Context, cfg TxMetricsBackfillConfig) error {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 2000
	}
	if cfg.EndHeight == 0 {
		if err := r.db.QueryRow(ctx, "SELECT COALESCE(MAX(height), 0) FROM raw.block_lookup").Scan(&cfg.EndHeight); err != nil {
			return err
		}
	}
	if cfg.StartHeight == 0 {
		if err := r.db.QueryRow(ctx, "SELECT COALESCE(MIN(height), 0) FROM raw.block_lookup").Scan(&cfg.StartHeight); err != nil {
			return err
		}
	}

	log.Printf("[backfill_tx_metrics] start=%d end=%d batch=%d sleep=%s", cfg.StartHeight, cfg.EndHeight, cfg.BatchSize, cfg.Sleep)

	for height := cfg.StartHeight; height <= cfg.EndHeight; height += cfg.BatchSize {
		to := height + cfg.BatchSize - 1
		if to > cfg.EndHeight {
			to = cfg.EndHeight
		}
		metrics, err := r.loadTxMetrics(ctx, height, to)
		if err != nil {
			return err
		}
		if len(metrics) > 0 {
			if err := r.applyTxMetrics(ctx, metrics); err != nil {
				return err
			}
		}
		log.Printf("[backfill_tx_metrics] range %d-%d updated=%d", height, to, len(metrics))
		if cfg.Sleep > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(cfg.Sleep):
			}
		}
	}
	log.Printf("[backfill_tx_metrics] done")
	return nil
}

func (r *Repository) BackfillTxMetricsRange(ctx context.Context, from, to int64) error {
	if from <= 0 || to <= 0 || from > to {
		return nil
	}
	metrics, err := r.loadTxMetrics(ctx, from, to)
	if err != nil {
		return err
	}
	if len(metrics) == 0 {
		return nil
	}
	return r.applyTxMetrics(ctx, metrics)
}

type txMetricKey struct {
	Height int64
	ID     string
}

type txMetric struct {
	Count   int
	GasUsed uint64
	Fee     float64
}

func (r *Repository) loadTxMetrics(ctx context.Context, from, to int64) (map[txMetricKey]txMetric, error) {
	rows, err := r.db.Query(ctx, `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id, type, payload
		FROM raw.events
		WHERE block_height BETWEEN $1 AND $2
		ORDER BY block_height, transaction_id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metrics := make(map[txMetricKey]txMetric)
	for rows.Next() {
		var height int64
		var txID, typ string
		var payload []byte
		if err := rows.Scan(&height, &txID, &typ, &payload); err != nil {
			return nil, err
		}
		key := txMetricKey{Height: height, ID: txID}
		m := metrics[key]
		m.Count++
		if isFeeEventType(typ) {
			if gas := parseGasUsed(payload); gas > 0 {
				m.GasUsed = gas
			}
			if fee, ok := parseFeeAmount(payload); ok {
				m.Fee += fee
			}
		}
		metrics[key] = m
	}
	return metrics, rows.Err()
}

func (r *Repository) applyTxMetrics(ctx context.Context, metrics map[txMetricKey]txMetric) error {
	if _, err := r.db.Exec(ctx, "CREATE TEMP TABLE IF NOT EXISTS tmp_tx_metrics (block_height BIGINT, transaction_id BYTEA, event_count INT, gas_used BIGINT, fee NUMERIC)"); err != nil {
		return err
	}
	if _, err := r.db.Exec(ctx, "TRUNCATE tmp_tx_metrics"); err != nil {
		return err
	}

	rows := make([][]interface{}, 0, len(metrics))
	for k, m := range metrics {
		rows = append(rows, []interface{}{k.Height, hexToBytes(k.ID), m.Count, int64(m.GasUsed), m.Fee})
	}

	if _, err := r.db.CopyFrom(ctx, pgx.Identifier{"tmp_tx_metrics"}, []string{"block_height", "transaction_id", "event_count", "gas_used", "fee"}, pgx.CopyFromRows(rows)); err != nil {
		return err
	}

	_, err := r.db.Exec(ctx, `
		INSERT INTO app.tx_metrics (
			block_height, transaction_id, event_count, gas_used, fee, updated_at
		)
		SELECT block_height, transaction_id, event_count, gas_used, fee, NOW()
		FROM tmp_tx_metrics
		ON CONFLICT (block_height, transaction_id) DO UPDATE SET
			event_count = EXCLUDED.event_count,
			gas_used = EXCLUDED.gas_used,
			fee = EXCLUDED.fee,
			updated_at = NOW()`)
	return err
}

func isFeeEventType(typ string) bool {
	typ = strings.ToLower(typ)
	return strings.Contains(typ, "transactionfee")
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

func parseGasUsed(payload []byte) uint64 {
	var obj interface{}
	if err := json.Unmarshal(payload, &obj); err != nil {
		return 0
	}
	if v, ok := findNumericField(obj, map[string]bool{
		"computationused":   true,
		"gasused":           true,
		"computation_usage": true,
		"gas_usage":         true,
	}); ok {
		if v < 0 {
			return 0
		}
		return uint64(v)
	}
	return 0
}

func findNumericField(v interface{}, keys map[string]bool) (float64, bool) {
	switch vv := v.(type) {
	case map[string]interface{}:
		for k, val := range vv {
			if keys[strings.ToLower(k)] {
				if f, ok := toFloat(val); ok {
					return f, true
				}
			}
		}
		if fields, ok := vv["fields"].([]interface{}); ok {
			for _, field := range fields {
				fm, ok := field.(map[string]interface{})
				if !ok {
					continue
				}
				name, _ := fm["name"].(string)
				if keys[strings.ToLower(name)] {
					if f, ok := toFloat(fm["value"]); ok {
						return f, true
					}
				}
			}
		}
		for _, val := range vv {
			if f, ok := findNumericField(val, keys); ok {
				return f, true
			}
		}
	case []interface{}:
		for _, item := range vv {
			if f, ok := findNumericField(item, keys); ok {
				return f, true
			}
		}
	}
	return 0, false
}

func toFloat(v interface{}) (float64, bool) {
	switch vv := v.(type) {
	case float64:
		return vv, true
	case string:
		f, err := strconv.ParseFloat(vv, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	case map[string]interface{}:
		if val, ok := vv["value"]; ok {
			return toFloat(val)
		}
	}
	return 0, false
}
