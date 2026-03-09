//go:build integration

package api_test

import (
	"encoding/json"
	"strconv"
	"testing"
)

func TestAudit_NFTList(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/nft?limit=10")
	if len(items) == 0 {
		t.Skip("no NFT collections returned")
	}

	for i, item := range items {
		label := "nft[" + strconv.Itoa(i) + "]"

		// Each collection should have a valid identifier
		id := toString(item["id"])
		assertNonEmpty(t, label+".id", id)
		assertTokenIdentifier(t, id)

		// Required fields
		name := toString(item["name"])
		if name == "" {
			// Some collections may use contract_name instead
			name = toString(item["contract_name"])
		}
		if name == "" {
			t.Errorf("%s: expected non-empty name or contract_name", label)
		}
	}
}

func TestAudit_NFTDetailMatchesList(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/nft?limit=1")
	if len(items) == 0 {
		t.Skip("no NFT collections returned")
	}

	first := items[0]
	id := toString(first["id"])
	assertNonEmpty(t, "first.id", id)

	// Fetch detail by identifier
	detailItems := fetchEnvelopeList(t, "/flow/nft/"+id)
	if len(detailItems) == 0 {
		t.Fatalf("NFT detail for %s returned empty array", id)
	}
	detail := detailItems[0]

	// Name should match between list and detail
	listName := toString(first["name"])
	detailName := toString(detail["name"])
	if listName != "" && detailName != "" && listName != detailName {
		t.Errorf("name mismatch: list=%q detail=%q", listName, detailName)
	}

	// ID should match
	detailID := toString(detail["id"])
	if detailID != id {
		t.Errorf("id mismatch: list=%q detail=%q", id, detailID)
	}
}

func TestAudit_NFTTransfers(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/nft/transfer?limit=10")
	if len(items) == 0 {
		t.Skip("no NFT transfers returned")
	}

	for i, item := range items {
		label := "transfer[" + strconv.Itoa(i) + "]"

		// Required fields
		assertFieldsExist(t, item, "transaction_hash", "nft_type", "timestamp")

		// transaction_hash should be non-empty
		assertNonEmpty(t, label+".transaction_hash", toString(item["transaction_hash"]))

		// nft_type should be a valid token identifier
		nftType := toString(item["nft_type"])
		assertNonEmpty(t, label+".nft_type", nftType)
		assertTokenIdentifier(t, nftType)

		// sender and receiver — at least one should be present (mint/burn may have empty sender/receiver)
		sender := toString(item["sender"])
		receiver := toString(item["receiver"])
		if sender == "" && receiver == "" {
			t.Errorf("%s: both sender and receiver are empty", label)
		}
		if sender != "" {
			assertFlowAddress(t, sender)
		}
		if receiver != "" {
			assertFlowAddress(t, receiver)
		}

		// Timestamp should be valid
		assertTimestamp(t, label+".timestamp", toString(item["timestamp"]))
	}
}

func TestAudit_NFTHoldings(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/nft/"+ctx.nftCollection+"/holding?limit=10")
	if len(items) == 0 {
		t.Skip("no NFT holdings returned for " + ctx.nftCollection)
	}

	for i, item := range items {
		label := "holding[" + strconv.Itoa(i) + "]"

		// Each holding should have an address (owner)
		addr := toString(item["address"])
		if addr == "" {
			addr = toString(item["owner"])
		}
		if addr == "" {
			t.Errorf("%s: expected address or owner field", label)
			continue
		}
		assertFlowAddress(t, addr)

		// Count should be positive
		count := toFloat64(item["count"])
		if count <= 0 {
			// Try "quantity" or "balance"
			count = toFloat64(item["quantity"])
			if count <= 0 {
				count = toFloat64(item["balance"])
			}
		}
		if count <= 0 {
			t.Errorf("%s: expected positive count, got %.0f", label, count)
		}
	}
}

func TestAudit_NFTItems(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/nft/"+ctx.nftCollection+"/item?limit=10")
	if len(items) == 0 {
		t.Skip("no NFT items returned for " + ctx.nftCollection)
	}

	for i, item := range items {
		label := "item[" + strconv.Itoa(i) + "]"

		// Each item should have nft_id
		nftID := toString(item["nft_id"])
		if nftID == "" {
			nftID = toString(item["id"])
		}
		if nftID == "" {
			t.Errorf("%s: expected nft_id or id field", label)
		}
	}

	// Fetch first item detail and verify ID matches
	firstID := toString(items[0]["nft_id"])
	if firstID == "" {
		firstID = toString(items[0]["id"])
	}
	if firstID == "" {
		t.Skip("first item has no nft_id or id to fetch detail")
	}

	detailItems := fetchEnvelopeList(t, "/flow/nft/"+ctx.nftCollection+"/item/"+firstID)
	if len(detailItems) == 0 {
		t.Fatalf("NFT item detail for %s/%s returned empty", ctx.nftCollection, firstID)
	}
	detail := detailItems[0]
	detailID := toString(detail["nft_id"])
	if detailID == "" {
		detailID = toString(detail["id"])
	}
	if detailID != firstID {
		t.Errorf("item detail ID mismatch: list=%q detail=%q", firstID, detailID)
	}
}

func TestAudit_NFTStats(t *testing.T) {
	// NFT stats might be returned as an envelope or bare object — try both
	url := ctx.baseURL + "/flow/nft/stats"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /flow/nft/stats error: %v", err)
	}
	if status != 200 {
		t.Fatalf("GET /flow/nft/stats status=%d, want 200 (body: %.300s)", status, body)
	}

	var stats map[string]interface{}

	// Try envelope first
	var env envelope
	if json.Unmarshal(body, &env) == nil && env.Data != nil {
		if err := json.Unmarshal(env.Data, &stats); err != nil {
			// data might be an array with one element
			var arr []map[string]interface{}
			if err2 := json.Unmarshal(env.Data, &arr); err2 == nil && len(arr) > 0 {
				stats = arr[0]
			} else {
				t.Fatalf("cannot parse NFT stats data: %v (data: %.300s)", err, env.Data)
			}
		}
	} else {
		// Try bare object
		if err := json.Unmarshal(body, &stats); err != nil {
			t.Fatalf("cannot parse NFT stats as bare object: %v (body: %.300s)", err, body)
		}
	}

	if len(stats) == 0 {
		t.Skip("NFT stats returned empty object")
	}

	// Verify no negative values
	for key, val := range stats {
		v := toFloat64(val)
		assertPositiveFloat(t, "stats."+key, v)
	}
}

func TestAudit_AccountNFTCollections(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/account/"+ctx.address+"/nft")
	if len(items) == 0 {
		t.Skip("no NFT collections found for account " + ctx.address)
	}

	for i, item := range items {
		label := "acct_nft[" + strconv.Itoa(i) + "]"

		// Each collection should have an id field
		id := toString(item["id"])
		if id == "" {
			id = toString(item["nft_type"])
		}
		if id == "" {
			t.Errorf("%s: expected id or nft_type field (keys: %v)", label, mapKeys(item))
		}
	}
}
