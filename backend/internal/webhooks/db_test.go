package webhooks

import "testing"

func TestNewWebhookDB_MissingURL(t *testing.T) {
	_, err := NewWebhookDB("")
	if err == nil {
		t.Fatal("expected error for empty DB URL")
	}
}
