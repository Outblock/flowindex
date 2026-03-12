package main

import "testing"

func TestNormalizeScheduledOptions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		opts       *ScheduledOptions
		wantBlocks int
		wantErr    bool
	}{
		{name: "nil", opts: nil, wantBlocks: 0},
		{name: "explicit blocks", opts: &ScheduledOptions{AdvanceBlocks: 2}, wantBlocks: 2},
		{name: "seconds imply one block", opts: &ScheduledOptions{AdvanceSeconds: 1.5}, wantBlocks: 1},
		{name: "negative blocks", opts: &ScheduledOptions{AdvanceBlocks: -1}, wantErr: true},
		{name: "too many blocks", opts: &ScheduledOptions{AdvanceBlocks: 21}, wantErr: true},
		{name: "negative seconds", opts: &ScheduledOptions{AdvanceSeconds: -1}, wantErr: true},
		{name: "too many seconds", opts: &ScheduledOptions{AdvanceSeconds: 6}, wantErr: true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			blocks, _, err := normalizeScheduledOptions(tt.opts)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeScheduledOptions returned error: %v", err)
			}
			if blocks != tt.wantBlocks {
				t.Fatalf("expected %d blocks, got %d", tt.wantBlocks, blocks)
			}
		})
	}
}

func TestMergeSimulationResults(t *testing.T) {
	t.Parallel()

	primary := &TxResult{
		TxID:            "primary",
		Success:         true,
		Events:          []TxEvent{{Type: "A.Primary.Event"}},
		ComputationUsed: 10,
	}
	scheduled := []TxResult{
		{
			TxID:            "scheduled-1",
			Success:         true,
			Events:          []TxEvent{{Type: "A.Scheduled.Ok"}},
			ComputationUsed: 20,
		},
		{
			TxID:            "scheduled-2",
			Success:         false,
			Error:           "boom",
			Events:          []TxEvent{{Type: "A.Scheduled.Fail"}},
			ComputationUsed: 30,
		},
	}

	success, errMsg, events, computation := mergeSimulationResults(primary, scheduled)
	if success {
		t.Fatal("expected merged result to fail when a scheduled tx fails")
	}
	if errMsg != "scheduled tx scheduled-2 failed: boom" {
		t.Fatalf("unexpected merged error: %q", errMsg)
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 merged events, got %d", len(events))
	}
	if computation != 60 {
		t.Fatalf("expected computation 60, got %d", computation)
	}
}
