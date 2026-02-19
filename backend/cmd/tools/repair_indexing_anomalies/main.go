package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/ingester"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/jackc/pgx/v5/pgxpool"
)

type repairTarget struct {
	WorkerName  string
	BlockHeight uint64
	ErrorIDs    []int64
}

func main() {
	dbURL := strings.TrimSpace(os.Getenv("DB_URL"))
	if dbURL == "" {
		log.Fatal("DB_URL is required")
	}

	fallbackNode := strings.TrimSpace(os.Getenv("FLOW_ACCESS_NODE"))
	if fallbackNode == "" {
		fallbackNode = "access.mainnet.nodes.onflow.org:9000"
	}

	limit := getEnvInt("REPAIR_LIMIT", 100)
	timeoutSec := getEnvInt("REPAIR_TIMEOUT_SEC", 120)
	if timeoutSec < 10 {
		timeoutSec = 10
	}

	repo, err := repository.NewRepository(dbURL)
	if err != nil {
		log.Fatalf("failed to init repository: %v", err)
	}
	defer repo.Close()

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("failed to parse DB_URL: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		log.Fatalf("failed to connect DB: %v", err)
	}
	defer pool.Close()

	client, err := flow.NewClientFromEnv("FLOW_HISTORIC_ACCESS_NODES", fallbackNode)
	if err != nil {
		log.Fatalf("failed to init flow client: %v", err)
	}
	defer client.Close()

	worker := ingester.NewWorker(client)

	ctx := context.Background()
	targets, err := loadTargets(ctx, pool, limit)
	if err != nil {
		log.Fatalf("failed to load repair targets: %v", err)
	}
	if len(targets) == 0 {
		log.Println("no unresolved anomaly targets found")
		return
	}

	log.Printf("loaded %d repair targets", len(targets))
	success := 0
	stillEmpty := 0
	failed := 0

	for i, t := range targets {
		runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
		res := worker.FetchBlockData(runCtx, t.BlockHeight)
		cancel()

		if res.Error != nil {
			failed++
			log.Printf("[%d/%d] %s height=%d fetch failed: %v", i+1, len(targets), t.WorkerName, t.BlockHeight, res.Error)
			_ = repo.LogIndexingError(ctx, "repair_"+t.WorkerName, t.BlockHeight, "", "repair_fetch_failed", res.Error.Error(), nil)
			continue
		}
		if res.Block == nil {
			failed++
			log.Printf("[%d/%d] %s height=%d fetch returned nil block", i+1, len(targets), t.WorkerName, t.BlockHeight)
			_ = repo.LogIndexingError(ctx, "repair_"+t.WorkerName, t.BlockHeight, "", "repair_nil_block", "repair fetch returned nil block", nil)
			continue
		}

		serviceName := "repair_" + t.WorkerName
		if err := repo.SaveBatch(ctx, []*models.Block{res.Block}, res.Transactions, res.Events, serviceName, t.BlockHeight); err != nil {
			failed++
			log.Printf("[%d/%d] %s height=%d save failed: %v", i+1, len(targets), t.WorkerName, t.BlockHeight, err)
			_ = repo.LogIndexingError(ctx, serviceName, t.BlockHeight, "", "repair_save_failed", err.Error(), nil)
			continue
		}

		if res.Block.CollectionCount > 0 && len(res.Transactions) == 0 {
			stillEmpty++
			log.Printf("[%d/%d] %s height=%d still empty after repair (collection_count=%d tx=0)", i+1, len(targets), t.WorkerName, t.BlockHeight, res.Block.CollectionCount)
			_ = repo.LogIndexingError(ctx, serviceName, t.BlockHeight, "", "repair_still_empty", fmt.Sprintf("collection_count=%d tx_count=0", res.Block.CollectionCount), nil)
			continue
		}

		if err := markResolved(ctx, pool, t.ErrorIDs); err != nil {
			failed++
			log.Printf("[%d/%d] %s height=%d saved but resolve update failed: %v", i+1, len(targets), t.WorkerName, t.BlockHeight, err)
			continue
		}
		success++
		log.Printf("[%d/%d] %s height=%d repaired (tx=%d events=%d)", i+1, len(targets), t.WorkerName, t.BlockHeight, len(res.Transactions), len(res.Events))
	}

	log.Printf("repair done: total=%d success=%d still_empty=%d failed=%d", len(targets), success, stillEmpty, failed)
}

func loadTargets(ctx context.Context, pool *pgxpool.Pool, limit int) ([]repairTarget, error) {
	rows, err := pool.Query(ctx, `
		WITH todo AS (
			SELECT
				worker_name,
				block_height,
				array_agg(id ORDER BY id) AS error_ids,
				min(created_at) AS first_seen
			FROM raw.indexing_errors
			WHERE resolved = FALSE
			  AND block_height IS NOT NULL
			  AND worker_name LIKE 'history_s%'
			  AND error_hash IN (
				'empty_block_with_collections',
				'empty_tx_range',
				'block_tx_count_mismatch'
			  )
			GROUP BY worker_name, block_height
		)
		SELECT worker_name, block_height, error_ids
		FROM todo
		ORDER BY first_seen
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []repairTarget
	for rows.Next() {
		var t repairTarget
		if err := rows.Scan(&t.WorkerName, &t.BlockHeight, &t.ErrorIDs); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func markResolved(ctx context.Context, pool *pgxpool.Pool, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := pool.Exec(ctx, `
		UPDATE raw.indexing_errors
		SET resolved = TRUE
		WHERE id = ANY($1::bigint[])
	`, ids)
	return err
}

func getEnvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
