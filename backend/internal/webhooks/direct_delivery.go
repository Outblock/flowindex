package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// DirectDelivery implements WebhookDelivery by POSTing directly to endpoint URLs
// stored in the database. This is used when Svix is not configured.
type DirectDelivery struct {
	store  *Store
	client *http.Client
}

var _ WebhookDelivery = (*DirectDelivery)(nil)

func NewDirectDelivery(store *Store) *DirectDelivery {
	return &DirectDelivery{
		store: store,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (d *DirectDelivery) CreateApplication(_ context.Context, appID, name string) (string, error) {
	return appID, nil
}

func (d *DirectDelivery) CreateEndpoint(_ context.Context, appID, webhookURL string) (string, error) {
	return "direct-" + appID, nil
}

// SendMessage looks up the endpoint URL and POSTs the payload.
// appID is the user ID; the payload should contain endpoint_id for targeted delivery.
// If endpoint_id is present in the payload, it delivers to that specific endpoint.
// Otherwise, it falls back to sending to all active endpoints for the user.
func (d *DirectDelivery) SendMessage(ctx context.Context, appID, eventType string, payload map[string]interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	// Check if we have a specific endpoint_id in the payload
	if epID, ok := payload["_endpoint_id"].(string); ok && epID != "" {
		ep, err := d.store.GetEndpointByID(ctx, epID)
		if err != nil {
			return fmt.Errorf("get endpoint %s: %w", epID, err)
		}
		if !ep.IsActive {
			return fmt.Errorf("endpoint %s is not active", epID)
		}
		return d.postToURL(ctx, ep.URL, body, eventType)
	}

	// Fallback: send to all active endpoints for the user
	endpoints, err := d.store.ListEndpoints(ctx, appID)
	if err != nil {
		return fmt.Errorf("list endpoints for user %s: %w", appID, err)
	}

	var lastErr error
	for _, ep := range endpoints {
		if !ep.IsActive {
			continue
		}
		if err := d.postToURL(ctx, ep.URL, body, eventType); err != nil {
			log.Printf("[direct_delivery] failed to POST to %s: %v", ep.URL, err)
			lastErr = err
		}
	}
	return lastErr
}

func (d *DirectDelivery) DeleteEndpoint(_ context.Context, appID, endpointID string) error {
	return nil
}

func (d *DirectDelivery) postToURL(ctx context.Context, url string, body []byte, eventType string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-FlowIndex-Event", eventType)

	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("POST %s returned %d", url, resp.StatusCode)
	}

	log.Printf("[direct_delivery] delivered to %s: %d", url, resp.StatusCode)
	return nil
}
