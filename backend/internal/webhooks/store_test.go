package webhooks

import (
	"encoding/json"
	"testing"
)

func TestSubscription_JSON(t *testing.T) {
	s := Subscription{
		ID:         "sub-1",
		UserID:     "user-1",
		EndpointID: "ep-1",
		EventType:  "ft.transfer",
		Conditions: json.RawMessage(`{"min_amount":"100"}`),
		IsEnabled:  true,
	}

	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}

	var decoded Subscription
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.EventType != "ft.transfer" {
		t.Errorf("expected ft.transfer, got %s", decoded.EventType)
	}
}

func TestEndpoint_JSON(t *testing.T) {
	e := Endpoint{
		ID:       "ep-1",
		UserID:   "user-1",
		SvixEpID: "svix_ep_123",
		URL:      "https://example.com/webhook",
		IsActive: true,
	}

	data, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}

	var decoded Endpoint
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.URL != "https://example.com/webhook" {
		t.Errorf("expected URL, got %s", decoded.URL)
	}
}

func TestAPIKey_PrefixGeneration(t *testing.T) {
	key := GenerateAPIKey()
	if len(key) < 32 {
		t.Errorf("API key too short: %d", len(key))
	}
	prefix := APIKeyPrefix(key)
	if len(prefix) != 12 {
		t.Errorf("expected prefix length 12, got %d", len(prefix))
	}
	if prefix != key[:12] {
		t.Errorf("prefix mismatch")
	}
}
