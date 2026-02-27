package matcher

import (
	"encoding/json"
	"testing"

	"flowscan-clone/internal/models"
)

func TestLargeTransferMatcher_RequiresMinAmount(t *testing.T) {
	m := &LargeTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress: "0xabc",
		ToAddress:   "0xdef",
		Amount:      "99999.0",
		IsNFT:       false,
	}

	// Without min_amount -> should not match
	if m.Match(tt, json.RawMessage(`{}`)) {
		t.Error("should require min_amount")
	}

	// With min_amount -> should match
	if !m.Match(tt, json.RawMessage(`{"min_amount":1000.0}`)) {
		t.Error("should match with min_amount")
	}

	// Below min_amount
	if m.Match(tt, json.RawMessage(`{"min_amount":100000.0}`)) {
		t.Error("should not match below threshold")
	}
}

func TestNFTTransferMatcher_Basic(t *testing.T) {
	m := &NFTTransferMatcher{}
	tt := &models.TokenTransfer{
		FromAddress:          "0xabc",
		ToAddress:            "0xdef",
		TokenContractAddress: "A.0b2a3299cc857e29.TopShot",
		TokenID:              "12345",
		IsNFT:                true,
	}

	// Match collection
	if !m.Match(tt, json.RawMessage(`{"collection":"A.0b2a3299cc857e29.TopShot"}`)) {
		t.Error("should match collection")
	}

	// Match token_ids
	if !m.Match(tt, json.RawMessage(`{"token_ids":["12345","99999"]}`)) {
		t.Error("should match token_id")
	}

	// Reject non-NFT
	ft := &models.TokenTransfer{IsNFT: false, Amount: "10.0"}
	if m.Match(ft, json.RawMessage(`{}`)) {
		t.Error("should reject FT transfer")
	}
}

func TestAddressActivityMatcher_Roles(t *testing.T) {
	m := &AddressActivityMatcher{}
	tx := &models.Transaction{
		ProposerAddress: "0xaaa",
		PayerAddress:    "0xbbb",
		Authorizers:     []string{"0xccc", "0xddd"},
	}

	// Match proposer
	if !m.Match(tx, json.RawMessage(`{"addresses":["0xaaa"],"roles":["PROPOSER"]}`)) {
		t.Error("should match proposer")
	}

	// Payer role should not match proposer address
	if m.Match(tx, json.RawMessage(`{"addresses":["0xaaa"],"roles":["PAYER"]}`)) {
		t.Error("should not match proposer with PAYER role filter")
	}

	// Match authorizer
	if !m.Match(tx, json.RawMessage(`{"addresses":["0xccc"],"roles":["AUTHORIZER"]}`)) {
		t.Error("should match authorizer")
	}

	// All roles (no filter)
	if !m.Match(tx, json.RawMessage(`{"addresses":["0xbbb"]}`)) {
		t.Error("should match payer with no role filter")
	}
}

func TestContractEventMatcher_Basic(t *testing.T) {
	m := &ContractEventMatcher{}
	evt := &models.Event{
		ContractAddress: "0x1654653399040a61",
		EventName:       "TokensDeposited",
		Type:            "A.1654653399040a61.FlowToken.TokensDeposited",
	}

	if !m.Match(evt, json.RawMessage(`{"contract_address":"0x1654653399040a61"}`)) {
		t.Error("should match contract address")
	}

	if !m.Match(evt, json.RawMessage(`{"contract_address":"0x1654653399040a61","event_names":["TokensDeposited"]}`)) {
		t.Error("should match contract + event name")
	}

	if m.Match(evt, json.RawMessage(`{"contract_address":"0x1654653399040a61","event_names":["TokensWithdrawn"]}`)) {
		t.Error("should not match wrong event name")
	}
}

