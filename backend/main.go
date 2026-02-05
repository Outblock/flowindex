package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"flowscan-clone/internal/api"
	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/ingester"
	"flowscan-clone/internal/market"
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
	log.Printf("DB: %s", redactDatabaseURL(dbURL))
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

	flowClient, err := flow.NewClientFromEnv("FLOW_ACCESS_NODES", flowURL)
	if err != nil {
		log.Fatalf("Failed to connect to Flow: %v", err)
	}
	defer flowClient.Close()

	// Historic nodes for pre-spork history backfill.
	//
	// NOTE: Regular access nodes only serve blocks for the current spork. When history backfill
	// crosses a spork boundary, the node returns NotFound with a "spork root block height" hint.
	// We include an archive node by default so history backfill keeps progressing without manual
	// env var edits + restarts.
	//
	// You can override/extend the pool via FLOW_HISTORIC_ACCESS_NODES.
	// Example: "access-001.mainnet28.nodes.onflow.org:9000,access-001.mainnet27.nodes.onflow.org:9000,archive.mainnet.nodes.onflow.org:9000"
	historicNodesRaw := strings.TrimSpace(os.Getenv("FLOW_HISTORIC_ACCESS_NODES"))
	if historicNodesRaw == "" {
		// Reuse the live pool by default for the newest heights.
		historicNodesRaw = strings.TrimSpace(os.Getenv("FLOW_ACCESS_NODES"))
		if historicNodesRaw == "" {
			historicNodesRaw = flowURL
		}
	}
	archiveNode := strings.TrimSpace(os.Getenv("FLOW_ARCHIVE_NODE"))
	if archiveNode == "" {
		archiveNode = "archive.mainnet.nodes.onflow.org:9000"
	}
	// Ensure the archive node is always included as a safety net.
	historicNodesRaw = strings.TrimSpace(historicNodesRaw)
	if archiveNode != "" && !strings.Contains(historicNodesRaw, archiveNode) {
		if historicNodesRaw != "" {
			historicNodesRaw = historicNodesRaw + "," + archiveNode
		} else {
			historicNodesRaw = archiveNode
		}
	}

	historyClient, err := flow.NewClientFromEnv("FLOW_HISTORIC_ACCESS_NODES_EFFECTIVE", historicNodesRaw)
	if err != nil {
		log.Fatalf("Failed to connect to Flow historic nodes: %v", err)
	}
	defer historyClient.Close()

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
	tokenWorkerRange := getEnvUint("TOKEN_WORKER_RANGE", 50000)
	metaWorkerRange := getEnvUint("META_WORKER_RANGE", 50000)
	accountsWorkerRange := getEnvUint("ACCOUNTS_WORKER_RANGE", 50000)
	ftHoldingsWorkerRange := getEnvUint("FT_HOLDINGS_WORKER_RANGE", 50000)
	nftOwnershipWorkerRange := getEnvUint("NFT_OWNERSHIP_WORKER_RANGE", 50000)
	txContractsWorkerRange := getEnvUint("TX_CONTRACTS_WORKER_RANGE", 50000)
	tokenWorkerConcurrency := getEnvInt("TOKEN_WORKER_CONCURRENCY", 1)
	metaWorkerConcurrency := getEnvInt("META_WORKER_CONCURRENCY", 1)
	accountsWorkerConcurrency := getEnvInt("ACCOUNTS_WORKER_CONCURRENCY", 1)
	ftHoldingsWorkerConcurrency := getEnvInt("FT_HOLDINGS_WORKER_CONCURRENCY", 1)
	nftOwnershipWorkerConcurrency := getEnvInt("NFT_OWNERSHIP_WORKER_CONCURRENCY", 1)
	txContractsWorkerConcurrency := getEnvInt("TX_CONTRACTS_WORKER_CONCURRENCY", 1)

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
	backwardIngester := ingester.NewService(historyClient, repo, ingester.Config{
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
	enableAccountsWorker := os.Getenv("ENABLE_ACCOUNTS_WORKER") != "false"
	enableFTHoldingsWorker := os.Getenv("ENABLE_FT_HOLDINGS_WORKER") != "false"
	enableNFTOwnershipWorker := os.Getenv("ENABLE_NFT_OWNERSHIP_WORKER") != "false"
	enableTxContractsWorker := os.Getenv("ENABLE_TX_CONTRACTS_WORKER") != "false"

	var tokenWorkerProcessor *ingester.TokenWorker
	var tokenWorkers []*ingester.AsyncWorker
	var metaWorkerProcessor *ingester.MetaWorker
	var metaWorkers []*ingester.AsyncWorker
	var accountsWorkerProcessor *ingester.AccountsWorker
	var accountsWorkers []*ingester.AsyncWorker
	var ftHoldingsWorkerProcessor *ingester.FTHoldingsWorker
	var ftHoldingsWorkers []*ingester.AsyncWorker
	var nftOwnershipWorkerProcessor *ingester.NFTOwnershipWorker
	var nftOwnershipWorkers []*ingester.AsyncWorker
	var txContractsWorkerProcessor *ingester.TxContractsWorker
	var txContractsWorkers []*ingester.AsyncWorker

	workerTypes := make([]string, 0, 6)

	if enableTokenWorker {
		tokenWorkerProcessor = ingester.NewTokenWorker(repo)
		if tokenWorkerConcurrency < 1 {
			tokenWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < tokenWorkerConcurrency; i++ {
			tokenWorkers = append(tokenWorkers, ingester.NewAsyncWorker(tokenWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: tokenWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-token-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, tokenWorkerProcessor.Name())
	} else {
		log.Println("Token Worker is DISABLED (ENABLE_TOKEN_WORKER=false)")
	}

	if enableMetaWorker {
		metaWorkerProcessor = ingester.NewMetaWorker(repo)
		if metaWorkerConcurrency < 1 {
			metaWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < metaWorkerConcurrency; i++ {
			metaWorkers = append(metaWorkers, ingester.NewAsyncWorker(metaWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: metaWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-meta-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, metaWorkerProcessor.Name())
	} else {
		log.Println("Meta Worker is DISABLED (ENABLE_META_WORKER=false)")
	}

	if enableAccountsWorker {
		accountsWorkerProcessor = ingester.NewAccountsWorker(repo)
		if accountsWorkerConcurrency < 1 {
			accountsWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < accountsWorkerConcurrency; i++ {
			accountsWorkers = append(accountsWorkers, ingester.NewAsyncWorker(accountsWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: accountsWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-accounts-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, accountsWorkerProcessor.Name())
	} else {
		log.Println("Accounts Worker is DISABLED (ENABLE_ACCOUNTS_WORKER=false)")
	}

	if enableFTHoldingsWorker {
		ftHoldingsWorkerProcessor = ingester.NewFTHoldingsWorker(repo)
		if ftHoldingsWorkerConcurrency < 1 {
			ftHoldingsWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < ftHoldingsWorkerConcurrency; i++ {
			ftHoldingsWorkers = append(ftHoldingsWorkers, ingester.NewAsyncWorker(ftHoldingsWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: ftHoldingsWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-ft-holdings-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, ftHoldingsWorkerProcessor.Name())
	} else {
		log.Println("FT Holdings Worker is DISABLED (ENABLE_FT_HOLDINGS_WORKER=false)")
	}

	if enableNFTOwnershipWorker {
		nftOwnershipWorkerProcessor = ingester.NewNFTOwnershipWorker(repo)
		if nftOwnershipWorkerConcurrency < 1 {
			nftOwnershipWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < nftOwnershipWorkerConcurrency; i++ {
			nftOwnershipWorkers = append(nftOwnershipWorkers, ingester.NewAsyncWorker(nftOwnershipWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: nftOwnershipWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-nft-ownership-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, nftOwnershipWorkerProcessor.Name())
	} else {
		log.Println("NFT Ownership Worker is DISABLED (ENABLE_NFT_OWNERSHIP_WORKER=false)")
	}

	if enableTxContractsWorker {
		txContractsWorkerProcessor = ingester.NewTxContractsWorker(repo)
		if txContractsWorkerConcurrency < 1 {
			txContractsWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < txContractsWorkerConcurrency; i++ {
			txContractsWorkers = append(txContractsWorkers, ingester.NewAsyncWorker(txContractsWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: txContractsWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-tx-contracts-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, txContractsWorkerProcessor.Name())
	} else {
		log.Println("Tx Contracts Worker is DISABLED (ENABLE_TX_CONTRACTS_WORKER=false)")
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
		log.Printf("Starting API Server on :%s", apiPort)
		if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API Server failed: %v", err)
		}
	}()

	// Start Ingesters in background
	var wg sync.WaitGroup
	// Conditionally start forward ingester
	enableForward := os.Getenv("ENABLE_FORWARD_INGESTER") != "false"
	if enableForward {
		wg.Add(1)
		go func() {
			defer wg.Done()
			forwardIngester.Start(ctx)
		}()
	} else {
		log.Println("Forward Ingester is DISABLED (ENABLE_FORWARD_INGESTER=false)")
	}

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
		for _, worker := range tokenWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableMetaWorker {
		for _, worker := range metaWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableAccountsWorker {
		for _, worker := range accountsWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableFTHoldingsWorker {
		for _, worker := range ftHoldingsWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableNFTOwnershipWorker {
		for _, worker := range nftOwnershipWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableTxContractsWorker {
		for _, worker := range txContractsWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	// Start Committer
	if committer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			committer.Start(ctx)
		}()
	}

	// Live address backfill (optional)
	//
	// Problem: meta_worker often runs in large ranges (e.g. 50k blocks) for throughput, which can
	// leave app.address_transactions stale near the chain head. That makes "account -> transactions"
	// pages look empty even though the underlying transactions are already indexed.
	//
	// This one-shot job backfills the most recent N blocks into app.address_transactions so the UI
	// reflects recent activity immediately. It is idempotent (ON CONFLICT DO NOTHING).
	enableLiveAddrBackfill := os.Getenv("ENABLE_LIVE_ADDRESS_BACKFILL") != "false"
	if enableLiveAddrBackfill {
		backfillBlocks := getEnvUint("LIVE_ADDRESS_BACKFILL_BLOCKS", metaWorkerRange)
		chunkBlocks := getEnvUint("LIVE_ADDRESS_BACKFILL_CHUNK", 5000)
		if chunkBlocks < 1 {
			chunkBlocks = 5000
		}

		wg.Add(1)
		go func() {
			defer wg.Done()

			// Give the ingester a moment to start and the DB to warm up.
			select {
			case <-ctx.Done():
				return
			case <-time.After(15 * time.Second):
			}

			tip, err := repo.GetLastIndexedHeight(ctx, "main_ingester")
			if err != nil || tip == 0 {
				log.Printf("[live_address_backfill] Skip: cannot read main_ingester tip: %v", err)
				return
			}

			from := uint64(0)
			if backfillBlocks > 0 && tip > backfillBlocks {
				from = tip - backfillBlocks
			}
			to := tip + 1

			log.Printf("[live_address_backfill] Backfilling app.address_transactions for heights [%d, %d) (chunk=%d)", from, to, chunkBlocks)
			for start := from; start < to; start += chunkBlocks {
				if ctx.Err() != nil {
					return
				}
				end := start + chunkBlocks
				if end > to {
					end = to
				}

				rows, err := repo.BackfillAddressTransactionsRange(ctx, start, end)
				if err != nil {
					log.Printf("[live_address_backfill] Range [%d, %d) failed: %v", start, end, err)
					continue
				}
				if rows > 0 {
					log.Printf("[live_address_backfill] Range [%d, %d) inserted %d rows", start, end, rows)
				}
			}

			log.Printf("[live_address_backfill] Done (tip=%d)", tip)
		}()
	} else {
		log.Println("Live address backfill is DISABLED (ENABLE_LIVE_ADDRESS_BACKFILL=false)")
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

	// Start Market Price Poller (Runs every N mins)
	enablePriceFeed := os.Getenv("ENABLE_PRICE_FEED") != "false"
	if enablePriceFeed {
		refreshMin := getEnvInt("PRICE_REFRESH_MIN", 10)

		wg.Add(1)
		go func() {
			defer wg.Done()

			fetchAndStore := func() {
				ctxFetch, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()

				quote, err := market.FetchFlowPrice(ctxFetch)
				if err != nil {
					log.Printf("Failed to fetch Flow price: %v", err)
					return
				}

				if err := repo.InsertMarketPrice(ctxFetch, repository.MarketPrice{
					Asset:          quote.Asset,
					Currency:       quote.Currency,
					Price:          quote.Price,
					PriceChange24h: quote.PriceChange24h,
					MarketCap:      quote.MarketCap,
					Source:         quote.Source,
					AsOf:           quote.AsOf,
				}); err != nil {
					log.Printf("Failed to store Flow price: %v", err)
				}
			}

			// Run immediately
			fetchAndStore()

			ticker := time.NewTicker(time.Duration(refreshMin) * time.Minute)
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					fetchAndStore()
				}
			}
		}()
	} else {
		log.Println("Market Price Poller is DISABLED (ENABLE_PRICE_FEED=false)")
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

func redactDatabaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	u, err := url.Parse(raw)
	if err == nil && u.Scheme != "" {
		if u.User != nil {
			user := u.User.Username()
			if user == "" {
				user = "user"
			}
			u.User = url.UserPassword(user, "****")
		}
		// Avoid leaking secrets embedded in query params; keep only scheme/host/path for debugging.
		u.RawQuery = ""
		return u.String()
	}

	// Best-effort fallback for malformed/DSN-like URLs.
	re := regexp.MustCompile(`(?i)(postgres(?:ql)?://[^:/?#]+):([^@]+)@`)
	if re.MatchString(raw) {
		return re.ReplaceAllString(raw, `$1:****@`)
	}
	re = regexp.MustCompile(`(?i)(password=)([^\\s]+)`)
	return re.ReplaceAllString(raw, `$1****`)
}
