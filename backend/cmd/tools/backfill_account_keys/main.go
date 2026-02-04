package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type accountKeyOp struct {
	Address          string
	KeyIndex         int
	PublicKey        *string
	SigningAlgorithm *string
	HashingAlgorithm *string
	Weight           *int
	Revoked          bool
	AddedAtHeight    int64
	RevokedAtHeight  *int64
	LastUpdated      int64
}

func main() {
	var (
		startHeight int64
		endHeight   int64
		batchSize   int
		dryRun      bool
	)

	flag.Int64Var(&startHeight, "start", getEnvInt64("BACKFILL_START_HEIGHT", 0), "start block height (inclusive), default 0")
	flag.Int64Var(&endHeight, "end", getEnvInt64("BACKFILL_END_HEIGHT", 0), "end block height (inclusive), default auto-detect")
	flag.IntVar(&batchSize, "batch", getEnvInt("BACKFILL_BATCH_EVENTS", 20000), "events per batch")
	flag.BoolVar(&dryRun, "dry-run", getEnvBool("BACKFILL_DRY_RUN", false), "dry run (no writes)")
	flag.Parse()

	if batchSize <= 0 {
		batchSize = 20000
	}

	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		log.Fatal("DB_URL is required")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer conn.Close(ctx)

	if endHeight == 0 {
		if err := conn.QueryRow(ctx, "SELECT COALESCE(MAX(block_height), 0) FROM raw.events").Scan(&endHeight); err != nil {
			log.Fatalf("detect end height: %v", err)
		}
	}
	if startHeight < 0 {
		startHeight = 0
	}
	if endHeight < startHeight {
		log.Fatalf("invalid range: start=%d end=%d", startHeight, endHeight)
	}

	log.Printf("backfill account_keys start=%d end=%d batch=%d dry_run=%v", startHeight, endHeight, batchSize, dryRun)

	// Use a temp table + bulk copy for speed.
	if !dryRun {
		if _, err := conn.Exec(ctx, `
			CREATE TEMP TABLE IF NOT EXISTS tmp_account_key_ops (
				address VARCHAR(18) NOT NULL,
				key_index INT NOT NULL,
				public_key TEXT,
				signing_algorithm TEXT,
				hashing_algorithm TEXT,
				weight INT,
				revoked BOOLEAN NOT NULL,
				added_at_height BIGINT,
				revoked_at_height BIGINT,
				last_updated_height BIGINT NOT NULL
			);`); err != nil {
			log.Fatalf("create temp table: %v", err)
		}
	}

	var (
		cursorBH  int64 = startHeight - 1
		cursorTx  string
		cursorIdx int = -1
		total         = 0
		totalAdded    = 0
		totalRemoved  = 0
		startedAt     = time.Now()
	)

	for {
		rows, err := conn.Query(ctx, `
			SELECT block_height, transaction_id, event_index, type, payload
			FROM raw.events
			WHERE type IN ('flow.AccountKeyAdded', 'flow.AccountKeyRemoved')
			  AND block_height >= $1 AND block_height <= $2
			  AND (block_height, transaction_id, event_index) > ($3, $4, $5)
			ORDER BY block_height ASC, transaction_id ASC, event_index ASC
			LIMIT $6`,
			startHeight, endHeight,
			cursorBH, cursorTx, cursorIdx,
			batchSize,
		)
		if err != nil {
			log.Fatalf("query events: %v", err)
		}

		ops := make([]accountKeyOp, 0, batchSize)
		batchAdded := 0
		batchRemoved := 0
		lastBH := cursorBH
		lastTx := cursorTx
		lastIdx := cursorIdx

		for rows.Next() {
			var (
				bh     int64
				txID   string
				evIdx  int
				typ    string
				payload []byte
			)
			if err := rows.Scan(&bh, &txID, &evIdx, &typ, &payload); err != nil {
				rows.Close()
				log.Fatalf("scan event: %v", err)
			}

			op, ok := parseAccountKeyEvent(typ, payload, bh)
			if ok {
				ops = append(ops, op)
				if op.Revoked {
					batchRemoved++
				} else {
					batchAdded++
				}
			}

			lastBH, lastTx, lastIdx = bh, txID, evIdx
		}
		rows.Close()

		if len(ops) == 0 {
			break
		}

		cursorBH, cursorTx, cursorIdx = lastBH, lastTx, lastIdx
		total += len(ops)
		totalAdded += batchAdded
		totalRemoved += batchRemoved

		if !dryRun {
			if err := upsertBatch(ctx, conn, ops); err != nil {
				log.Fatalf("upsert batch at cursor %d/%s/%d: %v", cursorBH, cursorTx, cursorIdx, err)
			}
		}

		elapsed := time.Since(startedAt).Truncate(time.Second)
		log.Printf("processed=%d (+%d add, +%d rm) cursor=%d elapsed=%s", total, batchAdded, batchRemoved, cursorBH, elapsed)
	}

	log.Printf("done processed=%d added=%d removed=%d elapsed=%s", total, totalAdded, totalRemoved, time.Since(startedAt).Truncate(time.Second))
}

