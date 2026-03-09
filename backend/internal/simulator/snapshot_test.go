package simulator

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSnapshotCreateAndRevert(t *testing.T) {
	var createCalled, revertCalled bool
	var revertName string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/emulator/snapshots":
			createCalled = true
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)
			if body["name"] == "" {
				t.Error("snapshot name should not be empty")
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"block_height": "5"})

		case r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/emulator/snapshots/"):
			revertCalled = true
			revertName = strings.TrimPrefix(r.URL.Path, "/emulator/snapshots/")
			w.WriteHeader(http.StatusOK)

		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	ctx := context.Background()

	snapName := "test-snap"
	blockHeight, err := client.CreateSnapshot(ctx, snapName)
	if err != nil {
		t.Fatalf("CreateSnapshot error: %v", err)
	}
	if !createCalled {
		t.Error("expected create snapshot API to be called")
	}
	if blockHeight != "5" {
		t.Errorf("expected block_height=5, got %s", blockHeight)
	}

	err = client.RevertSnapshot(ctx, snapName)
	if err != nil {
		t.Fatalf("RevertSnapshot error: %v", err)
	}
	if !revertCalled {
		t.Error("expected revert snapshot API to be called")
	}
	if revertName != snapName {
		t.Errorf("expected revert name=%s, got %s", snapName, revertName)
	}
}
