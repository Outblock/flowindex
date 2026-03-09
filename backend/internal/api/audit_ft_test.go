//go:build integration

package api_test

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestAudit_FTList(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/ft?limit=10")
	if len(items) == 0 {
		t.Skip("no FT tokens returned")
	}

	for i, tok := range items {
		label := "ft[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, tok, "id", "name", "symbol", "decimals")
		assertTokenIdentifier(t, toString(tok["id"]))

		symbol := toString(tok["symbol"])
		if symbol == "" {
			t.Errorf("%s.symbol is empty", label)
		}

		decimals := toFloat64(tok["decimals"])
		if decimals < 0 || decimals > 18 {
			t.Errorf("%s.decimals=%v, want 0-18", label, decimals)
		}
	}
}

func TestAudit_FTDetailMatchesList(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/ft?limit=1")
	if len(items) == 0 {
		t.Skip("no FT tokens returned")
	}

	first := items[0]
	tokenID := toString(first["id"])
	if tokenID == "" {
		t.Fatal("first FT token has no id")
	}

	detail := fetchEnvelopeObject(t, "/flow/ft/"+tokenID)

	// Symbol should match
	listSymbol := toString(first["symbol"])
	detailSymbol := toString(detail["symbol"])
	if listSymbol != detailSymbol {
		t.Errorf("symbol mismatch: list=%q detail=%q", listSymbol, detailSymbol)
	}

	// Decimals should match
	listDecimals := toFloat64(first["decimals"])
	detailDecimals := toFloat64(detail["decimals"])
	if listDecimals != detailDecimals {
		t.Errorf("decimals mismatch: list=%v detail=%v", listDecimals, detailDecimals)
	}
}

func TestAudit_FTTransfers(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/ft/transfer?limit=10&address="+ctx.address)
	if len(items) == 0 {
		t.Skip("no FT transfers returned")
	}

	for i, xfer := range items {
		label := "ft_transfer[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, xfer, "transaction_hash", "amount", "sender", "receiver", "timestamp")

		amount := toFloat64(xfer["amount"])
		if amount < 0 {
			t.Errorf("%s.amount=%v, want non-negative", label, amount)
		}

		sender := toString(xfer["sender"])
		if sender != "" {
			assertFlowAddress(t, sender)
		}

		receiver := toString(xfer["receiver"])
		if receiver != "" {
			assertFlowAddress(t, receiver)
		}

		assertTimestamp(t, label+".timestamp", toString(xfer["timestamp"]))
	}
}

func TestAudit_FTHoldings(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/ft/"+ctx.ftToken+"/holding?limit=10")
	if len(items) == 0 {
		t.Skip("no FT holdings returned for " + ctx.ftToken)
	}

	for i, h := range items {
		label := "ft_holding[" + strconv.Itoa(i) + "]"

		addr := toString(h["address"])
		if addr != "" {
			assertFlowAddress(t, addr)
		}

		balance := toFloat64(h["balance"])
		if balance < 0 {
			t.Errorf("%s.balance=%v, want non-negative", label, balance)
		}
	}
}

func TestAudit_FTTopAccounts(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/ft/"+ctx.ftToken+"/top-account?limit=10")
	if len(items) < 2 {
		t.Skip("not enough top accounts returned for " + ctx.ftToken)
	}

	// Verify sorted descending by balance
	prev := toFloat64(items[0]["balance"])
	for i := 1; i < len(items); i++ {
		cur := toFloat64(items[i]["balance"])
		if cur > prev {
			t.Errorf("top-account not sorted descending: [%d].balance=%v > [%d].balance=%v", i, cur, i-1, prev)
		}
		prev = cur
	}
}

func TestAudit_FTStats(t *testing.T) {
	// /flow/ft/stats may return envelope or bare object — try both
	url := ctx.baseURL + "/flow/ft/stats"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /flow/ft/stats error: %v", err)
	}
	if status != 200 {
		t.Fatalf("GET /flow/ft/stats status=%d, want 200 (body: %.300s)", status, body)
	}

	var obj map[string]interface{}

	// Try envelope first
	var env envelope
	if json.Unmarshal(body, &env) == nil && env.Data != nil {
		if json.Unmarshal(env.Data, &obj) != nil {
			t.Fatalf("ft/stats envelope data is not an object: %.300s", env.Data)
		}
	} else {
		// Try bare object
		if json.Unmarshal(body, &obj) != nil {
			t.Fatalf("ft/stats response is not a JSON object: %.300s", body)
		}
	}

	// Verify no negative values in numeric fields
	for k, v := range obj {
		f := toFloat64(v)
		if f < 0 {
			t.Errorf("ft/stats.%s=%v, want non-negative", k, f)
		}
	}
}

