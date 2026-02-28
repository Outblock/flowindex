package webhooks

import (
	"context"
	"log"
	"time"

	"flowscan-clone/internal/eventbus"
	"flowscan-clone/internal/repository"
)

// WebhookProcessor implements ingester.Processor. It runs as part of the
// LiveDeriver pipeline (after token_worker) to read derived token transfers
// and publish them to the event bus for webhook delivery.
type WebhookProcessor struct {
	repo *repository.Repository
	bus  *eventbus.Bus
}

func NewWebhookProcessor(repo *repository.Repository, bus *eventbus.Bus) *WebhookProcessor {
	return &WebhookProcessor{repo: repo, bus: bus}
}

func (p *WebhookProcessor) Name() string {
	return "webhook_processor"
}

func (p *WebhookProcessor) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// Read FT transfers derived by token_worker
	ftTransfers, err := p.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, false)
	if err != nil {
		return err
	}

	// Read NFT transfers derived by token_worker
	nftTransfers, err := p.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, true)
	if err != nil {
		return err
	}

	if len(ftTransfers) == 0 && len(nftTransfers) == 0 {
		return nil
	}

	// Determine block timestamp (use first transfer's timestamp as approximation)
	var ts time.Time
	if len(ftTransfers) > 0 {
		ts = ftTransfers[0].Timestamp
	} else if len(nftTransfers) > 0 {
		ts = nftTransfers[0].Timestamp
	}

	published := 0

	for i := range ftTransfers {
		p.bus.Publish(eventbus.Event{
			Type:      "ft.transfer",
			Height:    ftTransfers[i].BlockHeight,
			Timestamp: ftTransfers[i].Timestamp,
			Data:      &ftTransfers[i],
		})
		// Also publish as ft.large_transfer (matcher filters by amount threshold)
		p.bus.Publish(eventbus.Event{
			Type:      "ft.large_transfer",
			Height:    ftTransfers[i].BlockHeight,
			Timestamp: ftTransfers[i].Timestamp,
			Data:      &ftTransfers[i],
		})
		published++
	}

	for i := range nftTransfers {
		p.bus.Publish(eventbus.Event{
			Type:      "nft.transfer",
			Height:    nftTransfers[i].BlockHeight,
			Timestamp: nftTransfers[i].Timestamp,
			Data:      &nftTransfers[i],
		})
		published++
	}

	if published > 0 {
		log.Printf("[webhook_processor] published %d events for range [%d,%d) ts=%s",
			published, fromHeight, toHeight, ts.Format(time.RFC3339))
	}

	return nil
}