func upsertBatch(ctx context.Context, conn *pgx.Conn, ops []accountKeyOp) error {
	if _, err := conn.Exec(ctx, "TRUNCATE tmp_account_key_ops"); err != nil {
		return fmt.Errorf("truncate temp: %w", err)
	}

	rows := make([][]interface{}, 0, len(ops))
	for _, op := range ops {
		var revokedAt interface{} = nil
		if op.RevokedAtHeight != nil {
			revokedAt = *op.RevokedAtHeight
		}
		rows = append(rows, []interface{}{
			op.Address,
			op.KeyIndex,
			derefStringPtr(op.PublicKey),
			derefStringPtr(op.SigningAlgorithm),
			derefStringPtr(op.HashingAlgorithm),
			derefIntPtr(op.Weight),
			op.Revoked,
			nullIfZero(op.AddedAtHeight),
			revokedAt,
			op.LastUpdated,
		})
	}

	_, err := conn.CopyFrom(
		ctx,
		pgx.Identifier{"tmp_account_key_ops"},
		[]string{
			"address",
			"key_index",
			"public_key",
			"signing_algorithm",
			"hashing_algorithm",
			"weight",
			"revoked",
			"added_at_height",
			"revoked_at_height",
			"last_updated_height",
		},
		pgx.CopyFromRows(rows),
	)
	if err != nil {
		return fmt.Errorf("copy temp: %w", err)
	}

	// Apply adds (upsert state)
	if _, err := conn.Exec(ctx, `
		INSERT INTO app.account_keys (
			address, key_index, public_key,
			signing_algorithm, hashing_algorithm, weight,
			revoked, added_at_height, revoked_at_height, last_updated_height,
			created_at, updated_at
		)
		SELECT
			address, key_index, public_key,
			signing_algorithm, hashing_algorithm, weight,
			FALSE, added_at_height, NULL, last_updated_height,
			NOW(), NOW()
		FROM tmp_account_key_ops
		WHERE revoked = FALSE
		ON CONFLICT (address, key_index) DO UPDATE SET
			public_key = EXCLUDED.public_key,
			signing_algorithm = EXCLUDED.signing_algorithm,
			hashing_algorithm = EXCLUDED.hashing_algorithm,
			weight = EXCLUDED.weight,
			revoked = EXCLUDED.revoked,
			added_at_height = COALESCE(app.account_keys.added_at_height, EXCLUDED.added_at_height),
			revoked_at_height = NULL,
			last_updated_height = EXCLUDED.last_updated_height,
			updated_at = NOW()
		WHERE EXCLUDED.last_updated_height >= app.account_keys.last_updated_height;`); err != nil {
		return fmt.Errorf("upsert adds: %w", err)
	}

	// Apply removals (update state)
	if _, err := conn.Exec(ctx, `
		UPDATE app.account_keys k
		SET revoked = TRUE,
			revoked_at_height = t.revoked_at_height,
			last_updated_height = t.last_updated_height,
			updated_at = NOW()
		FROM tmp_account_key_ops t
		WHERE t.revoked = TRUE
		  AND k.address = t.address
		  AND k.key_index = t.key_index
		  AND t.last_updated_height >= k.last_updated_height;`); err != nil {
		return fmt.Errorf("apply removals: %w", err)
	}

	return nil
}