func TestAudit_FTPrices(t *testing.T) {
	// /flow/ft/prices may return envelope list or bare array
	url := ctx.baseURL + "/flow/ft/prices"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /flow/ft/prices error: %v", err)
	}
	if status != 200 {
		t.Fatalf("GET /flow/ft/prices status=%d, want 200 (body: %.300s)", status, body)
	}

	var items []map[string]interface{}

	// Try envelope first
	var env envelope
	if json.Unmarshal(body, &env) == nil && env.Data != nil {
		if json.Unmarshal(env.Data, &items) != nil {
			// Try envelope data as bare object (single price)
			var obj map[string]interface{}
			if json.Unmarshal(env.Data, &obj) == nil {
				items = []map[string]interface{}{obj}
			}
		}
	}
	// If envelope didn't work, try bare array
	if len(items) == 0 {
		if json.Unmarshal(body, &items) != nil {
			// Try bare object
			var obj map[string]interface{}
			if json.Unmarshal(body, &obj) == nil {
				items = []map[string]interface{}{obj}
			}
		}
	}

	if len(items) == 0 {
		t.Skip("no price data returned")
	}

	hasPositivePrice := false
	for _, item := range items {
		price := toFloat64(item["price"])
		if price > 0 {
			hasPositivePrice = true
			break
		}
		// Also check "usd" or "value" as alternative field names
		for _, key := range []string{"usd", "value", "price_usd"} {
			if toFloat64(item[key]) > 0 {
				hasPositivePrice = true
				break
			}
		}
		if hasPositivePrice {
			break
		}
	}

	if !hasPositivePrice {
		t.Logf("WARN: no tokens with price > 0 found (price feed may be disabled)")
	}
}

func TestAudit_AccountFTVaults(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/account/0xe467b9dd11fa00df/ft")
	if len(items) == 0 {
		t.Fatal("expected non-empty FT vault list for FlowFees account")
	}

	for i, vault := range items {
		label := "ft_vault[" + strconv.Itoa(i) + "]"

		// Must have token identifier and balance
		tokenID := toString(vault["token"])
		if tokenID == "" {
			tokenID = toString(vault["id"])
		}
		if tokenID == "" {
			tokenID = toString(vault["token_id"])
		}
		if tokenID == "" {
			t.Errorf("%s: missing token identifier (keys: %v)", label, mapKeys(vault))
		}

		balance := toFloat64(vault["balance"])
		if balance < 0 {
			t.Errorf("%s.balance=%v, want non-negative", label, balance)
		}
	}
}

func TestAudit_AccountFTTransferDirection(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/account/"+ctx.address+"/ft/transfer?limit=10")
	if len(items) == 0 {
		t.Skip("no FT transfers found for account " + ctx.address)
	}

	addrLower := strings.ToLower(ctx.address)

	for i, xfer := range items {
		label := "ft_transfer[" + strconv.Itoa(i) + "]"

		direction := toString(xfer["direction"])
		sender := strings.ToLower(toString(xfer["sender"]))
		receiver := strings.ToLower(toString(xfer["receiver"]))

		switch direction {
		case "withdraw":
			if sender != addrLower {
				t.Errorf("%s: direction=withdraw but sender=%q != address=%q", label, sender, addrLower)
			}
		case "deposit":
			if receiver != addrLower {
				t.Errorf("%s: direction=deposit but receiver=%q != address=%q", label, receiver, addrLower)
			}
		case "":
			// No direction field — verify account appears as sender or receiver
			if sender != addrLower && receiver != addrLower {
				t.Errorf("%s: address %q not found as sender (%q) or receiver (%q)", label, addrLower, sender, receiver)
			}
		default:
			t.Logf("%s: unknown direction=%q", label, direction)
		}
	}
}
