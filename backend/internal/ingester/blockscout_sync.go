package ingester

import (
	"context"
	"encoding/hex"
	"log"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/repository"
)

// BlockscoutSync periodically syncs verified contract metadata and address
// labels from a Blockscout v2 instance into the local database.
type BlockscoutSync struct {
	client   *blockscoutClient
	repo     *repository.Repository
	interval time.Duration
}

func NewBlockscoutSync(repo *repository.Repository, intervalMin int) *BlockscoutSync {
	if intervalMin <= 0 {
		intervalMin = 60
	}
	return &BlockscoutSync{
		client:   newBlockscoutClient(),
		repo:     repo,
		interval: time.Duration(intervalMin) * time.Minute,
	}
}

func (s *BlockscoutSync) Start(ctx context.Context) {
	log.Printf("[blockscout_sync] Starting (interval=%s, url=%s)", s.interval, s.client.baseURL)

	s.run(ctx)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[blockscout_sync] Stopping")
			return
		case <-ticker.C:
			s.run(ctx)
		}
	}
}

func (s *BlockscoutSync) run(ctx context.Context) {
	fetchCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	s.syncVerifiedContracts(fetchCtx)
	s.syncAddressLabels(fetchCtx)
}

func (s *BlockscoutSync) syncVerifiedContracts(ctx context.Context) {
	// Get the latest verified_at we already have for incremental sync
	since, err := s.repo.GetLatestEVMContractVerifiedAt(ctx)
	if err != nil {
		log.Printf("[blockscout_sync] failed to get latest verified_at: %v", err)
		since = ""
	}

	// Phase 1: Get list of new verified contracts (no ABI/source in list response)
	listItems, err := s.client.FetchVerifiedContractsList(ctx, since)
	if err != nil {
		log.Printf("[blockscout_sync] fetch contracts list error: %v", err)
	}
	if len(listItems) == 0 {
		log.Printf("[blockscout_sync] contracts: 0 new (since=%s)", since)
		return
	}

	log.Printf("[blockscout_sync] contracts: %d new, fetching details...", len(listItems))

	// Phase 2: Fetch full detail (ABI + source) for each contract, concurrency-limited
	const concurrency = 5
	sem := make(chan struct{}, concurrency)
	var mu sync.Mutex
	var rows []repository.EVMContractRow

	var wg sync.WaitGroup
	for _, item := range listItems {
		addrHash := item.Address.Hash

		wg.Add(1)
		sem <- struct{}{}
		go func(item blockscoutSmartContractListItem) {
			defer wg.Done()
			defer func() { <-sem }()

			detail, err := s.client.FetchContractDetail(ctx, addrHash)
			if err != nil {
				log.Printf("[blockscout_sync] fetch detail for %s error: %v", addrHash, err)
				// Fall back to list-level data (no ABI/source)
				detail = nil
			}

			addr := hexToBytes(addrHash)
			if addr == nil {
				return
			}

			row := repository.EVMContractRow{
				Address:      addr,
				Name:         item.Name,
				Compiler:     item.CompilerVersion,
				Language:     item.Language,
				License:      item.LicenseType,
				Optimization: item.OptimizationEnabled,
				ProxyType:    item.Address.ProxyType,
			}

			if item.Name == "" {
				row.Name = item.Address.Name
			}

			if len(item.Address.Implementations) > 0 {
				row.ImplAddress = hexToBytes(item.Address.Implementations[0].Address)
			}

			if item.VerifiedAt != "" {
				if t, err := time.Parse(time.RFC3339Nano, item.VerifiedAt); err == nil {
					row.VerifiedAt = &t
				}
			}

			// Enrich with detail data (ABI + source)
			if detail != nil {
				if len(detail.ABI) > 0 && string(detail.ABI) != "null" {
					row.ABI = detail.ABI
				}
				row.SourceCode = detail.SourceCode
				if detail.ProxyType != "" {
					row.ProxyType = detail.ProxyType
				}
				if len(detail.Implementations) > 0 {
					row.ImplAddress = hexToBytes(detail.Implementations[0].Address)
				}
			}

			mu.Lock()
			rows = append(rows, row)
			mu.Unlock()
		}(item)
	}
	wg.Wait()

	if len(rows) > 0 {
		if err := s.repo.UpsertEVMContracts(ctx, rows); err != nil {
			log.Printf("[blockscout_sync] upsert contracts error: %v", err)
		} else {
			log.Printf("[blockscout_sync] contracts: upserted %d", len(rows))
		}
	}
}

func (s *BlockscoutSync) syncAddressLabels(ctx context.Context) {
	addresses, err := s.repo.GetUnlabeledEVMAddresses(ctx, 500)
	if err != nil {
		log.Printf("[blockscout_sync] get unlabeled addresses error: %v", err)
		return
	}
	if len(addresses) == 0 {
		log.Println("[blockscout_sync] labels: 0 addresses to sync")
		return
	}

	log.Printf("[blockscout_sync] labels: fetching %d addresses", len(addresses))

	// Concurrency-limited fetch
	const concurrency = 5
	sem := make(chan struct{}, concurrency)
	var mu sync.Mutex
	var rows []repository.EVMAddressLabelRow

	var wg sync.WaitGroup
	for _, addrBytes := range addresses {
		addrHex := hex.EncodeToString(addrBytes)

		wg.Add(1)
		sem <- struct{}{}
		go func(addrHex string, addrBytes []byte) {
			defer wg.Done()
			defer func() { <-sem }()

			info, err := s.client.FetchAddress(ctx, addrHex)
			if err != nil {
				log.Printf("[blockscout_sync] fetch address 0x%s error: %v", addrHex, err)
				return
			}
			if info == nil {
				return
			}

			var tags []string
			for _, t := range info.PublicTags {
				if t.Label != "" {
					tags = append(tags, t.Label)
				}
			}

			row := repository.EVMAddressLabelRow{
				Address:    addrBytes,
				Name:       info.Name,
				Tags:       tags,
				IsContract: info.IsContract,
				IsVerified: info.IsVerified,
			}
			if info.Token != nil {
				row.TokenName = info.Token.Name
				row.TokenSymbol = info.Token.Symbol
			}

			mu.Lock()
			rows = append(rows, row)
			mu.Unlock()
		}(addrHex, addrBytes)
	}
	wg.Wait()

	if len(rows) > 0 {
		if err := s.repo.UpsertEVMAddressLabels(ctx, rows); err != nil {
			log.Printf("[blockscout_sync] upsert labels error: %v", err)
		} else {
			log.Printf("[blockscout_sync] labels: upserted %d", len(rows))
		}
	}
}

func hexToBytes(s string) []byte {
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	if s == "" {
		return nil
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}
