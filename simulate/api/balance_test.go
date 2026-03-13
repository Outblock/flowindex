package main

import (
	"encoding/json"
	"math/big"
	"testing"
)

func TestBuildBalanceChangesIncludesBeforeAndAfter(t *testing.T) {
	t.Parallel()

	events := []TxEvent{
		{
			Type: "A.1654653399040a61.FlowToken.TokensWithdrawn",
			Payload: json.RawMessage(`{
				"type":"Event",
				"value":{"fields":[
					{"name":"amount","value":{"type":"UFix64","value":"10.0"}},
					{"name":"from","value":{"type":"Optional","value":{"type":"Address","value":"0x1654653399040a61"}}}
				]}
			}`),
		},
		{
			Type: "A.1654653399040a61.FlowToken.TokensDeposited",
			Payload: json.RawMessage(`{
				"type":"Event",
				"value":{"fields":[
					{"name":"amount","value":{"type":"UFix64","value":"10.0"}},
					{"name":"to","value":{"type":"Optional","value":{"type":"Address","value":"0x54919e809e115e5e"}}}
				]}
			}`),
		},
	}

	parsed := parseBalanceChanges(events)
	post := map[balanceKey]string{
		{Address: "1654653399040a61", Token: "FlowToken", ContractAddress: "1654653399040a61"}: "90.0",
		{Address: "54919e809e115e5e", Token: "FlowToken", ContractAddress: "1654653399040a61"}: "10.0",
	}

	changes := buildBalanceChanges(parsed, post)
	if len(changes) != 2 {
		t.Fatalf("expected 2 balance changes, got %d", len(changes))
	}

	var sender, receiver *BalanceChange
	for i := range changes {
		switch changes[i].Address {
		case "1654653399040a61":
			sender = &changes[i]
		case "54919e809e115e5e":
			receiver = &changes[i]
		}
	}

	if sender == nil || receiver == nil {
		t.Fatalf("expected both sender and receiver balance changes: %#v", changes)
	}

	if sender.Before != "100.0" || sender.After != "90.0" || sender.Delta != "-10.0" {
		t.Fatalf("unexpected sender change: %#v", *sender)
	}
	if receiver.Before != "0.0" || receiver.After != "10.0" || receiver.Delta != "10.0" {
		t.Fatalf("unexpected receiver change: %#v", *receiver)
	}
}

func TestDecodeCadenceStringUFix64Dictionary(t *testing.T) {
	t.Parallel()

	raw := json.RawMessage(`{
		"type":"Dictionary",
		"value":[
			{
				"key":{"type":"String","value":"A.1654653399040a61.FlowToken.Vault"},
				"value":{"type":"UFix64","value":"90.0"}
			},
			{
				"key":{"type":"String","value":"A.f233dcee88fe0abe.ExampleToken.Vault"},
				"value":{"type":"UFix64","value":"1.25"}
			}
		]
	}`)

	balances, err := decodeCadenceStringUFix64Dictionary(raw)
	if err != nil {
		t.Fatalf("decodeCadenceStringUFix64Dictionary returned error: %v", err)
	}

	if balances["A.1654653399040a61.FlowToken.Vault"] != "90.0" {
		t.Fatalf("unexpected FlowToken balance: %#v", balances)
	}
	if balances["A.f233dcee88fe0abe.ExampleToken.Vault"] != "1.25" {
		t.Fatalf("unexpected ExampleToken balance: %#v", balances)
	}
}

func TestBuildBalanceChangesUsesAfterHintWithoutPostLookup(t *testing.T) {
	t.Parallel()

	changes := buildBalanceChanges([]parsedBalanceChange{
		{
			Address:         "1654653399040a61",
			Token:           "FlowToken",
			ContractAddress: "1654653399040a61",
			DeltaScaled:     big.NewInt(-1_00000000),
			AfterHint:       "90.0",
		},
	}, nil)

	if len(changes) != 1 {
		t.Fatalf("expected 1 balance change, got %d", len(changes))
	}
	if changes[0].Before != "91.0" || changes[0].After != "90.0" || changes[0].Delta != "-1.0" {
		t.Fatalf("unexpected balance change: %#v", changes[0])
	}
}

func TestParseBalanceChangesUsesFungibleTokenHints(t *testing.T) {
	t.Parallel()

	events := []TxEvent{
		{
			Type: "A.f233dcee88fe0abe.FungibleToken.Withdrawn",
			Payload: json.RawMessage(`{
				"type":"Event",
				"value":{"fields":[
					{"name":"type","value":{"type":"String","value":"A.1654653399040a61.FlowToken.Vault"}},
					{"name":"amount","value":{"type":"UFix64","value":"10.0"}},
					{"name":"from","value":{"type":"Optional","value":{"type":"Address","value":"0x1654653399040a61"}}},
					{"name":"balanceAfter","value":{"type":"UFix64","value":"90.0"}}
				]}
			}`),
		},
		{
			Type: "A.f233dcee88fe0abe.FungibleToken.Deposited",
			Payload: json.RawMessage(`{
				"type":"Event",
				"value":{"fields":[
					{"name":"type","value":{"type":"String","value":"A.1654653399040a61.FlowToken.Vault"}},
					{"name":"amount","value":{"type":"UFix64","value":"10.0"}},
					{"name":"to","value":{"type":"Optional","value":{"type":"Address","value":"0x54919e809e115e5e"}}},
					{"name":"balanceAfter","value":{"type":"UFix64","value":"10.0"}}
				]}
			}`),
		},
	}

	changes := parseBalanceChanges(events)
	if len(changes) != 2 {
		t.Fatalf("expected 2 balance changes, got %d", len(changes))
	}

	var sender, receiver *parsedBalanceChange
	for i := range changes {
		switch changes[i].Address {
		case "1654653399040a61":
			sender = &changes[i]
		case "54919e809e115e5e":
			receiver = &changes[i]
		}
	}

	if sender == nil || receiver == nil {
		t.Fatalf("expected both sender and receiver changes: %#v", changes)
	}
	if sender.Token != "FlowToken" || sender.ContractAddress != "1654653399040a61" || sender.AfterHint != "90.0" {
		t.Fatalf("unexpected sender change: %#v", *sender)
	}
	if receiver.Token != "FlowToken" || receiver.ContractAddress != "1654653399040a61" || receiver.AfterHint != "10.0" {
		t.Fatalf("unexpected receiver change: %#v", *receiver)
	}
	if formatScaledAmount(sender.DeltaScaled) != "-10.0" {
		t.Fatalf("unexpected sender delta: %s", formatScaledAmount(sender.DeltaScaled))
	}
	if formatScaledAmount(receiver.DeltaScaled) != "10.0" {
		t.Fatalf("unexpected receiver delta: %s", formatScaledAmount(receiver.DeltaScaled))
	}
}

func TestUniqueBalanceAddressesNeedingLookupSkipsHints(t *testing.T) {
	t.Parallel()

	addresses := uniqueBalanceAddressesNeedingLookup([]parsedBalanceChange{
		{Address: "1654653399040a61", AfterHint: "90.0"},
		{Address: "e467b9dd11fa00df"},
		{Address: "e467b9dd11fa00df"},
	})

	if len(addresses) != 1 || addresses[0] != "e467b9dd11fa00df" {
		t.Fatalf("unexpected lookup addresses: %#v", addresses)
	}
}
