package ingester

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

type Service struct {
	client *flow.Client
	repo   *repository.Repository
	config Config
}

// Callback type for real-time updates
type BlockCallback func(models.Block)
type TxCallback func(models.Transaction)

type Config struct {
	BatchSize        int
	WorkerCount      int
	ServiceName      string
	StartBlock       uint64
	Mode             string // "forward" (default) or "backward"
	OnNewBlock       BlockCallback
	OnNewTransaction TxCallback
}

func NewService(client *flow.Client, repo *repository.Repository, cfg Config) *Service {
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 50
	}
	if cfg.WorkerCount == 0 {
		cfg.WorkerCount = 10
	}
	if cfg.Mode == "" {
		cfg.Mode = "forward"
	}
	return &Service{
		client: client,
		repo:   repo,
		config: cfg,
	}
}

// Start runs the ingestion loop
func (s *Service) Start(ctx context.Context) error {
	log.Printf("Starting %s Ingester in %s mode...", s.config.ServiceName, s.config.Mode)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			// Run one processing cycle
			err := s.process(ctx)
			if err != nil {
				log.Printf("[%s] Error processing batch: %v", s.config.ServiceName, err)
				time.Sleep(10 * time.Second) // Increased backoff on error
				continue
			}

			// If process returns nil, it means we are up to date (live) or finished (history)
			// For Live, we poll every few seconds.
			// For History, if finished, we stop?
			// Checking process() return values... it returns nil when "Done! reached 0" (Backward)
			// or when "startHeight > latestHeight" (Forward).

			// We should sleep a bit to avoid hot loop when up to date.
			time.Sleep(1 * time.Second)
		}
	}
}

func (s *Service) process(ctx context.Context) error {
	lastIndexed, err := s.repo.GetLastIndexedHeight(ctx, s.config.ServiceName)
	if err != nil {
		return err
	}

	var startHeight, endHeight uint64
	var checkpointHeight uint64

	if s.config.Mode == "backward" {
		// --- Backward Mode ---
		// If lastIndexed is 0, we haven't started (or really just started from scratch).
		// We assume we start from Config.StartBlock - 1.
		// But wait, GetLastIndexedHeight returns 0 if no row.
		// If row exists with 0, it means we scanned down to 0 ?
		// For simplicity: If lastIndexed == 0, check if we have a row?
		// repo.GetLastIndexedHeight is simple scan.
		// Let's assume if 0, we start at StartBlock.

		currentTip := lastIndexed
		if currentTip == 0 {
			currentTip = s.config.StartBlock
		}

		if currentTip <= 1 {
			// Done! reached 0 (or 1)
			return nil
		}

		// Define batch: [currentTip - batch, currentTip - 1]
		// But practically: We want to fetch decreasing.
		// Let's settle on: range is [targetStart, targetEnd]
		// targetEnd = currentTip - 1

		targetEnd := currentTip - 1
		targetStart := uint64(0)
		if targetEnd >= uint64(s.config.BatchSize) {
			targetStart = targetEnd - uint64(s.config.BatchSize) + 1
		}

		startHeight = targetStart
		endHeight = targetEnd

		// Next checkpoint will be startHeight (we proved we indexed down to here)
		checkpointHeight = startHeight // Set checkpoint to the bottom of the processed batch
		// If we indexed [100, 109], and we go backwards.
		// Old logic: last indexed = 109.
		// Backward: last indexed = 100. Next we want 99.
		// So checkpoint = min(batch).
		checkpointHeight = startHeight

		log.Printf("[History] Backfilling range %d -> %d (%d blocks)", endHeight, startHeight, endHeight-startHeight+1)

	} else {
		// --- Forward Mode (Default) ---
		// 2. Determine Chain Tip
		latestHeight, err := s.client.GetLatestBlockHeight(ctx)
		if err != nil {
			return err
		}

		// 3. Decide Start Height
		if lastIndexed > 0 {
			startHeight = lastIndexed + 1
		} else if s.config.StartBlock > 0 {
			startHeight = s.config.StartBlock
		} else {
			startHeight = latestHeight - 100 // Fallback
		}

		// 4. Check if we need to run
		if startHeight > latestHeight {
			return nil
		}

		// 5. Define Batch
		endHeight = startHeight + uint64(s.config.BatchSize) - 1
		if endHeight > latestHeight {
			endHeight = latestHeight
		}

		if startHeight == latestHeight {
			endHeight = startHeight // Real-time
		} else {
			log.Printf("[Live] Syncing range %d -> %d (%d blocks, behind: %d)", startHeight, endHeight, endHeight-startHeight+1, latestHeight-endHeight)
		}

		// Checkpoint is the highest block
		checkpointHeight = endHeight
	}

	// 6. Execute Batch Fetch
	results, err := s.fetchBatchParallel(ctx, startHeight, endHeight)
	if err != nil {
		return err
	}

	// 7. Save Batch
	if err := s.saveBatch(ctx, results, checkpointHeight); err != nil {
		return err
	}

	return nil
}

func (s *Service) fetchBatchParallel(ctx context.Context, start, end uint64) ([]*FetchResult, error) {
	total := int(end - start + 1)
	results := make([]*FetchResult, total)

	var wg sync.WaitGroup
	sem := make(chan struct{}, s.config.WorkerCount) // Semaphore for concurrency control

	worker := NewWorker(s.client)
	var errOnce sync.Once
	var firstErr error

	for i := 0; i < total; i++ {
		height := start + uint64(i)
		idx := i

		sem <- struct{}{} // Acquire
		wg.Add(1)

		go func() {
			defer wg.Done()
			defer func() { <-sem }() // Release

			// Stop if error already occurred
			if firstErr != nil {
				return
			}

			res := worker.FetchBlockData(ctx, height)
			if res.Error != nil {
				errOnce.Do(func() {
					firstErr = res.Error
				})
				return
			}
			results[idx] = res // Safe because idx is unique per goroutine
		}()
	}

	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	return results, nil
}

func (s *Service) saveBatch(ctx context.Context, results []*FetchResult, checkpointHeight uint64) error {
	// Filter out any nils (shouldn't be any if no error)
	var blocks []*models.Block
	var txs []models.Transaction
	var events []models.Event
	var addrActivity []models.AddressTransaction
	var tokenTransfers []models.TokenTransfer
	var accountKeys []models.AccountKey

	// Ensure sorted by height (should be already, but safety first)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Height < results[j].Height
	})

	for _, res := range results {
		if res == nil || res.Block == nil {
			continue
		}

		// Trigger Callbacks (Real-time updates)
		// Only trigger callbacks if we are in Forward mode (Live)
		// Or maybe even backward? Users might want to see history fill up.
		// For now, let's trigger always.
		if s.config.OnNewBlock != nil {
			s.config.OnNewBlock(*res.Block)
		}
		if s.config.OnNewTransaction != nil {
			for _, tx := range res.Transactions {
				s.config.OnNewTransaction(tx)
			}
		}

		blocks = append(blocks, res.Block)
		txs = append(txs, res.Transactions...)
		events = append(events, res.Events...)
		addrActivity = append(addrActivity, res.AddressActivity...)
		tokenTransfers = append(tokenTransfers, res.TokenTransfers...)
		accountKeys = append(accountKeys, res.AccountKeys...)
	}

	// Use the atomic batch save
	return s.repo.SaveBatch(ctx, blocks, txs, events, addrActivity, tokenTransfers, accountKeys, s.config.ServiceName, checkpointHeight)
}
