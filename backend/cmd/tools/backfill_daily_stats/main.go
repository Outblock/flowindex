package main

import (
	"context"
	"flag"
	"log"
	"os"
	"time"

	"flowscan-clone/internal/repository"
)

func main() {
	var (
		fromHeight uint64
		toHeight   uint64
		fullScan   bool
	)

	flag.Uint64Var(&fromHeight, "from-height", 0, "start block height (inclusive); with --to-height runs range refresh")
	flag.Uint64Var(&toHeight, "to-height", 0, "end block height (exclusive); with --from-height runs range refresh")
	flag.BoolVar(&fullScan, "full-scan", false, "force full refresh regardless of height flags")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = os.Getenv("DB_URL")
	}
	if databaseURL == "" {
		log.Fatal("DATABASE_URL or DB_URL is required")
	}

	repo, err := repository.NewRepository(databaseURL)
	if err != nil {
		log.Fatalf("failed to connect repository: %v", err)
	}
	defer repo.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started := time.Now()

	switch {
	case fullScan:
		log.Printf("[backfill_daily_stats] running full refresh")
		if err := repo.RefreshDailyStats(ctx, true); err != nil {
			log.Fatalf("[backfill_daily_stats] full refresh failed: %v", err)
		}
	case fromHeight > 0 || toHeight > 0:
		if toHeight <= fromHeight {
			log.Fatalf("invalid range: from-height=%d to-height=%d (to-height must be > from-height)", fromHeight, toHeight)
		}
		log.Printf("[backfill_daily_stats] refreshing range [%d, %d)", fromHeight, toHeight)
		if err := repo.RefreshDailyStatsRange(ctx, fromHeight, toHeight); err != nil {
			log.Fatalf("[backfill_daily_stats] range refresh failed: %v", err)
		}
	default:
		log.Printf("[backfill_daily_stats] no range provided, defaulting to full refresh")
		if err := repo.RefreshDailyStats(ctx, true); err != nil {
			log.Fatalf("[backfill_daily_stats] full refresh failed: %v", err)
		}
	}

	log.Printf("[backfill_daily_stats] done in %s", time.Since(started).Truncate(time.Second))
}
