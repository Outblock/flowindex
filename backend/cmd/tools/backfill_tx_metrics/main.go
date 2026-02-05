package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type txKey struct {
	Height int64
	ID     string
}

type txMetric struct {
	Count   int
	GasUsed uint64
	Fee     float64
}

func main() {
	var (
		startHeight int64
		endHeight   int64
		batchSize   int64
		dryRun      bool
	)

	flag.Int64Var(&startHeight, "start", getEnvInt64("BACKFILL_START_HEIGHT", 0), "start block height (inclusive)")
	flag.Int64Var(&endHeight, "end", getEnvInt64("BACKFILL_END_HEIGHT", 0), "end block height (inclusive), default auto-detect")
	flag.Int64Var(&batchSize, "batch", getEnvInt64("BACKFILL_BATCH_HEIGHTS", 2000), "heights per batch")
	flag.BoolVar(&dryRun, "dry_run", getEnvBool("BACKFILL_DRY_RUN", false), "dry run")
	flag.Parse()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	if endHeight == 0 {
		if err := conn.QueryRow(ctx, "SELECT COALESCE(MAX(height), 0) FROM raw.block_lookup").Scan(&endHeight); err != nil {
			log.Fatalf("max height: %v", err)
		}
	}
	if batchSize <= 0 {
		batchSize = 2000
	}

	log.Printf("backfill tx metrics start=%d end=%d batch=%d dry_run=%v", startHeight, endHeight, batchSize, dryRun)
	started := time.Now()

	for height := startHeight; height <= endHeight; height += batchSize {
		to := height + batchSize - 1
		if to > endHeight {
			to = endHeight
		}

		metrics, err := loadMetrics(ctx, conn, height, to)
		if err != nil {
			log.Fatalf("load metrics %d-%d: %v", height, to, err)
		}
		if len(metrics) == 0 {
			continue
		}
		if dryRun {
			log.Printf("range %d-%d metrics=%d (dry)", height, to, len(metrics))
			continue
		}
		if err := applyMetrics(ctx, conn, metrics); err != nil {
			log.Fatalf("apply metrics %d-%d: %v", height, to, err)
		}
		log.Printf("range %d-%d metrics=%d elapsed=%s", height, to, len(metrics), time.Since(started).Truncate(time.Second))
	}

	log.Printf("done elapsed=%s", time.Since(started).Truncate(time.Second))
}

func loadMetrics(ctx context.Context, conn *pgx.Conn, from, to int64) (map[txKey]txMetric, error) {
	rows, err := conn.Query(ctx, `
		SELECT block_height, transaction_id, type, payload
		FROM raw.events
		WHERE block_height BETWEEN $1 AND $2
		ORDER BY block_height, transaction_id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metrics := make(map[txKey]txMetric)
	for rows.Next() {
		var height int64
		var txID, typ string
		var payload []byte
		if err := rows.Scan(&height, &txID, &typ, &payload); err != nil {
			return nil, err
		}
		key := txKey{Height: height, ID: txID}
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

func applyMetrics(ctx context.Context, conn *pgx.Conn, metrics map[txKey]txMetric) error {
	if _, err := conn.Exec(ctx, "CREATE TEMP TABLE IF NOT EXISTS tmp_tx_metrics (block_height BIGINT, transaction_id TEXT, event_count INT, gas_used BIGINT, fee NUMERIC)"); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, "TRUNCATE tmp_tx_metrics"); err != nil {
		return err
	}

	rows := make([][]interface{}, 0, len(metrics))
	for k, m := range metrics {
		rows = append(rows, []interface{}{k.Height, k.ID, m.Count, int64(m.GasUsed), m.Fee})
	}

	if _, err := conn.CopyFrom(ctx, pgx.Identifier{"tmp_tx_metrics"}, []string{"block_height", "transaction_id", "event_count", "gas_used", "fee"}, pgx.CopyFromRows(rows)); err != nil {
		return err
	}

	_, err := conn.Exec(ctx, `
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

func parseGasUsed(payload []byte) uint64 {
	var obj interface{}
	if err := json.Unmarshal(payload, &obj); err != nil {
		return 0
	}
	if v, ok := findNumericField(obj, map[string]bool{
		"computationused":  true,
		"gasused":          true,
		"computation_usage": true,
		"gas_usage":        true,
	}); ok {
		if v < 0 {
			return 0
		}
		return uint64(v)
	}
	return 0
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

func getEnvInt64(key string, def int64) int64 {
	raw := os.Getenv(key)
	if raw == "" {
		return def
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return def
	}
	return v
}

func getEnvBool(key string, def bool) bool {
	raw := strings.ToLower(os.Getenv(key))
	if raw == "" {
		return def
	}
	return raw == "1" || raw == "true" || raw == "yes"
}
