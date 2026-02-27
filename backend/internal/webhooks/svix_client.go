package webhooks

import (
	"context"
	"fmt"
	"log"
	"net/url"

	svix "github.com/svix/svix-webhooks/go"
	"github.com/svix/svix-webhooks/go/models"
)

// WebhookDelivery defines the interface for webhook delivery backends.
// This allows swapping Svix for a different provider or a mock in tests.
type WebhookDelivery interface {
	// CreateApplication creates a Svix application for a user.
	// The appID parameter is used as the Svix application UID so we can
	// look it up later without storing the Svix-generated ID.
	CreateApplication(ctx context.Context, appID, name string) (string, error)

	// CreateEndpoint registers a webhook URL under the given application.
	CreateEndpoint(ctx context.Context, appID, webhookURL string) (string, error)

	// SendMessage dispatches a webhook message to all endpoints registered
	// under the given application that match the event type.
	SendMessage(ctx context.Context, appID, eventType string, payload map[string]interface{}) error

	// DeleteEndpoint removes an endpoint from the given application.
	DeleteEndpoint(ctx context.Context, appID, endpointID string) error
}

// SvixClient wraps the Svix Go SDK to implement WebhookDelivery.
type SvixClient struct {
	client *svix.Svix
}

// Compile-time check that SvixClient implements WebhookDelivery.
var _ WebhookDelivery = (*SvixClient)(nil)

// NewSvixClient creates a new SvixClient. If serverURL is empty, the default
// Svix cloud endpoint is used.
func NewSvixClient(authToken, serverURL string) (*SvixClient, error) {
	var opts *svix.SvixOptions
	if serverURL != "" {
		u, err := url.Parse(serverURL)
		if err != nil {
			return nil, fmt.Errorf("parse svix server url: %w", err)
		}
		opts = &svix.SvixOptions{ServerUrl: u}
	}

	client, err := svix.New(authToken, opts)
	if err != nil {
		return nil, fmt.Errorf("create svix client: %w", err)
	}

	return &SvixClient{client: client}, nil
}

// CreateApplication creates (or gets) a Svix application for the given user.
// We use appID as the Svix UID so the application can be found by user ID.
func (s *SvixClient) CreateApplication(ctx context.Context, appID, name string) (string, error) {
	uid := appID
	app, err := s.client.Application.GetOrCreate(ctx, models.ApplicationIn{
		Name: name,
		Uid:  &uid,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("svix create application: %w", err)
	}
	log.Printf("[svix] application created/found: id=%s uid=%v name=%s", app.Id, safeStr(app.Uid), app.Name)
	return app.Id, nil
}

// CreateEndpoint registers a webhook endpoint URL under the given application.
func (s *SvixClient) CreateEndpoint(ctx context.Context, appID, webhookURL string) (string, error) {
	ep, err := s.client.Endpoint.Create(ctx, appID, models.EndpointIn{
		Url: webhookURL,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("svix create endpoint: %w", err)
	}
	log.Printf("[svix] endpoint created: id=%s app=%s url=%s", ep.Id, appID, webhookURL)
	return ep.Id, nil
}

// SendMessage dispatches a webhook message through Svix.
func (s *SvixClient) SendMessage(ctx context.Context, appID, eventType string, payload map[string]interface{}) error {
	msg, err := s.client.Message.Create(ctx, appID, models.MessageIn{
		EventType: eventType,
		Payload:   payload,
	}, nil)
	if err != nil {
		return fmt.Errorf("svix send message: %w", err)
	}
	log.Printf("[svix] message sent: id=%s app=%s type=%s", msg.Id, appID, eventType)
	return nil
}

// DeleteEndpoint removes an endpoint from the given application.
func (s *SvixClient) DeleteEndpoint(ctx context.Context, appID, endpointID string) error {
	if err := s.client.Endpoint.Delete(ctx, appID, endpointID); err != nil {
		return fmt.Errorf("svix delete endpoint: %w", err)
	}
	log.Printf("[svix] endpoint deleted: id=%s app=%s", endpointID, appID)
	return nil
}

// NoopDelivery is a no-op implementation of WebhookDelivery for use when
// Svix is not configured. It logs messages but does not actually deliver them.
type NoopDelivery struct{}

var _ WebhookDelivery = (*NoopDelivery)(nil)

func (n *NoopDelivery) CreateApplication(_ context.Context, appID, name string) (string, error) {
	log.Printf("[webhooks/noop] create application: uid=%s name=%s", appID, name)
	return appID, nil
}

func (n *NoopDelivery) CreateEndpoint(_ context.Context, appID, webhookURL string) (string, error) {
	log.Printf("[webhooks/noop] create endpoint: app=%s url=%s", appID, webhookURL)
	return "noop-ep-" + appID, nil
}

func (n *NoopDelivery) SendMessage(_ context.Context, appID, eventType string, payload map[string]interface{}) error {
	log.Printf("[webhooks/noop] send message: app=%s type=%s", appID, eventType)
	return nil
}

func (n *NoopDelivery) DeleteEndpoint(_ context.Context, appID, endpointID string) error {
	log.Printf("[webhooks/noop] delete endpoint: app=%s ep=%s", appID, endpointID)
	return nil
}

func safeStr(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