func parseAccountKeyEvent(typ string, payload []byte, height int64) (accountKeyOp, bool) {
	var obj map[string]interface{}
	if err := json.Unmarshal(payload, &obj); err != nil {
		return accountKeyOp{}, false
	}

	addr, _ := obj["address"].(string)
	address := normalizeAddress(addr)
	if address == "" {
		return accountKeyOp{}, false
	}

	switch typ {
	case "flow.AccountKeyAdded":
		keyIdx := parseInt(obj["keyIndex"])
		if keyIdx < 0 {
			return accountKeyOp{}, false
		}
		publicKey := normalizePublicKey(extractPublicKey(obj["publicKey"]))
		if publicKey == "" {
			if key, ok := obj["key"].(map[string]interface{}); ok {
				publicKey = normalizePublicKey(extractPublicKey(key["publicKey"]))
			}
		}
		if publicKey == "" {
			return accountKeyOp{}, false
		}

		var signAlgo *string
		if sa, ok := obj["signingAlgorithm"].(string); ok && sa != "" {
			signAlgo = &sa
		} else if pkObj, ok := obj["publicKey"].(map[string]interface{}); ok {
			if sa, ok := pkObj["signatureAlgorithm"].(string); ok && sa != "" {
				signAlgo = &sa
			}
		}

		var hashAlgo *string
		if ha, ok := obj["hashingAlgorithm"].(string); ok && ha != "" {
			hashAlgo = &ha
		} else if ha, ok := obj["hashAlgorithm"].(string); ok && ha != "" {
			hashAlgo = &ha
		}

		var weight *int
		if w := parseWeightToInt(obj["weight"]); w != nil {
			weight = w
		}

		return accountKeyOp{
			Address:          address,
			KeyIndex:         keyIdx,
			PublicKey:        &publicKey,
			SigningAlgorithm: signAlgo,
			HashingAlgorithm: hashAlgo,
			Weight:           weight,
			Revoked:          false,
			AddedAtHeight:    height,
			LastUpdated:      height,
		}, true

	case "flow.AccountKeyRemoved":
		// In our stored JSON, this is usually key index under "publicKey".
		keyIdx := parseInt(obj["keyIndex"])
		if keyIdx < 0 {
			keyIdx = parseInt(obj["publicKey"])
		}
		if keyIdx < 0 {
			return accountKeyOp{}, false
		}
		h := height
		return accountKeyOp{
			Address:         address,
			KeyIndex:        keyIdx,
			Revoked:         true,
			RevokedAtHeight: &h,
			LastUpdated:     height,
		}, true
	default:
		return accountKeyOp{}, false
	}
}

func extractPublicKey(v interface{}) string {
	switch vv := v.(type) {
	case string:
		return vv
	case map[string]interface{}:
		raw, ok := vv["publicKey"]
		if !ok {
			return ""
		}

		// Newer payloads encode bytes as array of strings/numbers.
		var bytes []byte
		switch arr := raw.(type) {
		case []interface{}:
			bytes = make([]byte, 0, len(arr))
			for _, it := range arr {
				switch x := it.(type) {
				case string:
					if n, err := strconv.Atoi(x); err == nil && n >= 0 && n <= 255 {
						bytes = append(bytes, byte(n))
					}
				case float64:
					if x >= 0 && x <= 255 {
						bytes = append(bytes, byte(x))
					}
				}
			}
		case []string:
			bytes = make([]byte, 0, len(arr))
			for _, s := range arr {
				if n, err := strconv.Atoi(s); err == nil && n >= 0 && n <= 255 {
					bytes = append(bytes, byte(n))
				}
			}
		}

		if len(bytes) == 0 {
			return ""
		}
		return fmt.Sprintf("%x", bytes)
	default:
		return ""
	}
}

func normalizeAddress(addr string) string {
	normalized := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(addr)), "0x")
	if normalized == "" {
		return ""
	}
	return normalized
}

func normalizePublicKey(pk string) string {
	pk = strings.TrimSpace(pk)
	if pk == "" {
		return ""
	}
	pk = strings.TrimPrefix(strings.ToLower(pk), "0x")
	return pk
}

func parseInt(v interface{}) int {
	switch vv := v.(type) {
	case float64:
		return int(vv)
	case int:
		return vv
	case int64:
		return int(vv)
	case string:
		n, err := strconv.Atoi(vv)
		if err != nil {
			return -1
		}
		return n
	default:
		return -1
	}
}

func parseWeightToInt(v interface{}) *int {
	switch vv := v.(type) {
	case float64:
		i := int(vv)
		return &i
	case string:
		if vv == "" {
			return nil
		}
		// Common format: "1000.00000000"
		if strings.Contains(vv, ".") {
			f, err := strconv.ParseFloat(vv, 64)
			if err != nil {
				return nil
			}
			i := int(f)
			return &i
		}
		n, err := strconv.Atoi(vv)
		if err != nil {
			return nil
		}
		return &n
	default:
		return nil
	}
}

func nullIfZero(v int64) interface{} {
	if v == 0 {
		return nil
	}
	return v
}

func derefStringPtr(p *string) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

func derefIntPtr(p *int) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

func getEnvInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return defaultVal
}

func getEnvInt64(key string, defaultVal int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	if v := os.Getenv(key); v != "" {
		switch strings.ToLower(v) {
		case "1", "true", "yes", "y":
			return true
		case "0", "false", "no", "n":
			return false
		}
	}
	return defaultVal
}
