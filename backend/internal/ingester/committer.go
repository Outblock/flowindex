package ingester

import (
	"context"
	"log"
	"time"

	"flowscan-clone/internal/repository"
)

// CheckpointCommitter runs gently in the background to advance checkpoints
// strictly adhering to the "Contiguous Range" rule.
type CheckpointCommitter struct {
	repo        *repository.Repository
	workerTypes []string
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
