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

// BuildCommit is set at build time via -ldflags.
var BuildCommit = "dev"

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

	// 2a. Auto-Migration (skip with SKIP_MIGRATION=true for API-only containers)
	if os.Getenv("SKIP_MIGRATION") == "true" {
		log.Println("Database Migration SKIPPED (SKIP_MIGRATION=true)")
	} else {
		// Terminate ALL other connections (including active queries stuck on IO)
		// from previous backend instances that may hold locks and block DDL.
		terminated, termErr := repo.TerminateOtherConnections(context.Background())
		if termErr != nil {
			log.Printf("Warning: failed to terminate other connections: %v", termErr)
		} else if terminated > 0 {
			log.Printf("Terminated %d connection(s) before migration", terminated)
		}

		log.Println("Running Database Migration...")
		if err := repo.Migrate("schema_v2.sql"); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		log.Println("Database Migration Complete.")
	}

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
	// Optional single-node fallback for history (e.g. your own archive node).
	// We intentionally do NOT assume a default here because public hostnames change.
	archiveNode := strings.TrimSpace(os.Getenv("FLOW_ARCHIVE_NODE"))
	if archiveNode != "" {
		historicNodesRaw = strings.TrimSpace(historicNodesRaw)
		if historicNodesRaw == "" {
			historicNodesRaw = archiveNode
		} else if !strings.Contains(historicNodesRaw, archiveNode) {
			historicNodesRaw = historicNodesRaw + "," + archiveNode
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
	getEnvInt64 := func(key string, defaultVal int64) int64 {
		if valStr := os.Getenv(key); valStr != "" {
			if val, err := strconv.ParseInt(valStr, 10, 64); err == nil {
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
	metaWorkerRange := getEnvUint("META_WORKER_RANGE", 1000) // used as default for head backfill
	// Queue-based async worker configs (block-range workers replaced by live_deriver)
	nftItemMetadataWorkerRange := getEnvUint("NFT_ITEM_METADATA_WORKER_RANGE", 1000)
	nftReconcilerRange := getEnvUint("NFT_RECONCILER_RANGE", 1000)
	nftItemMetadataWorkerConcurrency := getEnvInt("NFT_ITEM_METADATA_WORKER_CONCURRENCY", 1)
	nftReconcilerConcurrency := getEnvInt("NFT_RECONCILER_CONCURRENCY", 1)
	// Analytics async worker configs (heavy aggregation — run standalone, NOT in derivers)
	analyticsWorkerRange := getEnvUint("ANALYTICS_WORKER_RANGE", 5000)
	analyticsWorkerConcurrency := getEnvInt("ANALYTICS_WORKER_CONCURRENCY", 1)

	if strings.ToLower(os.Getenv("RUN_TX_METRICS_BACKFILL")) == "true" {
		cfg := repository.TxMetricsBackfillConfig{
			StartHeight: getEnvInt64("TX_METRICS_BACKFILL_START", 0),
			EndHeight:   getEnvInt64("TX_METRICS_BACKFILL_END", 0),
			BatchSize:   getEnvInt64("TX_METRICS_BACKFILL_BATCH", 2000),
			Sleep:       time.Duration(getEnvInt("TX_METRICS_BACKFILL_SLEEP_MS", 0)) * time.Millisecond,
		}
		go func() {
			if err := repo.BackfillTxMetrics(context.Background(), cfg); err != nil {
				log.Printf("[backfill_tx_metrics] error: %v", err)
			}
		}()
	}

	// History stop height (for parallel indexing — each instance indexes a spork range)
	historyStopHeight := getEnvUint("HISTORY_STOP_HEIGHT", 0)

	// Async Workers (optional)
	enableTokenWorker := os.Getenv("ENABLE_TOKEN_WORKER") != "false"
	enableEVMWorker := os.Getenv("ENABLE_EVM_WORKER") != "false"
	enableMetaWorker := os.Getenv("ENABLE_META_WORKER") != "false"
	enableAccountsWorker := os.Getenv("ENABLE_ACCOUNTS_WORKER") != "false"
	enableFTHoldingsWorker := os.Getenv("ENABLE_FT_HOLDINGS_WORKER") != "false"
	enableNFTOwnershipWorker := os.Getenv("ENABLE_NFT_OWNERSHIP_WORKER") != "false"
	enableTokenMetadataWorker := os.Getenv("ENABLE_TOKEN_METADATA_WORKER") != "false"
	enableTxContractsWorker := os.Getenv("ENABLE_TX_CONTRACTS_WORKER") != "false"
	enableTxMetricsWorker := os.Getenv("ENABLE_TX_METRICS_WORKER") != "false"
	enableStakingWorker := os.Getenv("ENABLE_STAKING_WORKER") != "false"
	enableDailyBalanceWorker := os.Getenv("ENABLE_DAILY_BALANCE_WORKER") != "false"
	enableDailyStatsWorker := os.Getenv("ENABLE_DAILY_STATS_WORKER") != "false"
	enableAnalyticsDeriverWorker := os.Getenv("ENABLE_ANALYTICS_DERIVER_WORKER") != "false"
	enableDefiWorker := os.Getenv("ENABLE_DEFI_WORKER") != "false"
	enableNFTItemMetadataWorker := os.Getenv("ENABLE_NFT_ITEM_METADATA_WORKER") != "false"
	enableNFTReconciler := os.Getenv("ENABLE_NFT_RECONCILER") != "false"

	// RAW_ONLY mode: disable all workers, derivers, and pollers — only run ingesters.
	if os.Getenv("RAW_ONLY") == "true" {
		enableTokenWorker = false
		enableEVMWorker = false
		enableMetaWorker = false
		enableAccountsWorker = false
		enableFTHoldingsWorker = false
		enableNFTOwnershipWorker = false
		enableTokenMetadataWorker = false
		enableTxContractsWorker = false
		enableTxMetricsWorker = false
		enableStakingWorker = false
		enableDailyBalanceWorker = false
		enableDailyStatsWorker = false
		enableAnalyticsDeriverWorker = false
		enableDefiWorker = false
		enableNFTItemMetadataWorker = false
		enableNFTReconciler = false
		os.Setenv("ENABLE_LIVE_DERIVERS", "false")
		os.Setenv("ENABLE_HISTORY_DERIVERS", "false")
		os.Setenv("ENABLE_LIVE_ADDRESS_BACKFILL", "false")
		os.Setenv("ENABLE_DAILY_STATS", "false")
		os.Setenv("ENABLE_PRICE_FEED", "false")
		os.Setenv("ENABLE_NETWORK_POLLER", "false")
		os.Setenv("ENABLE_LOOKUP_REPAIR", "false")
		log.Println("RAW_ONLY mode: all workers, derivers, and pollers disabled")
	}

	// Live/head derivers: Blockscout-style "real-time head" materialization.
	// These processors must be idempotent because they can overlap with backfills.
	enableLiveDerivers := os.Getenv("ENABLE_LIVE_DERIVERS") != "false"
	liveDeriverChunk := getEnvUint("LIVE_DERIVERS_CHUNK", 10)

	var liveDeriver *ingester.LiveDeriver
	var onIndexedRange ingester.RangeCallback
	if enableLiveDerivers {
		var processors []ingester.Processor
		if enableTokenWorker {
			processors = append(processors, ingester.NewTokenWorker(repo))
		}
		if enableEVMWorker {
			processors = append(processors, ingester.NewEVMWorker(repo))
		}
		if enableTxContractsWorker {
			processors = append(processors, ingester.NewTxContractsWorker(repo))
		}
		if enableAccountsWorker {
			processors = append(processors, ingester.NewAccountsWorker(repo))
		}
		if enableMetaWorker {
			processors = append(processors, ingester.NewMetaWorker(repo, flowClient))
		}
		// NOTE: token_metadata_worker is intentionally excluded from live_deriver.
		// It calls on-chain scripts (~2s per range) and would block real-time processing.
		// Metadata is fetched by history_deriver instead.
		if enableTxMetricsWorker {
			processors = append(processors, ingester.NewTxMetricsWorker(repo))
		}
		if enableStakingWorker {
			processors = append(processors, ingester.NewStakingWorker(repo))
		}
		if enableDefiWorker {
			processors = append(processors, ingester.NewDefiWorker(repo))
		}
		// NOTE: daily_stats_worker and analytics_deriver_worker are intentionally
		// excluded from live_deriver. They call RefreshDailyStatsRange which does a
		// full table scan on raw.transactions per affected date — far too heavy for
		// real-time 10-block chunks (120s timeout). Daily stats are maintained by:
		//   1. Startup full scan (ENABLE_DAILY_STATS=true)
		//   2. Periodic 30-day refresh (same goroutine)
		//   3. Standalone daily_stats_worker in history deriver for backfill
		// Phase 2 processors (depend on token_worker output):
		if enableFTHoldingsWorker {
			processors = append(processors, ingester.NewFTHoldingsWorker(repo))
		}
		if enableNFTOwnershipWorker {
			processors = append(processors, ingester.NewNFTOwnershipWorker(repo))
		}
		if enableDailyBalanceWorker {
			processors = append(processors, ingester.NewDailyBalanceWorker(repo))
		}

		liveDeriver = ingester.NewLiveDeriver(repo, processors, ingester.LiveDeriverConfig{
			ChunkSize: liveDeriverChunk,
		})
		onIndexedRange = liveDeriver.NotifyRange
	} else {
		log.Println("Live Derivers are DISABLED (ENABLE_LIVE_DERIVERS=false)")
	}

	// History Derivers: process raw blocks backfilled by the history ingester.
	// Async workers only move forward from their checkpoint (~live tip), so history
	// blocks below that checkpoint are unprocessed. The HistoryDeriver scans upward
	// from the bottom of raw data, running the same processors.
	enableHistoryDerivers := os.Getenv("ENABLE_HISTORY_DERIVERS") != "false"
	historyDeriverChunk := getEnvUint("HISTORY_DERIVERS_CHUNK", 1000)
	historyDeriverSleep := getEnvInt("HISTORY_DERIVERS_SLEEP_MS", 0)
	historyDeriverConcurrency := getEnvInt("HISTORY_DERIVERS_CONCURRENCY", 1)

	// History deriver processor list — declared at outer scope so a second instance can reuse it.
	type histProcEntry struct {
		name    string
		enabled bool
		create  func() ingester.Processor
	}
	histExcludeSet := map[string]bool{}
	if excl := os.Getenv("HISTORY_DERIVERS_EXCLUDE"); excl != "" {
		for _, name := range strings.Split(excl, ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				histExcludeSet[name] = true
			}
		}
		log.Printf("History deriver excluding processors: %v", excl)
	}
	allHistProcs := []histProcEntry{
		{"token_worker", enableTokenWorker, func() ingester.Processor { return ingester.NewTokenWorker(repo) }},
		{"evm_worker", enableEVMWorker, func() ingester.Processor { return ingester.NewEVMWorker(repo) }},
		{"tx_contracts_worker", enableTxContractsWorker, func() ingester.Processor { return ingester.NewTxContractsWorker(repo) }},
		{"accounts_worker", enableAccountsWorker, func() ingester.Processor { return ingester.NewAccountsWorker(repo) }},
		{"meta_worker", enableMetaWorker, func() ingester.Processor { return ingester.NewMetaWorker(repo, flowClient) }},
		{"token_metadata_worker", enableTokenMetadataWorker, func() ingester.Processor { return ingester.NewTokenMetadataWorker(repo, flowClient) }},
		{"tx_metrics_worker", enableTxMetricsWorker, func() ingester.Processor { return ingester.NewTxMetricsWorker(repo) }},
		{"staking_worker", enableStakingWorker, func() ingester.Processor { return ingester.NewStakingWorker(repo) }},
		{"defi_worker", enableDefiWorker, func() ingester.Processor { return ingester.NewDefiWorker(repo) }},
		// NOTE: daily_stats_worker and analytics_deriver_worker are NOT in the deriver.
		// They do full table scans on raw.transactions per affected date — too heavy for
		// deriver pipelines. They run as standalone async workers instead.
		{"ft_holdings_worker", enableFTHoldingsWorker, func() ingester.Processor { return ingester.NewFTHoldingsWorker(repo) }},
		{"nft_ownership_worker", enableNFTOwnershipWorker, func() ingester.Processor { return ingester.NewNFTOwnershipWorker(repo) }},
		{"daily_balance_worker", enableDailyBalanceWorker, func() ingester.Processor { return ingester.NewDailyBalanceWorker(repo) }},
	}

	var historyDeriver *ingester.HistoryDeriver
	var onHistoryIndexedRange ingester.RangeCallback
	if enableHistoryDerivers {
		var histProcessors []ingester.Processor
		for _, p := range allHistProcs {
			if p.enabled && !histExcludeSet[p.name] {
				histProcessors = append(histProcessors, p.create())
			}
		}
		// NOTE: nft_item_metadata_worker and nft_ownership_reconciler are NOT included here.
		// They are queue-based (ignore block heights) and run as standalone async workers.
		// Including them would serialize and block history derivation for ~1-2min per range.

		historyDeriver = ingester.NewHistoryDeriver(repo, histProcessors, ingester.HistoryDeriverConfig{
			ChunkSize:   historyDeriverChunk,
			SleepMs:     historyDeriverSleep,
			Concurrency: historyDeriverConcurrency,
			DisableUp:   os.Getenv("HISTORY_DERIVER_DISABLE_UP") == "true",
			DisableDown: os.Getenv("HISTORY_DERIVER_DISABLE_DOWN") == "true",
		})

		// Optionally create a live-style deriver for real-time processing of new history batches.
		// This runs processors immediately as the backward ingester commits each batch,
		// so we don't have to wait for the HistoryDeriver scan to reach those heights.
		// Disable with ENABLE_HISTORY_LIVE_DERIVER=false to reduce DB contention.
		if os.Getenv("ENABLE_HISTORY_LIVE_DERIVER") != "false" {
			historyLiveDeriver := ingester.NewLiveDeriver(repo, histProcessors, ingester.LiveDeriverConfig{
				ChunkSize:     liveDeriverChunk,
				DisableRepair: true, // Only the primary LiveDeriver runs repair to avoid duplicate work
			})
			historyLiveDeriver.Start(context.Background())
			onHistoryIndexedRange = historyLiveDeriver.NotifyRange
		} else {
			log.Println("History Live Deriver is DISABLED (ENABLE_HISTORY_LIVE_DERIVER=false)")
		}
	} else {
		log.Println("History Derivers are DISABLED (ENABLE_HISTORY_DERIVERS=false)")
	}

	// 3. Services
	// Forward Ingester (Live Data)
	forwardServiceName := os.Getenv("FORWARD_SERVICE_NAME")
	if forwardServiceName == "" {
		forwardServiceName = "main_ingester"
	}
	historyServiceName := os.Getenv("HISTORY_SERVICE_NAME")
	if historyServiceName == "" {
		historyServiceName = "history_ingester"
	}

	forwardIngester := ingester.NewService(flowClient, repo, ingester.Config{
		ServiceName:       forwardServiceName,
		BatchSize:         latestBatch,
		WorkerCount:       latestWorkers,
		StartBlock:        startBlock,
		Mode:              "forward",
		MaxReorgDepth:     maxReorgDepth,
		OnNewBlock:        api.BroadcastNewBlock,
		OnNewTransactions: api.MakeBroadcastNewTransactions(repo),
		OnIndexedRange:    onIndexedRange,
	})

	// Backward Ingester (History Backfill)
	backwardIngester := ingester.NewService(historyClient, repo, ingester.Config{
		ServiceName:    historyServiceName,
		BatchSize:      historyBatch,
		WorkerCount:    historyWorkers,
		StartBlock:     startBlock,
		StopHeight:     historyStopHeight,
		Mode:           "backward",
		MaxReorgDepth:  maxReorgDepth,
		OnIndexedRange: onHistoryIndexedRange,
	})

	// Block-range async workers are DISABLED (方案A): live_deriver processes all
	// block-range processors in real-time and updates their checkpoints directly.
	// Only queue-based workers (nft_item_metadata, nft_reconciler) still run as
	// async workers since they don't process block ranges.

	var nftItemMetadataWorkers []*ingester.AsyncWorker
	var nftReconcilerWorkers []*ingester.AsyncWorker

	workerTypes := make([]string, 0, 4)

	nftOwnershipDep := []string{"nft_ownership_worker"}

	if enableNFTItemMetadataWorker {
		nftItemMetadataWorkerProcessor := ingester.NewNFTItemMetadataWorker(repo, flowClient)
		if nftItemMetadataWorkerConcurrency < 1 {
			nftItemMetadataWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < nftItemMetadataWorkerConcurrency; i++ {
			nftItemMetadataWorkers = append(nftItemMetadataWorkers, ingester.NewAsyncWorker(nftItemMetadataWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize:    nftItemMetadataWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-nft-item-meta-%d", hostname, pid, i),
				Dependencies: nil, // Queue-based: ignores block heights
			}))
		}
		workerTypes = append(workerTypes, nftItemMetadataWorkerProcessor.Name())
	} else {
		log.Println("NFT Item Metadata Worker is DISABLED (ENABLE_NFT_ITEM_METADATA_WORKER=false)")
	}

	if enableNFTReconciler {
		nftReconcilerProcessor := ingester.NewNFTOwnershipReconciler(repo, flowClient)
		if nftReconcilerConcurrency < 1 {
			nftReconcilerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < nftReconcilerConcurrency; i++ {
			nftReconcilerWorkers = append(nftReconcilerWorkers, ingester.NewAsyncWorker(nftReconcilerProcessor, repo, ingester.WorkerConfig{
				RangeSize:    nftReconcilerRange,
				WorkerID:     fmt.Sprintf("%s-%d-nft-reconciler-%d", hostname, pid, i),
				Dependencies: nftOwnershipDep,
			}))
		}
		workerTypes = append(workerTypes, nftReconcilerProcessor.Name())
	} else {
		log.Println("NFT Ownership Reconciler is DISABLED (ENABLE_NFT_RECONCILER=false)")
	}

	// Analytics async workers — heavy aggregation queries, run standalone with large ranges.
	var analyticsWorkers []*ingester.AsyncWorker
	if enableDailyStatsWorker {
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < analyticsWorkerConcurrency; i++ {
			analyticsWorkers = append(analyticsWorkers, ingester.NewAsyncWorker(
				ingester.NewDailyStatsWorker(repo), repo, ingester.WorkerConfig{
					RangeSize: analyticsWorkerRange,
					WorkerID:  fmt.Sprintf("%s-%d-daily-stats-%d", hostname, pid, i),
				}))
		}
		workerTypes = append(workerTypes, "daily_stats_worker")
	} else {
		log.Println("Daily Stats Worker is DISABLED (ENABLE_DAILY_STATS_WORKER=false)")
	}

	if enableAnalyticsDeriverWorker {
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < analyticsWorkerConcurrency; i++ {
			analyticsWorkers = append(analyticsWorkers, ingester.NewAsyncWorker(
				ingester.NewAnalyticsDeriverWorker(repo), repo, ingester.WorkerConfig{
					RangeSize: analyticsWorkerRange,
					WorkerID:  fmt.Sprintf("%s-%d-analytics-deriver-%d", hostname, pid, i),
				}))
		}
		workerTypes = append(workerTypes, "analytics_deriver_worker")
	} else {
		log.Println("Analytics Deriver Worker is DISABLED (ENABLE_ANALYTICS_DERIVER_WORKER=false)")
	}

	var committer *ingester.CheckpointCommitter
	if len(workerTypes) > 0 {
		committer = ingester.NewCheckpointCommitter(repo, workerTypes)
	}

	api.BuildCommit = BuildCommit
	backfillProgress := api.NewBackfillProgress()
	apiServer := api.NewServer(repo, flowClient, apiPort, startBlock, func(s *api.Server) {
		s.SetBackfillProgress(backfillProgress)
	})

	// 4. Run
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start live/head derivers (Blockscout-style) if enabled.
	if liveDeriver != nil {
		liveDeriver.Start(ctx)

		// Optional: seed the last N blocks so the UI has data immediately after deploy.
		headBackfillBlocks := getEnvUint("LIVE_DERIVERS_HEAD_BACKFILL_BLOCKS", 100)
		if headBackfillBlocks > 0 {
			go func() {
				// Give the ingester a moment to start and the DB to warm up.
				select {
				case <-ctx.Done():
					return
				case <-time.After(15 * time.Second):
				}

				tip, err := repo.GetLastIndexedHeight(ctx, "main_ingester")
				if err != nil || tip == 0 {
					log.Printf("[live_head_backfill] Skip: cannot read main_ingester tip: %v", err)
					return
				}

				from := uint64(0)
				if tip > headBackfillBlocks {
					from = tip - headBackfillBlocks
				}
				to := tip + 1

				log.Printf("[live_head_backfill] Deriving head range [%d, %d) (blocks=%d)", from, to, headBackfillBlocks)
				liveDeriver.NotifyRange(from, to)
			}()
		}
	}

	// Start history derivers if enabled.
	if historyDeriver != nil {
		historyDeriver.Start(ctx)
	}

	// Optional second history deriver instance (e.g., UP-only scanning toward instance 1's DOWN).
	if enableHistoryDerivers && os.Getenv("HISTORY_DERIVER2_ENABLED") == "true" {
		hd2Chunk := getEnvUint("HISTORY_DERIVER2_CHUNK", historyDeriverChunk)
		hd2Concurrency := getEnvInt("HISTORY_DERIVER2_CONCURRENCY", historyDeriverConcurrency)
		hd2Sleep := getEnvInt("HISTORY_DERIVER2_SLEEP_MS", historyDeriverSleep)
		hd2Prefix := os.Getenv("HISTORY_DERIVER2_CHECKPOINT")
		if hd2Prefix == "" {
			hd2Prefix = "history_deriver_2"
		}
		hd2Ceiling := getEnvUint("HISTORY_DERIVER2_CEILING", 0)

		// Build a fresh processor list (separate instances, no shared state).
		var hd2Processors []ingester.Processor
		for _, p := range allHistProcs {
			if p.enabled && !histExcludeSet[p.name] {
				hd2Processors = append(hd2Processors, p.create())
			}
		}

		hd2 := ingester.NewHistoryDeriver(repo, hd2Processors, ingester.HistoryDeriverConfig{
			ChunkSize:        hd2Chunk,
			SleepMs:          hd2Sleep,
			Concurrency:      hd2Concurrency,
			CheckpointPrefix: hd2Prefix,
			DisableUp:        os.Getenv("HISTORY_DERIVER2_DISABLE_UP") == "true",
			DisableDown:      os.Getenv("HISTORY_DERIVER2_DISABLE_DOWN") == "true",
			CeilingHeight:    hd2Ceiling,
		})
		hd2.Start(ctx)
		log.Printf("History Deriver 2 started (prefix=%s chunk=%d concurrency=%d ceiling=%d)", hd2Prefix, hd2Chunk, hd2Concurrency, hd2Ceiling)
	}

	// Handle SIGINT/SIGTERM — will block on sigChan at end of main()
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

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

	// Start Async Workers (queue-based only — block-range workers replaced by live_deriver)
	if enableNFTItemMetadataWorker {
		for _, worker := range nftItemMetadataWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableNFTReconciler {
		for _, worker := range nftReconcilerWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	// Start Analytics Workers (standalone — not in derivers)
	for _, worker := range analyticsWorkers {
		wg.Add(1)
		go func(w *ingester.AsyncWorker) {
			defer wg.Done()
			w.Start(ctx)
		}(worker)
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
		if liveDeriver != nil {
			log.Println("Live address backfill is DISABLED because live derivers are enabled (ENABLE_LIVE_DERIVERS!=false)")
		} else {
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

					if err := repo.BackfillAddressTransactionsAndStatsRange(ctx, start, end); err != nil {
						log.Printf("[live_address_backfill] Range [%d, %d) failed: %v", start, end, err)
						continue
					}
					log.Printf("[live_address_backfill] Range [%d, %d) ok", start, end)
				}

				log.Printf("[live_address_backfill] Done (tip=%d)", tip)
			}()
		}
	} else {
		log.Println("Live address backfill is DISABLED (ENABLE_LIVE_ADDRESS_BACKFILL=false)")
	}

	// One-time Daily Stats full scan on startup (catches any gaps from before
	// the DailyStatsWorker was deployed). The DailyStatsWorker in live/history
	// derivers handles incremental updates going forward.
	enableDailyStats := os.Getenv("ENABLE_DAILY_STATS") != "false"
	if enableDailyStats {
		go func() {
			log.Println("Running initial Daily Stats Aggregation (full scan)...")
			if err := repo.RefreshDailyStats(ctx, true); err != nil {
				log.Printf("Failed to refresh daily stats (full): %v", err)
			} else {
				log.Println("Initial Daily Stats Aggregation complete.")
			}
		}()
	} else {
		log.Println("Daily Stats Aggregator is DISABLED (ENABLE_DAILY_STATS=false)")
	}

	// Analytics backward backfill: process from the current tip backward to fill
	// the last N months of daily_stats and analytics.daily_metrics.
	// This is a one-shot job that runs on startup and exits when done.
	// Controlled by ENABLE_ANALYTICS_BACKFILL=true (default: false).
	enableAnalyticsBackfill := os.Getenv("ENABLE_ANALYTICS_BACKFILL") == "true"
	if enableAnalyticsBackfill {
		backfillMonths := getEnvInt("ANALYTICS_BACKFILL_MONTHS", 6)
		backfillChunk := getEnvUint("ANALYTICS_BACKFILL_CHUNK", 5000)
		if backfillChunk < 100 {
			backfillChunk = 100
		}
		backfillSleepMs := getEnvInt("ANALYTICS_BACKFILL_SLEEP_MS", 500)

		wg.Add(1)
		go func() {
			defer wg.Done()

			// Give the DB a moment to warm up.
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Second):
			}

			tip, err := repo.GetLastIndexedHeight(ctx, "main_ingester")
			if err != nil || tip == 0 {
				log.Printf("[analytics_backfill] Skip: cannot read main_ingester tip: %v", err)
				return
			}

			// Calculate target: N months ago from now, mapped to a block height.
			// Rough estimate: ~1 block/sec on Flow mainnet → ~2.6M blocks/month.
			targetHeight := uint64(0)
			blocksPerMonth := uint64(2_600_000)
			monthsBack := uint64(backfillMonths)
			if tip > blocksPerMonth*monthsBack {
				targetHeight = tip - blocksPerMonth*monthsBack
			}

			log.Printf("[analytics_backfill] Starting backward from tip=%d to target=%d (months=%d chunk=%d sleep=%dms)",
				tip, targetHeight, backfillMonths, backfillChunk, backfillSleepMs)

			// Initialize backfill progress for API visibility.
			backfillProgress.Init(tip, targetHeight)

			// Process backward: from tip down to targetHeight in chunks.
			processed := uint64(0)
			startTime := time.Now()
			cursor := tip

			for cursor > targetHeight {
				if ctx.Err() != nil {
					log.Printf("[analytics_backfill] Cancelled at height %d", cursor)
					return
				}

				chunkFrom := cursor - backfillChunk
				if chunkFrom < targetHeight {
					chunkFrom = targetHeight
				}
				// Underflow guard
				if chunkFrom > cursor {
					chunkFrom = 0
				}
				chunkTo := cursor

				// Clear existing data for this chunk's date range first (additive ON CONFLICT).
				if err := repo.ClearDailyStatsForHeightRange(ctx, chunkFrom, chunkTo); err != nil {
					log.Printf("[analytics_backfill] Warning: clear daily_stats [%d, %d) failed: %v", chunkFrom, chunkTo, err)
				}
				if err := repo.ClearAnalyticsDailyMetricsForHeightRange(ctx, chunkFrom, chunkTo); err != nil {
					log.Printf("[analytics_backfill] Warning: clear daily_metrics [%d, %d) failed: %v", chunkFrom, chunkTo, err)
				}

				// Aggregate daily_stats
				if err := repo.RefreshDailyStatsRange(ctx, chunkFrom, chunkTo); err != nil {
					log.Printf("[analytics_backfill] daily_stats [%d, %d) failed: %v", chunkFrom, chunkTo, err)
					// Sleep and retry later rather than giving up.
					time.Sleep(5 * time.Second)
					continue
				}

				// Aggregate analytics.daily_metrics
				if err := repo.RefreshAnalyticsDailyMetricsRange(ctx, chunkFrom, chunkTo); err != nil {
					log.Printf("[analytics_backfill] daily_metrics [%d, %d) failed: %v", chunkFrom, chunkTo, err)
					time.Sleep(5 * time.Second)
					continue
				}

				processed += chunkTo - chunkFrom
				elapsed := time.Since(startTime)
				speed := float64(processed) / elapsed.Seconds()
				remaining := float64(cursor-targetHeight) / speed
				log.Printf("[analytics_backfill] Done [%d, %d) — processed=%d speed=%.0f b/s ETA=%.0fm cursor=%d",
					chunkFrom, chunkTo, processed, speed, remaining/60, chunkFrom)

				cursor = chunkFrom
				backfillProgress.Update(cursor, processed, speed)

				// Throttle to avoid overloading the DB.
				if backfillSleepMs > 0 {
					time.Sleep(time.Duration(backfillSleepMs) * time.Millisecond)
				}
			}

			backfillProgress.MarkDone()
			log.Printf("[analytics_backfill] Complete! Processed %d blocks from %d down to %d in %s",
				processed, tip, targetHeight, time.Since(startTime).Round(time.Second))
		}()
	}

	// Refresh NFT collection stats materialized view periodically
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := repo.RefreshNFTCollectionStats(ctx); err != nil {
					log.Printf("Failed to refresh nft_collection_stats: %v", err)
				}
			}
		}
	}()

	// Historical price backfill: fetch up to 365 days of daily FLOW/USD from CoinGecko.
	// Only runs if existing data is less than 30 days deep.
	enablePriceFeed := os.Getenv("ENABLE_PRICE_FEED") != "false"
	if enablePriceFeed {
		go func() {
			earliest, err := repo.GetEarliestMarketPrice(ctx, "FLOW", "USD")
			needsBackfill := err != nil || earliest.AsOf.After(time.Now().AddDate(0, 0, -30))
			if !needsBackfill {
				log.Printf("[price_backfill] Skipping: earliest price record at %s (>30 days)", earliest.AsOf.Format("2006-01-02"))
				return
			}
			log.Println("[price_backfill] Fetching 365 days of FLOW/USD history from CoinGecko...")
			ctxFetch, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			history, err := market.FetchFlowPriceHistory(ctxFetch, 365)
			if err != nil {
				log.Printf("[price_backfill] Failed to fetch history: %v", err)
				return
			}
			prices := make([]repository.MarketPrice, len(history))
			for i, q := range history {
				prices[i] = repository.MarketPrice{
					Asset:     q.Asset,
					Currency:  q.Currency,
					Price:     q.Price,
					MarketCap: q.MarketCap,
					Source:    q.Source,
					AsOf:      q.AsOf,
				}
			}
			inserted, err := repo.BulkInsertMarketPrices(ctx, prices)
			if err != nil {
				log.Printf("[price_backfill] Insert error (inserted %d before failure): %v", inserted, err)
				return
			}
			log.Printf("[price_backfill] Done: %d new daily prices inserted (of %d fetched)", inserted, len(history))
		}()
	}

	// Start Market Price Poller (Runs every N mins)
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

	// Start Network Poller (epoch + tokenomics from Cadence scripts)
	enableNetworkPoller := os.Getenv("ENABLE_NETWORK_POLLER") != "false"
	if enableNetworkPoller {
		pollIntervalSec := getEnvInt("NETWORK_POLL_INTERVAL_SEC", 30)
		poller := ingester.NewNetworkPoller(flowClient, repo, pollIntervalSec)

		wg.Add(1)
		go func() {
			defer wg.Done()
			poller.Start(ctx)
		}()
	} else {
		log.Println("Network Poller is DISABLED (ENABLE_NETWORK_POLLER=false)")
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

	// Block until shutdown signal. Workers are in the WaitGroup but the
	// API server also needs to stay alive even with zero workers (API-only mode).
	<-sigChan
	log.Println("Shutting down...")
	apiServer.Shutdown(ctx)
	cancel()
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
