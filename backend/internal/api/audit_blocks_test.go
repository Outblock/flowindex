//go:build integration

package api_test

import (
	"context"
	"math"
	"strconv"
	"testing"
	"time"
)

func TestAudit_BlockCrossRef(t *testing.T) {
	if flowClient == nil {
		t.Skip("flowClient not available")
	}

	height, err := strconv.ParseUint(ctx.blockHeight, 10, 64)
	if err != nil {
		t.Fatalf("failed to parse blockHeight %q: %v", ctx.blockHeight, err)
	}

	// Fetch block from our API
	apiBlock := fetchEnvelopeObject(t, "/flow/block/"+ctx.blockHeight)

	// Fetch same block from Flow Access Node
	c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	flowBlock, err := flowClient.GetBlockByHeight(c, height)
	if err != nil {
		t.Fatalf("Flow Access Node GetBlockByHeight(%d) error: %v", height, err)
	}

	// Cross-reference: block ID
	apiID := toString(apiBlock["id"])
	flowID := flowBlock.ID.Hex()
	if apiID != flowID {
		t.Errorf("block ID mismatch: api=%q flow=%q", apiID, flowID)
	}

	// Cross-reference: parent ID
	apiParentID := toString(apiBlock["parent_id"])
	if apiParentID == "" {
		apiParentID = toString(apiBlock["parent_hash"])
	}
	flowParentID := flowBlock.ParentID.Hex()
	if apiParentID != flowParentID {
		t.Errorf("parent ID mismatch: api=%q flow=%q", apiParentID, flowParentID)
	}

	// Cross-reference: height
	apiHeight := uint64(toFloat64(apiBlock["height"]))
	if apiHeight != height {
		t.Errorf("height mismatch: api=%d expected=%d", apiHeight, height)
	}

	// Cross-reference: timestamp (within 2s tolerance)
	apiTimestampStr := toString(apiBlock["timestamp"])
	apiTime, err := time.Parse(time.RFC3339Nano, apiTimestampStr)
	if err != nil {
		t.Fatalf("failed to parse API timestamp %q: %v", apiTimestampStr, err)
	}
	flowTime := flowBlock.Timestamp
	diff := math.Abs(apiTime.Sub(flowTime).Seconds())
	if diff > 2.0 {
		t.Errorf("timestamp mismatch: api=%v flow=%v (diff=%.1fs)", apiTime, flowTime, diff)
	}
}

func TestAudit_BlockTransactionCount(t *testing.T) {
	// Fetch block from API
	apiBlock := fetchEnvelopeObject(t, "/flow/block/"+ctx.blockHeight)
	txCount := int(toFloat64(apiBlock["tx_count"]))

	// Fetch transactions for this block
	txList := fetchEnvelopeList(t, "/flow/block/"+ctx.blockHeight+"/transaction?limit=200")

	// List length should not exceed tx_count
	if len(txList) > txCount {
		t.Errorf("transaction list length %d exceeds tx_count %d", len(txList), txCount)
	}

	// If tx_count > 0, list should not be empty
	if txCount > 0 && len(txList) == 0 {
		t.Errorf("tx_count=%d but transaction list is empty", txCount)
	}
}

func TestAudit_BlockListPagination(t *testing.T) {
	blocks := fetchEnvelopeList(t, "/flow/block?limit=5")

	if len(blocks) == 0 {
		t.Fatal("block list is empty")
	}

	// Verify each block has required fields
	for i, block := range blocks {
		assertFieldsExist(t, block, "id", "height", "timestamp", "tx_count")
		assertTimestamp(t, "block["+strconv.Itoa(i)+"].timestamp", toString(block["timestamp"]))
	}

	// Verify heights are descending
	for i := 1; i < len(blocks); i++ {
		prev := toFloat64(blocks[i-1]["height"])
		curr := toFloat64(blocks[i]["height"])
		if curr >= prev {
			t.Errorf("blocks not descending: block[%d].height=%.0f >= block[%d].height=%.0f", i, curr, i-1, prev)
		}
	}
}
