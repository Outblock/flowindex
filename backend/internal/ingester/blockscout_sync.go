package ingester

import (
	"context"
	"encoding/hex"
	"encoding/json"
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

	contracts, err := s.client.FetchVerifiedContracts(ctx, since)
	if err != nil {
		log.Printf("[blockscout_sync] fetch contracts error: %v", err)
	}
	if len(contracts) == 0 {
		log.Printf("[blockscout_sync] contracts: 0 new (since=%s)", since)
		return
	}

	var rows []repository.EVMContractRow
	for _, c := range contracts {
		addr := hexToBytes(c.Address.Hash)
		if addr == nil {
			continue
		}

		var implAddr []byte
		if len(c.Address.Implementations) > 0 {
			implAddr = hexToBytes(c.Address.Implementations[0].Address)
		}

		var abiJSON json.RawMessage
		if len(c.ABI) > 0 && string(c.ABI) != "null" {
			abiJSON = c.ABI
		}

		var verifiedAt *time.Time
		if c.VerifiedAt != "" {
			if t, err := time.Parse(time.RFC3339Nano, c.VerifiedAt); err == nil {
				verifiedAt = &t
			}
		}

		name := c.Name
		if name == "" {
			name = c.Address.Name
		}

		rows = append(rows, repository.EVMContractRow{
			Address:      addr,
			Name:         name,
			ABI:          abiJSON,
			SourceCode:   c.SourceCode,
			Compiler:     c.CompilerVersion,
			Language:     c.Language,
			License:      c.LicenseType,
			Optimization: c.OptimizationEnabled,
			ProxyType:    c.Address.ProxyType,
			ImplAddress:  implAddr,
			VerifiedAt:   verifiedAt,
		})
	}

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
