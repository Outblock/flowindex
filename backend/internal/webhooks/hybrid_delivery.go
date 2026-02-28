package webhooks

import (
	"context"
	"log"
)

// HybridDelivery routes webhook delivery based on endpoint type:
//   - Discord/Slack webhooks → DirectDelivery (rich formatting, per-endpoint targeting)
//   - Generic webhooks → Svix (retries, signing, delivery logs)
//
// It also syncs application/endpoint CRUD to Svix so the Svix portal stays current.
type HybridDelivery struct {
	svix   *SvixClient
	direct *DirectDelivery
	store  *Store
}

var _ WebhookDelivery = (*HybridDelivery)(nil)

func NewHybridDelivery(svix *SvixClient, direct *DirectDelivery, store *Store) *HybridDelivery {
	return &HybridDelivery{svix: svix, direct: direct, store: store}
}

func (h *HybridDelivery) CreateApplication(ctx context.Context, appID, name string) (string, error) {
	// Sync to Svix for portal access
	id, err := h.svix.CreateApplication(ctx, appID, name)
	if err != nil {
		log.Printf("[hybrid] svix CreateApplication failed: %v (continuing)", err)
		return appID, nil
	}
	return id, nil
}

func (h *HybridDelivery) CreateEndpoint(ctx context.Context, appID, webhookURL string) (string, error) {
	if isDiscordWebhook(webhookURL) || isSlackWebhook(webhookURL) {
		// Discord/Slack go through DirectDelivery only — Svix can't format these
		return h.direct.CreateEndpoint(ctx, appID, webhookURL)
	}
	// Generic webhooks go through Svix for retries + signing
	id, err := h.svix.CreateEndpoint(ctx, appID, webhookURL)
	if err != nil {
		log.Printf("[hybrid] svix CreateEndpoint failed: %v (falling back to direct)", err)
		return h.direct.CreateEndpoint(ctx, appID, webhookURL)
	}
	return id, nil
}

func (h *HybridDelivery) SendMessage(ctx context.Context, appID, eventType string, payload map[string]interface{}) error {
	// Check if we have a specific endpoint_id in the payload (per-endpoint targeting)
	if epID, ok := payload["_endpoint_id"].(string); ok && epID != "" {
		ep, err := h.store.GetEndpointByID(ctx, epID)
		if err != nil {
			return h.direct.SendMessage(ctx, appID, eventType, payload)
		}

		if isDiscordWebhook(ep.URL) || isSlackWebhook(ep.URL) {
			// Discord/Slack → DirectDelivery for rich formatting
			return h.direct.SendMessage(ctx, appID, eventType, payload)
		}

		// Generic webhook → Svix for retries + signing
		// Strip internal fields before sending to Svix
		clean := make(map[string]interface{}, len(payload))
		for k, v := range payload {
			if k[0] != '_' {
				clean[k] = v
			}
		}
		if err := h.svix.SendMessage(ctx, appID, eventType, clean); err != nil {
			log.Printf("[hybrid] svix SendMessage failed: %v (falling back to direct)", err)
			return h.direct.SendMessage(ctx, appID, eventType, payload)
		}
		return nil
	}

	// No specific endpoint — broadcast via DirectDelivery (it iterates all endpoints)
	return h.direct.SendMessage(ctx, appID, eventType, payload)
}

func (h *HybridDelivery) DeleteEndpoint(ctx context.Context, appID, endpointID string) error {
	// Try Svix first, ignore errors
	if err := h.svix.DeleteEndpoint(ctx, appID, endpointID); err != nil {
		log.Printf("[hybrid] svix DeleteEndpoint failed: %v (continuing)", err)
	}
	return h.direct.DeleteEndpoint(ctx, appID, endpointID)
}
