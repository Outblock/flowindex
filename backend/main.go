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
	tokenWorkerRange := getEnvUint("TOKEN_WORKER_RANGE", 1000)
	evmWorkerRange := getEnvUint("EVM_WORKER_RANGE", 1000)
	metaWorkerRange := getEnvUint("META_WORKER_RANGE", 1000)
	accountsWorkerRange := getEnvUint("ACCOUNTS_WORKER_RANGE", 1000)
	ftHoldingsWorkerRange := getEnvUint("FT_HOLDINGS_WORKER_RANGE", 1000)
	nftOwnershipWorkerRange := getEnvUint("NFT_OWNERSHIP_WORKER_RANGE", 1000)
	tokenMetadataWorkerRange := getEnvUint("TOKEN_METADATA_WORKER_RANGE", 1000)
	txContractsWorkerRange := getEnvUint("TX_CONTRACTS_WORKER_RANGE", 1000)
	txMetricsWorkerRange := getEnvUint("TX_METRICS_WORKER_RANGE", 1000)
	stakingWorkerRange := getEnvUint("STAKING_WORKER_RANGE", 1000)
	dailyBalanceWorkerRange := getEnvUint("DAILY_BALANCE_WORKER_RANGE", 1000)
	defiWorkerRange := getEnvUint("DEFI_WORKER_RANGE", 1000)
	nftItemMetadataWorkerRange := getEnvUint("NFT_ITEM_METADATA_WORKER_RANGE", 1000)
	nftReconcilerRange := getEnvUint("NFT_RECONCILER_RANGE", 1000)
	tokenWorkerConcurrency := getEnvInt("TOKEN_WORKER_CONCURRENCY", 1)
	evmWorkerConcurrency := getEnvInt("EVM_WORKER_CONCURRENCY", 1)
	metaWorkerConcurrency := getEnvInt("META_WORKER_CONCURRENCY", 1)
	accountsWorkerConcurrency := getEnvInt("ACCOUNTS_WORKER_CONCURRENCY", 1)
	ftHoldingsWorkerConcurrency := getEnvInt("FT_HOLDINGS_WORKER_CONCURRENCY", 1)
	nftOwnershipWorkerConcurrency := getEnvInt("NFT_OWNERSHIP_WORKER_CONCURRENCY", 1)
	tokenMetadataWorkerConcurrency := getEnvInt("TOKEN_METADATA_WORKER_CONCURRENCY", 1)
	txContractsWorkerConcurrency := getEnvInt("TX_CONTRACTS_WORKER_CONCURRENCY", 1)
	txMetricsWorkerConcurrency := getEnvInt("TX_METRICS_WORKER_CONCURRENCY", 1)
	stakingWorkerConcurrency := getEnvInt("STAKING_WORKER_CONCURRENCY", 1)
	dailyBalanceWorkerConcurrency := getEnvInt("DAILY_BALANCE_WORKER_CONCURRENCY", 1)
	defiWorkerConcurrency := getEnvInt("DEFI_WORKER_CONCURRENCY", 1)
	nftItemMetadataWorkerConcurrency := getEnvInt("NFT_ITEM_METADATA_WORKER_CONCURRENCY", 1)
	nftReconcilerConcurrency := getEnvInt("NFT_RECONCILER_CONCURRENCY", 1)

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
	enableDefiWorker := os.Getenv("ENABLE_DEFI_WORKER") != "false"
	enableNFTItemMetadataWorker := os.Getenv("ENABLE_NFT_ITEM_METADATA_WORKER") != "false"
	enableNFTReconciler := os.Getenv("ENABLE_NFT_RECONCILER") != "false"

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
		if enableTokenMetadataWorker {
			processors = append(processors, ingester.NewTokenMetadataWorker(repo, flowClient))
		}
		if enableTxMetricsWorker {
			processors = append(processors, ingester.NewTxMetricsWorker(repo))
		}
		if enableStakingWorker {
			processors = append(processors, ingester.NewStakingWorker(repo))
		}
		if enableDefiWorker {
			processors = append(processors, ingester.NewDefiWorker(repo))
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

	var historyDeriver *ingester.HistoryDeriver
	var onHistoryIndexedRange ingester.RangeCallback
	if enableHistoryDerivers {
		var histProcessors []ingester.Processor
		if enableTokenWorker {
			histProcessors = append(histProcessors, ingester.NewTokenWorker(repo))
		}
		if enableEVMWorker {
			histProcessors = append(histProcessors, ingester.NewEVMWorker(repo))
		}
		if enableTxContractsWorker {
			histProcessors = append(histProcessors, ingester.NewTxContractsWorker(repo))
		}
		if enableAccountsWorker {
			histProcessors = append(histProcessors, ingester.NewAccountsWorker(repo))
		}
		if enableMetaWorker {
			histProcessors = append(histProcessors, ingester.NewMetaWorker(repo, flowClient))
		}
		if enableTokenMetadataWorker {
			histProcessors = append(histProcessors, ingester.NewTokenMetadataWorker(repo, flowClient))
		}
		if enableTxMetricsWorker {
			histProcessors = append(histProcessors, ingester.NewTxMetricsWorker(repo))
		}
		if enableStakingWorker {
			histProcessors = append(histProcessors, ingester.NewStakingWorker(repo))
		}
		if enableDefiWorker {
			histProcessors = append(histProcessors, ingester.NewDefiWorker(repo))
		}

		historyDeriver = ingester.NewHistoryDeriver(repo, histProcessors, ingester.HistoryDeriverConfig{
			ChunkSize: historyDeriverChunk,
			SleepMs:   historyDeriverSleep,
		})

		// Also create a live-style deriver for real-time processing of new history batches.
		// This runs processors immediately as the backward ingester commits each batch,
		// so we don't have to wait for the HistoryDeriver scan to reach those heights.
		historyLiveDeriver := ingester.NewLiveDeriver(repo, histProcessors, ingester.LiveDeriverConfig{
			ChunkSize: liveDeriverChunk,
		})
		historyLiveDeriver.Start(context.Background())
		onHistoryIndexedRange = historyLiveDeriver.NotifyRange
	} else {
		log.Println("History Derivers are DISABLED (ENABLE_HISTORY_DERIVERS=false)")
	}

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
		OnIndexedRange:   onIndexedRange,
	})

	// Backward Ingester (History Backfill)
	backwardIngester := ingester.NewService(historyClient, repo, ingester.Config{
		ServiceName:    "history_ingester",
		BatchSize:      historyBatch,
		WorkerCount:    historyWorkers,
		StartBlock:     startBlock,
		Mode:           "backward",
		MaxReorgDepth:  maxReorgDepth,
		OnIndexedRange: onHistoryIndexedRange,
	})

	var tokenWorkerProcessor *ingester.TokenWorker
	var tokenWorkers []*ingester.AsyncWorker
	var evmWorkerProcessor *ingester.EVMWorker
	var evmWorkers []*ingester.AsyncWorker
	var metaWorkerProcessor *ingester.MetaWorker
	var metaWorkers []*ingester.AsyncWorker
	var accountsWorkerProcessor *ingester.AccountsWorker
	var accountsWorkers []*ingester.AsyncWorker
	var ftHoldingsWorkerProcessor *ingester.FTHoldingsWorker
	var ftHoldingsWorkers []*ingester.AsyncWorker
	var nftOwnershipWorkerProcessor *ingester.NFTOwnershipWorker
	var nftOwnershipWorkers []*ingester.AsyncWorker
	var tokenMetadataWorkerProcessor *ingester.TokenMetadataWorker
	var tokenMetadataWorkers []*ingester.AsyncWorker
	var txContractsWorkerProcessor *ingester.TxContractsWorker
	var txContractsWorkers []*ingester.AsyncWorker
	var txMetricsWorkerProcessor *ingester.TxMetricsWorker
	var txMetricsWorkers []*ingester.AsyncWorker
	var stakingWorkerProcessor *ingester.StakingWorker
	var stakingWorkers []*ingester.AsyncWorker
	var dailyBalanceWorkerProcessor *ingester.DailyBalanceWorker
	var dailyBalanceWorkers []*ingester.AsyncWorker
	var defiWorkerProcessor *ingester.DefiWorker
	var defiWorkers []*ingester.AsyncWorker
	var nftItemMetadataWorkerProcessor *ingester.NFTItemMetadataWorker
	var nftItemMetadataWorkers []*ingester.AsyncWorker
	var nftReconcilerProcessor *ingester.NFTOwnershipReconciler
	var nftReconcilerWorkers []*ingester.AsyncWorker

	workerTypes := make([]string, 0, 10)

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

	if enableEVMWorker {
		evmWorkerProcessor = ingester.NewEVMWorker(repo)
		if evmWorkerConcurrency < 1 {
			evmWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < evmWorkerConcurrency; i++ {
			evmWorkers = append(evmWorkers, ingester.NewAsyncWorker(evmWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: evmWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-evm-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, evmWorkerProcessor.Name())
	} else {
		log.Println("EVM Worker is DISABLED (ENABLE_EVM_WORKER=false)")
	}

	if enableMetaWorker {
		metaWorkerProcessor = ingester.NewMetaWorker(repo, flowClient)
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

	// Downstream workers with dependency enforcement.
	// These workers read from derived tables produced by upstream workers,
	// so they must wait for upstream checkpoints before processing a range.
	tokenWorkerDep := []string{"token_worker"}  // Workers that depend on TokenWorker
	tokenMetaDeps := []string{"token_worker"}    // TokenMetadata reads app.contracts from TokenWorker

	if enableFTHoldingsWorker {
		ftHoldingsWorkerProcessor = ingester.NewFTHoldingsWorker(repo)
		if ftHoldingsWorkerConcurrency < 1 {
			ftHoldingsWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < ftHoldingsWorkerConcurrency; i++ {
			ftHoldingsWorkers = append(ftHoldingsWorkers, ingester.NewAsyncWorker(ftHoldingsWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize:    ftHoldingsWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-ft-holdings-%d", hostname, pid, i),
				Dependencies: tokenWorkerDep,
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
				RangeSize:    nftOwnershipWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-nft-ownership-%d", hostname, pid, i),
				Dependencies: tokenWorkerDep,
			}))
		}
		workerTypes = append(workerTypes, nftOwnershipWorkerProcessor.Name())
	} else {
		log.Println("NFT Ownership Worker is DISABLED (ENABLE_NFT_OWNERSHIP_WORKER=false)")
	}

	if enableTokenMetadataWorker {
		tokenMetadataWorkerProcessor = ingester.NewTokenMetadataWorker(repo, flowClient)
		if tokenMetadataWorkerConcurrency < 1 {
			tokenMetadataWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < tokenMetadataWorkerConcurrency; i++ {
			tokenMetadataWorkers = append(tokenMetadataWorkers, ingester.NewAsyncWorker(tokenMetadataWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize:    tokenMetadataWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-token-metadata-%d", hostname, pid, i),
				Dependencies: tokenMetaDeps,
			}))
		}
		workerTypes = append(workerTypes, tokenMetadataWorkerProcessor.Name())
	} else {
		log.Println("Token Metadata Worker is DISABLED (ENABLE_TOKEN_METADATA_WORKER=false)")
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
				RangeSize:    txContractsWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-tx-contracts-%d", hostname, pid, i),
				Dependencies: tokenWorkerDep,
			}))
		}
		workerTypes = append(workerTypes, txContractsWorkerProcessor.Name())
	} else {
		log.Println("Tx Contracts Worker is DISABLED (ENABLE_TX_CONTRACTS_WORKER=false)")
	}

	if enableTxMetricsWorker {
		txMetricsWorkerProcessor = ingester.NewTxMetricsWorker(repo)
		if txMetricsWorkerConcurrency < 1 {
			txMetricsWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < txMetricsWorkerConcurrency; i++ {
			txMetricsWorkers = append(txMetricsWorkers, ingester.NewAsyncWorker(txMetricsWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: txMetricsWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-tx-metrics-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, txMetricsWorkerProcessor.Name())
	} else {
		log.Println("Tx Metrics Worker is DISABLED (ENABLE_TX_METRICS_WORKER=false)")
	}

	if enableStakingWorker {
		stakingWorkerProcessor = ingester.NewStakingWorker(repo)
		if stakingWorkerConcurrency < 1 {
			stakingWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < stakingWorkerConcurrency; i++ {
			stakingWorkers = append(stakingWorkers, ingester.NewAsyncWorker(stakingWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: stakingWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-staking-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, stakingWorkerProcessor.Name())
	} else {
		log.Println("Staking Worker is DISABLED (ENABLE_STAKING_WORKER=false)")
	}

	if enableDefiWorker {
		defiWorkerProcessor = ingester.NewDefiWorker(repo)
		if defiWorkerConcurrency < 1 {
			defiWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < defiWorkerConcurrency; i++ {
			defiWorkers = append(defiWorkers, ingester.NewAsyncWorker(defiWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize: defiWorkerRange,
				WorkerID:  fmt.Sprintf("%s-%d-defi-%d", hostname, pid, i),
			}))
		}
		workerTypes = append(workerTypes, defiWorkerProcessor.Name())
	} else {
		log.Println("DeFi Worker is DISABLED (ENABLE_DEFI_WORKER=false)")
	}

	if enableDailyBalanceWorker {
		dailyBalanceWorkerProcessor = ingester.NewDailyBalanceWorker(repo)
		if dailyBalanceWorkerConcurrency < 1 {
			dailyBalanceWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < dailyBalanceWorkerConcurrency; i++ {
			dailyBalanceWorkers = append(dailyBalanceWorkers, ingester.NewAsyncWorker(dailyBalanceWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize:    dailyBalanceWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-daily-balance-%d", hostname, pid, i),
				Dependencies: tokenWorkerDep,
			}))
		}
		workerTypes = append(workerTypes, dailyBalanceWorkerProcessor.Name())
	} else {
		log.Println("Daily Balance Worker is DISABLED (ENABLE_DAILY_BALANCE_WORKER=false)")
	}

	nftOwnershipDep := []string{"nft_ownership_worker"}

	if enableNFTItemMetadataWorker {
		nftItemMetadataWorkerProcessor = ingester.NewNFTItemMetadataWorker(repo, flowClient)
		if nftItemMetadataWorkerConcurrency < 1 {
			nftItemMetadataWorkerConcurrency = 1
		}
		hostname, _ := os.Hostname()
		pid := os.Getpid()
		for i := 0; i < nftItemMetadataWorkerConcurrency; i++ {
			nftItemMetadataWorkers = append(nftItemMetadataWorkers, ingester.NewAsyncWorker(nftItemMetadataWorkerProcessor, repo, ingester.WorkerConfig{
				RangeSize:    nftItemMetadataWorkerRange,
				WorkerID:     fmt.Sprintf("%s-%d-nft-item-meta-%d", hostname, pid, i),
				Dependencies: nil, // No dependency — this worker is queue-based (ignores block heights), just needs nft_ownership rows to exist
			}))
		}
		workerTypes = append(workerTypes, nftItemMetadataWorkerProcessor.Name())
	} else {
		log.Println("NFT Item Metadata Worker is DISABLED (ENABLE_NFT_ITEM_METADATA_WORKER=false)")
	}

	if enableNFTReconciler {
		nftReconcilerProcessor = ingester.NewNFTOwnershipReconciler(repo, flowClient)
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

	var committer *ingester.CheckpointCommitter
	if len(workerTypes) > 0 {
		committer = ingester.NewCheckpointCommitter(repo, workerTypes)
	}

	apiServer := api.NewServer(repo, flowClient, apiPort, startBlock)

	// 4. Run
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start live/head derivers (Blockscout-style) if enabled.
	if liveDeriver != nil {
		liveDeriver.Start(ctx)

		// Optional: seed the last N blocks so the UI has data immediately after deploy.
		headBackfillBlocks := getEnvUint("LIVE_DERIVERS_HEAD_BACKFILL_BLOCKS", metaWorkerRange)
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

	if enableEVMWorker {
		for _, worker := range evmWorkers {
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

	if enableTokenMetadataWorker {
		for _, worker := range tokenMetadataWorkers {
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

	if enableTxMetricsWorker {
		for _, worker := range txMetricsWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableStakingWorker {
		for _, worker := range stakingWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableDefiWorker {
		for _, worker := range defiWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

	if enableDailyBalanceWorker {
		for _, worker := range dailyBalanceWorkers {
			wg.Add(1)
			go func(w *ingester.AsyncWorker) {
				defer wg.Done()
				w.Start(ctx)
			}(worker)
		}
	}

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
