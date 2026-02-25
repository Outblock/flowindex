package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	includeRanges := false
	if q := r.URL.Query().Get("include_ranges"); q == "1" || q == "true" {
		includeRanges = true
	}

	now := time.Now()
	if includeRanges {
		s.statusRangesCache.mu.Lock()
		if now.Before(s.statusRangesCache.expiresAt) && len(s.statusRangesCache.payload) > 0 {
			cached := append([]byte(nil), s.statusRangesCache.payload...)
			s.statusRangesCache.mu.Unlock()
			w.Write(cached)
			return
		}
		s.statusRangesCache.mu.Unlock()
	} else {
		s.statusCache.mu.Lock()
		if now.Before(s.statusCache.expiresAt) && len(s.statusCache.payload) > 0 {
			cached := append([]byte(nil), s.statusCache.payload...)
			s.statusCache.mu.Unlock()
			w.Write(cached)
			return
		}
		s.statusCache.mu.Unlock()
	}

	payload, err := s.buildStatusPayload(r.Context(), includeRanges)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if includeRanges {
		s.statusRangesCache.mu.Lock()
		s.statusRangesCache.payload = payload
		s.statusRangesCache.expiresAt = time.Now().Add(5 * time.Minute)
		s.statusRangesCache.mu.Unlock()
	} else {
		s.statusCache.mu.Lock()
		s.statusCache.payload = payload
		s.statusCache.expiresAt = time.Now().Add(10 * time.Second)
		s.statusCache.mu.Unlock()
	}

	w.Write(payload)
}

