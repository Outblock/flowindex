package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"flowscan-clone/internal/api"
	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/ingester"
	"flowscan-clone/internal/repository"
)

func main() {
	// 1. Config
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbURL = "postgres://flowscan:secretpassword@localhost:5432/flowscan"
	}

	flowURL := os.Getenv("FLOW_ACCESS_NODE")
	if flowURL == "" {
		flowURL = "access-001.mainnet28.nodes.onflow.org:9000"
	}

	apiPort := os.Getenv("PORT")
	if apiPort == "" {
		apiPort = "8080"
	}

	startBlockStr := os.Getenv("START_BLOCK")
	var startBlock uint64
	if startBlockStr != "" {
		startBlock, _ = strconv.ParseUint(startBlockStr, 10, 64)
	}

	log.Println("Initializing FlowScan Clone Backend...")
	log.Printf("DB: %s", dbURL)
	log.Printf("Flow Node: %s", flowURL)
	log.Printf("API Port: %s", apiPort)

	// 2. Dependencies
	repo, err := repository.NewRepository(dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}
	defer repo.Close()

	// 2a. Auto-Migration
	log.Println("Running Database Migration...")
	if err := repo.Migrate("schema_v2.sql"); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	log.Println("Database Migration Complete.")

	flowClient, err := flow.NewClient(flowURL)
	if err != nil {
		log.Fatalf("Failed to connect to Flow: %v", err)
	}
	defer flowClient.Close()

	// 3. Services
	// Config Parsing Helpers
	getEnvInt := func(key string, defaultVal int) int {
		if valStr := os.Getenv(key); valStr != "" {
			if val, err := strconv.Atoi(valStr); err == nil {
				return val
			}
		}
		return defaultVal
	}
	getEnvUint := func(key string, defaultVal uint64) uint64 {
		if valStr := os.Getenv(key); valStr != "" {
			if val, err := strconv.ParseUint(valStr, 10, 64); err == nil {
				return val
			}
		}
		return defaultVal
	}

	latestWorkers := getEnvInt("LATEST_WORKER_COUNT", 2)
	historyWorkers := getEnvInt("HISTORY_WORKER_COUNT", 5)
	latestBatch := getEnvInt("LATEST_BATCH_SIZE", 1)    // Real-time
	historyBatch := getEnvInt("HISTORY_BATCH_SIZE", 20) // Throughput
	maxReorgDepth := getEnvUint("MAX_REORG_DEPTH", 1000)

	// 3. Services
	// Forward Ingester (Live Data)
	forwardIngester := ingester.NewService(flowClient, repo, ingester.Config{
		ServiceName:      "main_ingester",
		BatchSize:        latestBatch,
		WorkerCount:      latestWorkers,
		StartBlock:       startBlock,
		Mode:             "forward",
		MaxReorgDepth:    maxReorgDepth,
		OnNewBlock:       api.BroadcastNewBlock,
		OnNewTransaction: api.BroadcastNewTransaction,
	})

	// Backward Ingester (History Backfill)
	backwardIngester := ingester.NewService(flowClient, repo, ingester.Config{
		ServiceName:   "history_ingester",
		BatchSize:     historyBatch,
		WorkerCount:   historyWorkers,
		StartBlock:    startBlock,
		Mode:          "backward",
		MaxReorgDepth: maxReorgDepth,
		// No callbacks for history to avoid spamming the frontend live feed
		// or maybe we want them? Let's leave them nil for now to keep UI clean.
	})

	// Async Workers (optional)
	enableTokenWorker := os.Getenv("ENABLE_TOKEN_WORKER") != "false"
	enableMetaWorker := os.Getenv("ENABLE_META_WORKER") != "false"

	var tokenWorkerProcessor *ingester.TokenWorker
	var tokenWorker *ingester.AsyncWorker
	var metaWorkerProcessor *ingester.MetaWorker
	var metaWorker *ingester.AsyncWorker

	workerTypes := make([]string, 0, 2)

	if enableTokenWorker {
		tokenWorkerProcessor = ingester.NewTokenWorker(repo)
		tokenWorker = ingester.NewAsyncWorker(tokenWorkerProcessor, repo, ingester.WorkerConfig{
			RangeSize: 50000,
		})
		workerTypes = append(workerTypes, tokenWorkerProcessor.Name())
	} else {
		log.Println("Token Worker is DISABLED (ENABLE_TOKEN_WORKER=false)")
	}

	if enableMetaWorker {
		metaWorkerProcessor = ingester.NewMetaWorker(repo)
		metaWorker = ingester.NewAsyncWorker(metaWorkerProcessor, repo, ingester.WorkerConfig{
			RangeSize: 50000,
		})
		workerTypes = append(workerTypes, metaWorkerProcessor.Name())
	} else {
		log.Println("Meta Worker is DISABLED (ENABLE_META_WORKER=false)")
	}

	var committer *ingester.CheckpointCommitter
	if len(workerTypes) > 0 {
		committer = ingester.NewCheckpointCommitter(repo, workerTypes)
	}

	apiServer := api.NewServer(repo, flowClient, apiPort, startBlock)

	// 4. Run
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle SIGINT
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Shutting down...")
		apiServer.Shutdown(ctx)
		cancel()
	}()

	// Start API in background
	go func() {
		// Serve Swagger Docs
		fs := http.FileServer(http.Dir("./docs"))
		http.Handle("/swagger/", http.StripPrefix("/swagger/", fs))

		log.Printf("Starting API Server on :%s", apiPort)
		if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API Server failed: %v", err)
		}
	}()

	// Start Ingesters in background
	var wg sync.WaitGroup
	wg.Add(1)

	// Always start forward ingester
	go func() {
		defer wg.Done()
		forwardIngester.Start(ctx)
	}()

	// Conditionally start backward ingester
	enableHistory := os.Getenv("ENABLE_HISTORY_INGESTER") != "false"
	if enableHistory {
		wg.Add(1)
		go func() {
			defer wg.Done()
			backwardIngester.Start(ctx)
		}()
	} else {
		log.Println("History Ingester is DISABLED (ENABLE_HISTORY_INGESTER=false)")
	}

	// Start Async Workers
	if enableTokenWorker {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tokenWorker.Start(ctx)
		}()
	}

	if enableMetaWorker {
		wg.Add(1)
		go func() {
			defer wg.Done()
			metaWorker.Start(ctx)
		}()
	}

	// Start Committer
	if committer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			committer.Start(ctx)
		}()
	}

	// Start Daily Stats Aggregator (Runs every 5 mins)
	enableDailyStats := os.Getenv("ENABLE_DAILY_STATS") != "false"
	if enableDailyStats {
		wg.Add(1)
		go func() {
			defer wg.Done()

			// Run immediately
			log.Println("Running initial Daily Stats Aggregation...")
			if err := repo.RefreshDailyStats(ctx); err != nil {
				log.Printf("Failed to refresh daily stats: %v", err)
			}

			ticker := time.NewTicker(5 * time.Minute)
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := repo.RefreshDailyStats(ctx); err != nil {
						log.Printf("Failed to refresh daily stats: %v", err)
					}
				}
			}
		}()
	} else {
		log.Println("Daily Stats Aggregator is DISABLED (ENABLE_DAILY_STATS=false)")
	}

	// Start Lookup Repair Job (optional)
	enableLookupRepair := os.Getenv("ENABLE_LOOKUP_REPAIR") == "true"
	if enableLookupRepair {
		repairLimit := getEnvInt("LOOKUP_REPAIR_LIMIT", 1000)
		repairIntervalMin := getEnvInt("LOOKUP_REPAIR_INTERVAL_MIN", 10)

		wg.Add(1)
		go func() {
			defer wg.Done()

			ticker := time.NewTicker(time.Duration(repairIntervalMin) * time.Minute)
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := repo.RepairTxLookup(ctx, repairLimit); err != nil {
						log.Printf("Lookup repair (tx) failed: %v", err)
					}
					if err := repo.RepairBlockLookup(ctx, repairLimit); err != nil {
						log.Printf("Lookup repair (block) failed: %v", err)
					}
				}
			}
		}()
	} else {
		log.Println("Lookup Repair is DISABLED (ENABLE_LOOKUP_REPAIR=false)")
	}

	wg.Wait()
}
