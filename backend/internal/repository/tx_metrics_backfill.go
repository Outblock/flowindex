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

	// Defensive clamp: operators sometimes set TX_METRICS_BACKFILL_* to heights that
	// haven't been indexed yet. Scanning empty ranges wastes DB I/O and floods logs.
	{
		var dbMin, dbMax int64
		if err := r.db.QueryRow(ctx, "SELECT COALESCE(MIN(height), 0), COALESCE(MAX(height), 0) FROM raw.block_lookup").Scan(&dbMin, &dbMax); err == nil && dbMax > 0 {
			if cfg.StartHeight < dbMin {
				cfg.StartHeight = dbMin
			}
			if cfg.EndHeight > dbMax {
				cfg.EndHeight = dbMax
			}
		}
	}
	if cfg.StartHeight <= 0 || cfg.EndHeight <= 0 || cfg.StartHeight > cfg.EndHeight {
		log.Printf("[backfill_tx_metrics] Skip: invalid or empty indexed range start=%d end=%d", cfg.StartHeight, cfg.EndHeight)
		return nil
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
	Count           int
	GasUsed         uint64
	FeeAmount       float64
	InclusionEffort float64
	ExecutionEffort float64
}

func (r *Repository) loadTxMetrics(ctx context.Context, from, to int64) (map[txMetricKey]txMetric, error) {
	metrics := make(map[txMetricKey]txMetric)

	// Step 1: event counts per transaction (lightweight — no payload transfer).
	countRows, err := r.db.Query(ctx, `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id, COUNT(*) AS cnt
		FROM raw.events
		WHERE block_height BETWEEN $1 AND $2
		GROUP BY block_height, transaction_id`, from, to)
	if err != nil {
		return nil, err
	}
	defer countRows.Close()

	for countRows.Next() {
		var height int64
		var txID string
		var cnt int
		if err := countRows.Scan(&height, &txID, &cnt); err != nil {
			return nil, err
		}
		metrics[txMetricKey{Height: height, ID: txID}] = txMetric{Count: cnt}
	}
	if err := countRows.Err(); err != nil {
		return nil, err
	}

	// Step 2: fee data — only fetch payload for fee events (~14% of rows, ~5% of payload bytes).
	feeRows, err := r.db.Query(ctx, `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id, payload
		FROM raw.events
		WHERE block_height BETWEEN $1 AND $2
		  AND LOWER(type) LIKE '%flowfees.feesdeducted%'`, from, to)
	if err != nil {
		return nil, err
	}
	defer feeRows.Close()

	for feeRows.Next() {
		var height int64
		var txID string
		var payload []byte
		if err := feeRows.Scan(&height, &txID, &payload); err != nil {
			return nil, err
		}
		key := txMetricKey{Height: height, ID: txID}
		m := metrics[key]
		var obj interface{}
		if err := json.Unmarshal(payload, &obj); err == nil {
			if fee, ok := findNumericField(obj, map[string]bool{"amount": true}); ok {
				m.FeeAmount += fee
			}
			if inc, ok := findNumericField(obj, map[string]bool{"inclusioneffort": true}); ok {
				m.InclusionEffort = inc
			}
			if exec, ok := findNumericField(obj, map[string]bool{"executioneffort": true}); ok {
				m.ExecutionEffort = exec
				if exec > 0 {
					m.GasUsed = executionEffortToGas(exec)
				}
			}
		}
		if m.GasUsed == 0 {
			if gas := parseGasUsed(payload); gas > 0 {
				m.GasUsed = gas
			}
		}
		metrics[key] = m
	}
	return metrics, feeRows.Err()
}

func (r *Repository) applyTxMetrics(ctx context.Context, metrics map[txMetricKey]txMetric) error {
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	// Temp tables are session-scoped in Postgres. Using a single acquired connection
	// (and a transaction) avoids flaky failures when the pool picks a different conn
	// between CREATE TEMP TABLE / COPY / INSERT.
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		CREATE TEMP TABLE tmp_tx_metrics (
			block_height BIGINT,
			transaction_id BYTEA,
			event_count INT,
			gas_used BIGINT,
			fee NUMERIC,
			fee_amount NUMERIC,
			inclusion_effort NUMERIC,
			execution_effort NUMERIC
		) ON COMMIT DROP`); err != nil {
		return err
	}

	rows := make([][]interface{}, 0, len(metrics))
	for k, m := range metrics {
		rows = append(rows, []interface{}{k.Height, hexToBytes(k.ID), m.Count, int64(m.GasUsed), m.FeeAmount, m.FeeAmount, m.InclusionEffort, m.ExecutionEffort})
	}

	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_tx_metrics"}, []string{"block_height", "transaction_id", "event_count", "gas_used", "fee", "fee_amount", "inclusion_effort", "execution_effort"}, pgx.CopyFromRows(rows)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO app.tx_metrics (
			block_height, transaction_id, event_count, gas_used, fee, fee_amount, inclusion_effort, execution_effort, updated_at
		)
		SELECT block_height, transaction_id, event_count, gas_used, fee, fee_amount, inclusion_effort, execution_effort, NOW()
		FROM tmp_tx_metrics
		ON CONFLICT (block_height, transaction_id) DO UPDATE SET
			event_count = EXCLUDED.event_count,
			gas_used = EXCLUDED.gas_used,
			fee = EXCLUDED.fee,
			fee_amount = EXCLUDED.fee_amount,
			inclusion_effort = EXCLUDED.inclusion_effort,
			execution_effort = EXCLUDED.execution_effort,
			updated_at = NOW()`); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func isFeeEventType(typ string) bool {
	typ = strings.ToLower(typ)
	return strings.Contains(typ, "flowfees.feesdeducted")
}

func executionEffortToGas(executionEffort float64) uint64 {
	if executionEffort <= 0 {
		return 0
	}
	// ExecutionEffort is in FLOW (UFix64). Convert to "gas" units used by UI (1e8).
	gas := executionEffort * 1e8
	if gas < 0 {
		return 0
	}
	return uint64(gas + 0.5)
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