func (s *Server) buildStatusPayload(ctx context.Context, includeRanges bool) ([]byte, error) {
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

	// Get indexed height from DB (Forward Tip)
	lastIndexed, err := s.repo.GetLastIndexedHeight(ctx, "main_ingester")
	if err != nil {
		lastIndexed = 0
	}

	// Get history height from DB (Backward Tip)
	historyIndexed, err := s.repo.GetLastIndexedHeight(ctx, "history_ingester")
	if err != nil {
		historyIndexed = 0
	}

	// Get Real Block Range (Min/Max/Count in DB)
	minH, maxH, totalBlocks, err := s.repo.GetBlockRange(ctx)
	if err != nil {
		minH = 0
		maxH = 0
		totalBlocks = 0
	}

	checkpoints, err := s.repo.GetAllCheckpoints(ctx)
	if err != nil {
		checkpoints = map[string]uint64{}
	}

	totalEvents, err := s.repo.GetTotalEvents(ctx)
	if err != nil {
		totalEvents = 0
	}
	totalAddresses, err := s.repo.GetTotalAddresses(ctx)
	if err != nil {
		totalAddresses = 0
	}
	totalContracts, err := s.repo.GetTotalContracts(ctx)
	if err != nil {
		totalContracts = 0
	}

	forwardEnabled := os.Getenv("ENABLE_FORWARD_INGESTER") != "false"
	historyEnabled := os.Getenv("ENABLE_HISTORY_INGESTER") != "false"
	workerEnabled := map[string]bool{
		"main_ingester":            forwardEnabled,
		"history_ingester":         historyEnabled,
		"token_worker":             os.Getenv("ENABLE_TOKEN_WORKER") != "false",
		"evm_worker":               os.Getenv("ENABLE_EVM_WORKER") != "false",
		"meta_worker":              os.Getenv("ENABLE_META_WORKER") != "false",
		"accounts_worker":          os.Getenv("ENABLE_ACCOUNTS_WORKER") != "false",
		"ft_holdings_worker":       os.Getenv("ENABLE_FT_HOLDINGS_WORKER") != "false",
		"nft_ownership_worker":     os.Getenv("ENABLE_NFT_OWNERSHIP_WORKER") != "false",
		"token_metadata_worker":    os.Getenv("ENABLE_TOKEN_METADATA_WORKER") != "false",
		"tx_contracts_worker":      os.Getenv("ENABLE_TX_CONTRACTS_WORKER") != "false",
		"tx_metrics_worker":        os.Getenv("ENABLE_TX_METRICS_WORKER") != "false",
		"staking_worker":           os.Getenv("ENABLE_STAKING_WORKER") != "false",
		"defi_worker":              os.Getenv("ENABLE_DEFI_WORKER") != "false",
		"daily_balance_worker":     os.Getenv("ENABLE_DAILY_BALANCE_WORKER") != "false",
		"nft_item_metadata_worker": os.Getenv("ENABLE_NFT_ITEM_METADATA_WORKER") != "false",
		"nft_ownership_reconciler": os.Getenv("ENABLE_NFT_OWNERSHIP_RECONCILER") != "false",
	}

	workerConfig := map[string]map[string]interface{}{
		"main_ingester": {
			"workers":    getEnvInt("LATEST_WORKER_COUNT", 1),
			"batch_size": getEnvInt("LATEST_BATCH_SIZE", 1),
		},
		"history_ingester": {
			"workers":    getEnvInt("HISTORY_WORKER_COUNT", 1),
			"batch_size": getEnvInt("HISTORY_BATCH_SIZE", 1),
		},
		"token_worker": {
			"concurrency": getEnvInt("TOKEN_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("TOKEN_WORKER_RANGE", 1000),
		},
		"evm_worker": {
			"concurrency": getEnvInt("EVM_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("EVM_WORKER_RANGE", 1000),
		},
		"meta_worker": {
			"concurrency": getEnvInt("META_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("META_WORKER_RANGE", 1000),
		},
		"accounts_worker": {
			"concurrency": getEnvInt("ACCOUNTS_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("ACCOUNTS_WORKER_RANGE", 1000),
		},
		"ft_holdings_worker": {
			"concurrency": getEnvInt("FT_HOLDINGS_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("FT_HOLDINGS_WORKER_RANGE", 1000),
		},
		"nft_ownership_worker": {
			"concurrency": getEnvInt("NFT_OWNERSHIP_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("NFT_OWNERSHIP_WORKER_RANGE", 1000),
		},
		"token_metadata_worker": {
			"concurrency": getEnvInt("TOKEN_METADATA_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("TOKEN_METADATA_WORKER_RANGE", 1000),
		},
		"tx_contracts_worker": {
			"concurrency": getEnvInt("TX_CONTRACTS_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("TX_CONTRACTS_WORKER_RANGE", 1000),
		},
		"tx_metrics_worker": {
			"concurrency": getEnvInt("TX_METRICS_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("TX_METRICS_WORKER_RANGE", 1000),
		},
		"staking_worker": {
			"concurrency": getEnvInt("STAKING_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("STAKING_WORKER_RANGE", 1000),
		},
		"defi_worker": {
			"concurrency": getEnvInt("DEFI_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("DEFI_WORKER_RANGE", 1000),
		},
		"daily_balance_worker": {
			"concurrency": getEnvInt("DAILY_BALANCE_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("DAILY_BALANCE_WORKER_RANGE", 1000),
		},
		"nft_item_metadata_worker": {
			"concurrency": getEnvInt("NFT_ITEM_METADATA_WORKER_CONCURRENCY", 1),
			"range":       getEnvUint("NFT_ITEM_METADATA_WORKER_RANGE", 1000),
		},
		"nft_ownership_reconciler": {
			"concurrency": getEnvInt("NFT_OWNERSHIP_RECONCILER_CONCURRENCY", 1),
			"range":       getEnvUint("NFT_OWNERSHIP_RECONCILER_RANGE", 1000),
		},
	}

	// Get latest block height from Flow (bounded latency)
	latestHeight := maxH
	{
		var cachedHeight uint64
		s.latestHeightCache.mu.Lock()
		cachedHeight = s.latestHeightCache.height
		s.latestHeightCache.mu.Unlock()

		ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		defer cancel()
		if h, err := s.client.GetLatestBlockHeight(ctx); err == nil {
			latestHeight = h
			s.latestHeightCache.mu.Lock()
			s.latestHeightCache.height = h
			s.latestHeightCache.updatedAt = time.Now()
			s.latestHeightCache.mu.Unlock()
		} else if cachedHeight > 0 {
			latestHeight = cachedHeight
		} else if lastIndexed > latestHeight {
			latestHeight = lastIndexed
		}
	}

	// Calculate Progress relative to StartBlock
	progress := 0.0
	start := s.startBlock

	totalRange := 0.0
	if latestHeight > start {
		totalRange = float64(latestHeight - start)
	}

	indexedRange := 0.0
	if lastIndexed > start {
		indexedRange = float64(lastIndexed - start)
	}

	if lastIndexed < start {
		indexedRange = 0
	}

	if totalRange > 0 {
		progress = (indexedRange / totalRange) * 100
	}

	// Cap at 100%
	if progress > 100 {
		progress = 100
	}
	if progress < 0 {
		progress = 0
	}

	// Get total transactions
	totalTxs, err := s.repo.GetTotalTransactions(ctx)
	if err != nil {
		totalTxs = 0
	}

	behind := uint64(0)
	if latestHeight > lastIndexed {
		behind = latestHeight - lastIndexed
	}

	historyHeight := historyIndexed
	if historyHeight == 0 {
		historyHeight = minH
	}

	indexedRanges := make([]interface{}, 0)
	if includeRanges {
		// Only compute indexed_ranges for pages that need the mosaic.
		// This query can be expensive under DB load.
		ranges, err := s.repo.GetIndexedRanges(ctx)
		if err == nil {
			indexedRanges = make([]interface{}, 0, len(ranges))
			for _, r := range ranges {
				indexedRanges = append(indexedRanges, r)
			}
		}
	}

	// Get oldest block timestamp
	var oldestBlockTimestamp *string
	if minH > 0 {
		if ts, err := s.repo.GetBlockTimestamp(ctx, minH); err == nil {
			formatted := ts.UTC().Format(time.RFC3339)
			oldestBlockTimestamp = &formatted
		}
	}

	// Get timestamps for all worker checkpoint heights
	checkpointTimestamps := map[string]string{}
	if len(checkpoints) > 0 {
		heightSet := make(map[uint64]struct{})
		for _, h := range checkpoints {
			if h > 0 {
				heightSet[h] = struct{}{}
			}
		}
		heights := make([]uint64, 0, len(heightSet))
		for h := range heightSet {
			heights = append(heights, h)
		}
		if tsMap, err := s.repo.GetBlockTimestamps(ctx, heights); err == nil {
			for name, h := range checkpoints {
				if ts, ok := tsMap[h]; ok {
					checkpointTimestamps[name] = ts.UTC().Format(time.RFC3339)
				}
			}
		}
	}

	// Error summary (non-blocking — ok if it fails)
	var errorSummary interface{}
	if es, err := s.repo.GetErrorSummary(ctx); err == nil {
		errorSummary = es
	}

	resp := map[string]interface{}{
		"chain_id":               "flow",
		"latest_height":          latestHeight,
		"indexed_height":         lastIndexed,
		"history_height":         historyHeight,
		"min_height":             minH,
		"max_height":             maxH,
		"total_blocks":           totalBlocks,
		"start_height":           start,
		"total_transactions":     totalTxs,
		"total_events":           totalEvents,
		"total_addresses":        totalAddresses,
		"total_contracts":        totalContracts,
		"checkpoints":            checkpoints,
		"forward_enabled":        forwardEnabled,
		"history_enabled":        historyEnabled,
		"worker_enabled":         workerEnabled,
		"worker_config":          workerConfig,
		"generated_at":           time.Now().UTC().Format(time.RFC3339),
		"progress":               fmt.Sprintf("%.2f%%", progress),
		"behind":                 behind,
		"status":                 "ok",
		"indexed_ranges":         indexedRanges,
		"oldest_block_timestamp": oldestBlockTimestamp,
		"checkpoint_timestamps":  checkpointTimestamps,
		"error_summary":          errorSummary,
	}

	payload, err := json.Marshal(resp)
	if err != nil {
		return nil, err
	}

	return payload, nil
}