func TestStakingEventMatcher_Basic(t *testing.T) {
	m := &StakingEventMatcher{}
	se := &models.StakingEvent{
		EventType: "DelegatorStaked",
		NodeID:    "node-123",
		Amount:    "5000.0",
	}

	if !m.Match(se, json.RawMessage(`{"event_types":["DelegatorStaked"]}`)) {
		t.Error("should match event type")
	}

	if m.Match(se, json.RawMessage(`{"node_id":"node-999"}`)) {
		t.Error("should not match wrong node_id")
	}

	if !m.Match(se, json.RawMessage(`{"min_amount":1000.0}`)) {
		t.Error("5000 should be >= 1000")
	}
}

func TestDefiSwapMatcher_Basic(t *testing.T) {
	m := &DefiSwapMatcher{}
	de := &models.DefiEvent{
		EventType: "Swap",
		PairID:    "pair-1",
		Maker:     "0xmaker",
		Asset0In:  "100.0",
		Asset0Out: "0",
		Asset1In:  "0",
		Asset1Out: "200.0",
	}

	if !m.Match(de, json.RawMessage(`{"pair_id":"pair-1"}`)) {
		t.Error("should match pair_id")
	}

	if !m.Match(de, json.RawMessage(`{"addresses":["0xmaker"]}`)) {
		t.Error("should match maker address")
	}

	if !m.Match(de, json.RawMessage(`{"min_amount":150.0}`)) {
		t.Error("max asset amount is 200.0, should be >= 150")
	}

	// Non-swap should not match
	de2 := &models.DefiEvent{EventType: "Add"}
	if m.Match(de2, json.RawMessage(`{}`)) {
		t.Error("should not match non-Swap events")
	}
}

func TestDefiLiquidityMatcher_Basic(t *testing.T) {
	m := &DefiLiquidityMatcher{}
	de := &models.DefiEvent{
		EventType: "Add",
		PairID:    "pair-1",
	}

	if !m.Match(de, json.RawMessage(`{"pair_id":"pair-1","event_type":"Add"}`)) {
		t.Error("should match Add liquidity")
	}

	if m.Match(de, json.RawMessage(`{"event_type":"Remove"}`)) {
		t.Error("should not match Remove when event is Add")
	}

	// Swap should not match
	swap := &models.DefiEvent{EventType: "Swap"}
	if m.Match(swap, json.RawMessage(`{}`)) {
		t.Error("should not match Swap events")
	}
}

func TestAccountKeyChangeMatcher_Basic(t *testing.T) {
	m := &AccountKeyChangeMatcher{}

	keyAdded := &models.Event{
		EventName:       "KeyAdded",
		ContractAddress: "0xaccount1",
	}
	if !m.Match(keyAdded, json.RawMessage(`{"addresses":["0xaccount1"]}`)) {
		t.Error("should match KeyAdded for address")
	}

	keyRevoked := &models.Event{
		EventName:       "KeyRevoked",
		ContractAddress: "0xaccount2",
	}
	if !m.Match(keyRevoked, json.RawMessage(`{}`)) {
		t.Error("should match KeyRevoked with no address filter")
	}

	// Non-key event should not match
	other := &models.Event{
		EventName:       "TokensDeposited",
		ContractAddress: "0xaccount1",
	}
	if m.Match(other, json.RawMessage(`{}`)) {
		t.Error("should not match non-key events")
	}
}

func TestEVMTransactionMatcher_Basic(t *testing.T) {
	m := &EVMTransactionMatcher{}
	etx := &models.EVMTransaction{
		FromAddress: "0xfrom",
		ToAddress:   "0xto",
		Value:       "1000000000000000000",
	}

	if !m.Match(etx, json.RawMessage(`{"from":"0xfrom"}`)) {
		t.Error("should match from address")
	}

	if !m.Match(etx, json.RawMessage(`{"to":"0xto"}`)) {
		t.Error("should match to address")
	}

	if m.Match(etx, json.RawMessage(`{"from":"0xother"}`)) {
		t.Error("should not match wrong from address")
	}

	if !m.Match(etx, json.RawMessage(`{"min_value":1000.0}`)) {
		t.Error("1e18 should be >= 1000")
	}
}
