package main

import (
	"context"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	flowclient "flowscan-clone/internal/flow"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/onflow/flow-go-sdk"
)

type row struct {
	Address string
	Name    string
	Height  uint64
}

func hexToBytes(s string) []byte {
	s = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(s), "0x"))
	if s == "" {
		return nil
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}

func main() {
	var (
		limit  = flag.Int("limit", 0, "max rows to backfill (0 = no limit)")
		offset = flag.Int("offset", 0, "offset for scanning rows")
	)
	flag.Parse()

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_PUBLIC_URL"))
	if dbURL == "" {
		dbURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if dbURL == "" {
		log.Fatal("missing DATABASE_PUBLIC_URL or DATABASE_URL")
	}

	flowURL := strings.TrimSpace(os.Getenv("FLOW_ACCESS_NODES"))
	if flowURL == "" {
		flowURL = strings.TrimSpace(os.Getenv("FLOW_URL"))
	}
	if flowURL == "" {
		flowURL = "access-001.mainnet28.nodes.onflow.org:9000"
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	client, err := flowclient.NewClientFromEnv("FLOW_ACCESS_NODES", flowURL)
	if err != nil {
		log.Fatalf("flow: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	sql := `
		SELECT
			encode(address, 'hex') AS address,
			name,
			COALESCE(last_updated_height, 0)::bigint AS h
		FROM app.smart_contracts
		WHERE COALESCE(code, '') = ''
		ORDER BY COALESCE(last_updated_height, 0) DESC, address ASC, name ASC
		OFFSET $1
	`
	args := []interface{}{*offset}
	if *limit > 0 {
		sql += " LIMIT $2"
		args = append(args, *limit)
	}

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		log.Fatalf("query: %v", err)
	}
	defer rows.Close()

	var targets []row
	for rows.Next() {
		var r row
		var h int64
		if err := rows.Scan(&r.Address, &r.Name, &h); err != nil {
			log.Fatalf("scan: %v", err)
		}
		if h < 0 {
			h = 0
		}
		r.Height = uint64(h)
		if r.Address != "" && r.Name != "" && r.Height > 0 {
			targets = append(targets, r)
		}
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("rows: %v", err)
	}
	if len(targets) == 0 {
		log.Println("no rows to backfill")
		return
	}

	log.Printf("backfilling %d contracts (offset=%d limit=%d)", len(targets), *offset, *limit)

	updated := 0
	for i, t := range targets {
		acc, err := client.GetAccountAtBlockHeight(ctx, flow.HexToAddress(t.Address), t.Height)
		if err != nil || acc == nil {
			continue
		}
		codeBytes := acc.Contracts[t.Name]
		if len(codeBytes) == 0 {
			continue
		}
		code := string(codeBytes)
		if _, err := pool.Exec(ctx, `
			UPDATE app.smart_contracts
			SET code = $1, updated_at = NOW()
			WHERE address = $2 AND name = $3 AND COALESCE(code,'') = ''`,
			code, hexToBytes(t.Address), t.Name,
		); err != nil {
			log.Printf("update failed addr=%s name=%s: %v", t.Address, t.Name, err)
			continue
		}
		updated++
		if (i+1)%50 == 0 {
			log.Printf("progress %d/%d updated=%d", i+1, len(targets), updated)
		}
	}

	fmt.Printf("done updated=%d\n", updated)
}
