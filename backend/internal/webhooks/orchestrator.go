package webhooks

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"flowscan-clone/internal/eventbus"
	"flowscan-clone/internal/webhooks/matcher"
)

// Orchestrator connects the EventBus, SubscriptionCache, Matcher Registry,
// and WebhookDelivery into a pipeline that:
//  1. Receives blockchain events from the EventBus
//  2. Looks up matching subscriptions from the cache
//  3. Evaluates conditions via the matcher registry
//  4. Delivers webhooks via the delivery backend (Svix or noop)
//  5. Logs deliveries in the store
type Orchestrator struct {
	bus      *eventbus.Bus
	cache    *SubscriptionCache
	registry *matcher.Registry
	delivery WebhookDelivery
	store    *Store
	events   chan eventbus.Event
}

// NewOrchestrator creates an Orchestrator and subscribes to all event types
// registered in the matcher registry.
func NewOrchestrator(
	bus *eventbus.Bus,
	cache *SubscriptionCache,
	registry *matcher.Registry,
	delivery WebhookDelivery,
	store *Store,
) *Orchestrator {
	// Buffer the channel so the event bus does not block on slow processing.
	ch := make(chan eventbus.Event, 4096)

	o := &Orchestrator{
		bus:      bus,
		cache:    cache,
		registry: registry,
		delivery: delivery,
		store:    store,
		events:   ch,
	}

	// Subscribe to every event type the registry knows about.
	for _, et := range registry.EventTypes() {
		bus.Subscribe(et, ch)
	}

	return o
}

// Run is the main loop that consumes events until the context is cancelled.
func (o *Orchestrator) Run(ctx context.Context) {
	log.Println("[orchestrator] started")
	for {
		select {
		case <-ctx.Done():
			log.Println("[orchestrator] shutting down")
			return
		case evt := <-o.events:
			o.processEvent(ctx, evt)
		}
	}
}

// processEvent evaluates a single event against all matching subscriptions.
func (o *Orchestrator) processEvent(ctx context.Context, evt eventbus.Event) {
	m := o.registry.Get(evt.Type)
	if m == nil {
		return // no matcher registered for this event type
	}

	subs := o.cache.GetByType(evt.Type)
	if len(subs) == 0 {
		return // no subscriptions for this event type
	}

	for _, sub := range subs {
		if !m.Match(evt.Data, sub.Conditions) {
			continue
		}
		o.deliver(ctx, sub, evt)
	}
}

// deliver sends a webhook for the matched subscription and logs the result.
func (o *Orchestrator) deliver(ctx context.Context, sub Subscription, evt eventbus.Event) {
	payload := map[string]interface{}{
		"event_type":   evt.Type,
		"block_height": evt.Height,
		"timestamp":    evt.Timestamp.UTC().Format(time.RFC3339),
		"data":         evt.Data,
		"_endpoint_id": sub.EndpointID, // used by DirectDelivery for targeted delivery
	}

	// Use the user ID as the Svix application ID (one app per user).
	appID := sub.UserID

	err := o.delivery.SendMessage(ctx, appID, evt.Type, payload)

	statusCode := 200
	svixMsgID := ""
	if err != nil {
		statusCode = 0
		log.Printf("[orchestrator] delivery failed: sub=%s type=%s err=%v", sub.ID, evt.Type, err)
	}

	// Log the delivery attempt.
	payloadJSON, _ := json.Marshal(payload)
	dlLog := &DeliveryLog{
		SubscriptionID: sub.ID,
		EndpointID:     sub.EndpointID,
		EventType:      evt.Type,
		Payload:        payloadJSON,
		StatusCode:     statusCode,
		SvixMsgID:      svixMsgID,
	}

	if logErr := o.store.InsertDeliveryLog(ctx, dlLog); logErr != nil {
		log.Printf("[orchestrator] failed to log delivery: sub=%s err=%v", sub.ID, logErr)
	}
}

// --- PublishFromBlock helpers ---

// PublishFromBlock is called from the ingester callback when a new block is
// processed. It publishes individual events to the bus for each relevant
// data item extracted from the block.
func (o *Orchestrator) PublishFromBlock(
	height uint64,
	timestamp time.Time,
	ftTransfers []interface{},
	nftTransfers []interface{},
	contractEvents []interface{},
	addressActivity []interface{},
	stakingEvents []interface{},
	defiSwaps []interface{},
	defiLiquidity []interface{},
	accountKeyChanges []interface{},
	evmTransactions []interface{},
) {
	for _, item := range ftTransfers {
		o.bus.Publish(eventbus.Event{
			Type:      "ft.transfer",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range nftTransfers {
		o.bus.Publish(eventbus.Event{
			Type:      "nft.transfer",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range contractEvents {
		o.bus.Publish(eventbus.Event{
			Type:      "contract.event",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range addressActivity {
		o.bus.Publish(eventbus.Event{
			Type:      "address.activity",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range stakingEvents {
		o.bus.Publish(eventbus.Event{
			Type:      "staking.event",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range defiSwaps {
		o.bus.Publish(eventbus.Event{
			Type:      "defi.swap",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range defiLiquidity {
		o.bus.Publish(eventbus.Event{
			Type:      "defi.liquidity",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range accountKeyChanges {
		o.bus.Publish(eventbus.Event{
			Type:      "account.key_change",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	for _, item := range evmTransactions {
		o.bus.Publish(eventbus.Event{
			Type:      "evm.transaction",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}

	// Also publish ft.large_transfer for FT transfers (the large transfer
	// matcher will filter based on amount thresholds in conditions).
	for _, item := range ftTransfers {
		o.bus.Publish(eventbus.Event{
			Type:      "ft.large_transfer",
			Height:    height,
			Timestamp: timestamp,
			Data:      item,
		})
	}
}
