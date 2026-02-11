package ingester

import (
	"context"
	"log"
	"time"

	"flowscan-clone/internal/repository"
)

// CheckpointCommitter runs gently in the background to:
// 1. Advance worker checkpoints (contiguous range rule)
// 2. Reap expired leases (crashed workers)
// 3. Detect gaps in lease coverage
// 4. Alert on permanently failed (dead letter) leases
type CheckpointCommitter struct {
	repo          *repository.Repository
	workerTypes   []string
	lastGapScan   time.Time
	lastReapCheck time.Time
}

func NewCheckpointCommitter(repo *repository.Repository, workerTypes []string) *CheckpointCommitter {
	return &CheckpointCommitter{
		repo:        repo,
		workerTypes: workerTypes,
	}
}

func (c *CheckpointCommitter) Start(ctx context.Context) {
	log.Printf("[Committer] Starting Checkpoint Committer for %v", c.workerTypes)
	go c.runLoop(ctx)
}

func (c *CheckpointCommitter) runLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[Committer] Stopping...")
			return
		case <-ticker.C:
			c.advanceAllCheckpoints(ctx)

			// Reap expired leases every 30 seconds
			if time.Since(c.lastReapCheck) > 30*time.Second {
				c.reapExpiredLeases(ctx)
				c.lastReapCheck = time.Now()
			}

			// Run gap detection + dead letter check every 60 seconds
			if time.Since(c.lastGapScan) > 60*time.Second {
				c.detectGaps(ctx)
				c.detectDeadLeases(ctx)
				c.lastGapScan = time.Now()
			}
		}
	}
}

func (c *CheckpointCommitter) advanceAllCheckpoints(ctx context.Context) {
	for _, wType := range c.workerTypes {
		oldH, _ := c.repo.GetLastIndexedHeight(ctx, wType)

		newH, err := c.repo.AdvanceCheckpointSafe(ctx, wType)
		if err != nil {
			log.Printf("[Committer] Failed to advance checkpoint for %s: %v", wType, err)
			continue
		}

		if newH > oldH {
			log.Printf("[Committer] Advanced %s checkpoint from %d -> %d", wType, oldH, newH)
		}
	}
}

// reapExpiredLeases recovers leases from workers that crashed (OOM, panic, etc.)
// without marking their lease as FAILED. These show up as ACTIVE but past expiry.
func (c *CheckpointCommitter) reapExpiredLeases(ctx context.Context) {
	reaped, err := c.repo.ReapExpiredLeases(ctx)
	if err != nil {
		log.Printf("[Committer] Failed to reap expired leases: %v", err)
		return
	}
	if reaped > 0 {
		log.Printf("[Committer] Reaped %d expired leases (worker crash recovery)", reaped)
	}
}

// detectGaps checks each worker type for missing ranges between COMPLETED leases.
func (c *CheckpointCommitter) detectGaps(ctx context.Context) {
	for _, wType := range c.workerTypes {
		gaps, err := c.repo.DetectLeaseGaps(ctx, wType)
		if err != nil {
			log.Printf("[Committer] Gap detection failed for %s: %v", wType, err)
			continue
		}
		for _, g := range gaps {
			log.Printf("[Committer] GAP DETECTED: %s missing range [%d, %d)", wType, g.From, g.To)
		}
	}
}

// detectDeadLeases alerts on permanently failed leases (attempt >= 20).
// These block checkpoint advancement and require manual intervention.
func (c *CheckpointCommitter) detectDeadLeases(ctx context.Context) {
	dead, err := c.repo.CountDeadLeases(ctx)
	if err != nil {
		log.Printf("[Committer] Dead lease check failed: %v", err)
		return
	}
	for _, d := range dead {
		log.Printf("[Committer] CRITICAL: Dead lease %s [%d, %d) after %d attempts — checkpoint is BLOCKED. Manual reset required.",
			d.WorkerType, d.FromHeight, d.ToHeight, d.Attempt)
	}
}
