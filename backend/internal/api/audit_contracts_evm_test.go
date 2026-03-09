//go:build integration

package api_test

import (
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// reContractIdentifier matches A.{16hex}.Name
var reContractIdentifier = regexp.MustCompile(`^A\.[0-9a-fA-F]{16}\.\w+$`)

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

func TestAudit_ContractList(t *testing.T) {
	contracts := fetchEnvelopeList(t, "/flow/contract?limit=10")

	if len(contracts) == 0 {
		t.Fatal("contract list is empty")
	}

	for i, c := range contracts {
		label := "contract[" + strconv.Itoa(i) + "]"

		// Required fields
		assertFieldsExist(t, c, "id", "address", "name")

		// Identifier should be A.{hex}.Name
		id := toString(c["id"])
		if !reContractIdentifier.MatchString(id) {
			t.Errorf("%s.id: invalid identifier %q (want A.{16hex}.Name)", label, id)
		}

		// Address should be valid Flow address
		addr := toString(c["address"])
		assertFlowAddress(t, addr)

		// Identifier should contain the address hex (without 0x prefix)
		addrHex := strings.TrimPrefix(strings.ToLower(addr), "0x")
		if !strings.Contains(strings.ToLower(id), addrHex) {
			t.Errorf("%s: identifier %q does not contain address hex %q", label, id, addrHex)
		}
	}
}

func TestAudit_ContractDetail(t *testing.T) {
	if ctx.contractID == "" {
		t.Skip("no contractID available")
	}

	obj := fetchEnvelopeObject(t, "/flow/contract/"+ctx.contractID)

	// Required fields
	assertFieldsExist(t, obj, "id", "address", "name")

	// Code should be non-empty (>10 chars)
	code := toString(obj["body"])
	if code == "" {
		code = toString(obj["code"])
	}
	if len(code) <= 10 {
		t.Errorf("contract code too short: got %d chars, want > 10", len(code))
	}
}

func TestAudit_ContractVersions(t *testing.T) {
	if ctx.contractID == "" {
		t.Skip("no contractID available")
	}

	versions := fetchEnvelopeList(t, "/flow/contract/"+ctx.contractID+"/version?limit=10")

	if len(versions) == 0 {
		t.Skip("no versions found for contract " + ctx.contractID)
	}

	for i, v := range versions {
		label := "version[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, v, "block_height")

		height := toFloat64(v["block_height"])
		if height <= 0 {
			t.Errorf("%s.block_height should be positive, got %.0f", label, height)
		}
	}
}

// ---------------------------------------------------------------------------
// EVM tests
// ---------------------------------------------------------------------------

func TestAudit_EVMTransactionList(t *testing.T) {
	txList := fetchItemsList(t, "/flow/evm/transaction?limit=10")

	if len(txList) == 0 {
		t.Skip("no EVM transactions found")
	}

	for i, tx := range txList {
		label := "evm_tx[" + strconv.Itoa(i) + "]"

		// Required fields
		assertFieldsExist(t, tx, "hash", "from", "block_number")

		// Hash should be valid EVM hash (0x + 64 hex)
		hash := toString(tx["hash"])
		assertEVMHash(t, hash)

		// gas_used should be non-negative
		gasUsed := toFloat64(tx["gas_used"])
		if gasUsed < 0 {
			t.Errorf("%s.gas_used should be non-negative, got %.0f", label, gasUsed)
		}
	}
}

func TestAudit_EVMTransactionDetail(t *testing.T) {
	if ctx.evmTxHash == "" {
		t.Skip("no evmTxHash available")
	}

	obj := fetchBareObject(t, "/flow/evm/transaction/"+ctx.evmTxHash)

	// Hash should match what we requested
	hash := toString(obj["hash"])
	if !strings.EqualFold(hash, ctx.evmTxHash) {
		t.Errorf("hash mismatch: got %q, want %q", hash, ctx.evmTxHash)
	}

	// gas_used <= gas_limit
	gasUsed := toFloat64(obj["gas_used"])
	gasLimit := toFloat64(obj["gas_limit"])
	if gasLimit > 0 && gasUsed > gasLimit {
		t.Errorf("gas_used (%.0f) > gas_limit (%.0f)", gasUsed, gasLimit)
	}
}
