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
	if err := repo.Migrate("schema.sql"); err != nil {
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

	latestWorkers := getEnvInt("LATEST_WORKER_COUNT", 2)
	historyWorkers := getEnvInt("HISTORY_WORKER_COUNT", 5)
	latestBatch := getEnvInt("LATEST_BATCH_SIZE", 1)    // Real-time
	historyBatch := getEnvInt("HISTORY_BATCH_SIZE", 20) // Throughput

	// 3. Services
	// Forward Ingester (Live Data)
	forwardIngester := ingester.NewService(flowClient, repo, ingester.Config{
		ServiceName:      "main_ingester",
		BatchSize:        latestBatch,
		WorkerCount:      latestWorkers,
		StartBlock:       startBlock,
		Mode:             "forward",
		OnNewBlock:       api.BroadcastNewBlock,
		OnNewTransaction: api.BroadcastNewTransaction,
	})

	// Backward Ingester (History Backfill)
	backwardIngester := ingester.NewService(flowClient, repo, ingester.Config{
		ServiceName: "history_ingester",
		BatchSize:   historyBatch,
		WorkerCount: historyWorkers,
		StartBlock:  startBlock,
		Mode:        "backward",
		// No callbacks for history to avoid spamming the frontend live feed
		// or maybe we want them? Let's leave them nil for now to keep UI clean.
	})

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

	wg.Wait()
}
