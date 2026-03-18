package webhooks

import (
	"context"
	"log"
	"strings"
	"time"

	"flowscan-clone/internal/eventbus"
	"flowscan-clone/internal/repository"
)

// WebhookProcessor implements ingester.Processor. It runs as part of the
// LiveDeriver pipeline (after token_worker) to read derived token transfers,
// raw transactions, and raw events, then publishes them to the event bus
// for webhook delivery.
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
	published := 0
	var ts time.Time

	// --- FT/NFT transfers (derived by token_worker) ---
	ftTransfers, err := p.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, false)
	if err != nil {
		return err
	}
	nftTransfers, err := p.repo.GetTokenTransfersByRange(ctx, fromHeight, toHeight, true)
	if err != nil {
		return err
	}

	if len(ftTransfers) > 0 {
		ts = ftTransfers[0].Timestamp
	} else if len(nftTransfers) > 0 {
		ts = nftTransfers[0].Timestamp
	}

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

	// --- Raw transactions → address.activity ---
	txs, err := p.repo.GetRawTransactionsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		log.Printf("[webhook_processor] failed to read transactions: %v", err)
	} else {
		for i := range txs {
			if ts.IsZero() {
				ts = txs[i].Timestamp
			}
			p.bus.Publish(eventbus.Event{
				Type:      "address.activity",
				Height:    txs[i].BlockHeight,
				Timestamp: txs[i].Timestamp,
				Data:      &txs[i],
			})
			published++
		}
	}

	// --- Raw events → account.created + account.key_change + contract.event ---
	events, err := p.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		log.Printf("[webhook_processor] failed to read events: %v", err)
	} else {
		for i := range events {
			if ts.IsZero() {
				ts = events[i].Timestamp
			}
			// Account creation events
			if events[i].Type == "flow.AccountCreated" {
				p.bus.Publish(eventbus.Event{
					Type:      "account.created",
					Height:    events[i].BlockHeight,
					Timestamp: events[i].Timestamp,
					Data:      &events[i],
				})
				published++
			}
			// Account key events
			if strings.Contains(events[i].EventName, "KeyAdded") ||
				strings.Contains(events[i].EventName, "KeyRevoked") {
				p.bus.Publish(eventbus.Event{
					Type:      "account.key_change",
					Height:    events[i].BlockHeight,
					Timestamp: events[i].Timestamp,
					Data:      &events[i],
				})
				published++
			}
			// Contract events (contract.event catches all Cadence events)
			if events[i].ContractAddress != "" && events[i].EventName != "" {
				p.bus.Publish(eventbus.Event{
					Type:      "contract.event",
					Height:    events[i].BlockHeight,
					Timestamp: events[i].Timestamp,
					Data:      &events[i],
				})
				published++
			}
		}
	}

	if published > 0 {
		log.Printf("[webhook_processor] published %d events for range [%d,%d) ts=%s",
			published, fromHeight, toHeight, ts.Format(time.RFC3339))
	}

	return nil
}
