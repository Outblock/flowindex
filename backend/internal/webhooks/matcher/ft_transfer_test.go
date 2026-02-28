package matcher

import (
	"encoding/json"
	"testing"

	"flowscan-clone/internal/models"
)

func TestFTTransferMatcher_MatchAddress(t *testing.T) {
	m := &FTTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress:          "0xabc",
		ToAddress:            "0xdef",
		Amount:               "100.0",
		TokenContractAddress: "A.1654653399040a61.FlowToken",
		IsNFT:                false,
	}

	// Match sender (out)
	cond := json.RawMessage(`{"addresses":["0xabc"],"direction":"out"}`)
	if !m.Match(tt, cond).Matched {
		t.Error("should match sender with direction=out")
	}

	// Should NOT match receiver with direction=out
	cond = json.RawMessage(`{"addresses":["0xdef"],"direction":"out"}`)
	if m.Match(tt, cond).Matched {
		t.Error("should not match receiver with direction=out")
	}

	// Match receiver (in)
	cond = json.RawMessage(`{"addresses":["0xdef"],"direction":"in"}`)
	if !m.Match(tt, cond).Matched {
		t.Error("should match receiver with direction=in")
	}

	// Match either (both)
	cond = json.RawMessage(`{"addresses":["0xabc"],"direction":"both"}`)
	if !m.Match(tt, cond).Matched {
		t.Error("should match with direction=both")
	}

	// No match
	cond = json.RawMessage(`{"addresses":["0x999"]}`)
	if m.Match(tt, cond).Matched {
		t.Error("should not match unknown address")
	}
}

func TestFTTransferMatcher_MatchMinAmount(t *testing.T) {
	m := &FTTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress: "0xabc",
		ToAddress:   "0xdef",
		Amount:      "500.5",
		IsNFT:       false,
	}

	cond := json.RawMessage(`{"min_amount":100.0}`)
	if !m.Match(tt, cond).Matched {
		t.Error("500.5 should be >= 100.0")
	}

	cond = json.RawMessage(`{"min_amount":1000.0}`)
	if m.Match(tt, cond).Matched {
		t.Error("500.5 should not be >= 1000.0")
	}
}

func TestFTTransferMatcher_MatchToken(t *testing.T) {
	m := &FTTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress:          "0xabc",
		ToAddress:            "0xdef",
		Amount:               "10.0",
		TokenContractAddress: "A.1654653399040a61.FlowToken",
		IsNFT:                false,
	}

	cond := json.RawMessage(`{"token_contract":"A.1654653399040a61.FlowToken"}`)
	if !m.Match(tt, cond).Matched {
		t.Error("should match token contract")
	}

	cond = json.RawMessage(`{"token_contract":"A.0000.FUSD"}`)
	if m.Match(tt, cond).Matched {
		t.Error("should not match wrong token contract")
	}
}

func TestFTTransferMatcher_EmptyConditions(t *testing.T) {
	m := &FTTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress: "0xabc",
		ToAddress:   "0xdef",
		Amount:      "10.0",
		IsNFT:       false,
	}

	// Empty conditions = match all FT transfers
	if !m.Match(tt, json.RawMessage(`{}`)).Matched {
		t.Error("empty conditions should match")
	}
	if !m.Match(tt, nil).Matched {
		t.Error("nil conditions should match")
	}
}

func TestFTTransferMatcher_RejectsNFT(t *testing.T) {
	m := &FTTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress: "0xabc",
		ToAddress:   "0xdef",
		Amount:      "1",
		IsNFT:       true,
	}
	if m.Match(tt, json.RawMessage(`{}`)).Matched {
		t.Error("FT matcher should reject NFT transfers")
	}
}
