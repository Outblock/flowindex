package api

import (
	"encoding/json"
	"testing"

	"flowscan-clone/internal/repository"
)

func TestDecodeABIWithContract(t *testing.T) {
	abiJSON := json.RawMessage(`[
	  {
	    "type": "function",
	    "name": "transfer",
	    "stateMutability": "nonpayable",
	    "inputs": [
	      {"name": "to", "type": "address"},
	      {"name": "amount", "type": "uint256"}
	    ],
	    "outputs": [{"name": "", "type": "bool"}]
	  }
	]`)

	decoded := decodeABIWithContract(
		"a9059cbb000000000000000000000000000000000000000000000002bd91ec0b3c1284fe000000000000000000000000000000000000000000000000716f1200055cb000",
		repository.EVMContractMetadata{
			Address: "d3bf53dac106a0290b0483ecbc89d40fcc961f3e",
			Name:    "Wrapped Flow",
			ABI:     abiJSON,
		},
		repository.EVMContractMetadata{},
	)
	if decoded == nil {
		t.Fatal("expected decoded call")
	}
	if decoded["method"] != "transfer" {
		t.Fatalf("expected transfer method, got %#v", decoded["method"])
	}
	args, ok := decoded["args"].([]map[string]interface{})
	if !ok || len(args) != 2 {
		t.Fatalf("expected 2 args, got %#v", decoded["args"])
	}
	if args[0]["value"] != "0x000000000000000000000002bd91ec0b3c1284fe" {
		t.Fatalf("unexpected recipient value: %#v", args[0]["value"])
	}
	if args[1]["value"] != "8173771640000000000" {
		t.Fatalf("unexpected amount value: %#v", args[1]["value"])
	}
}

func TestDecodeABIWithProxyImplementation(t *testing.T) {
	implABI := json.RawMessage(`[
	  {
	    "type": "function",
	    "name": "deposit",
	    "stateMutability": "payable",
	    "inputs": [],
	    "outputs": []
	  }
	]`)

	decoded := decodeABIWithContract(
		"d0e30db0",
		repository.EVMContractMetadata{
			Address:     "1111111111111111111111111111111111111111",
			Name:        "WFLOW Proxy",
			ProxyType:   "eip1967",
			ImplAddress: "d3bf53dac106a0290b0483ecbc89d40fcc961f3e",
		},
		repository.EVMContractMetadata{
			Address: "d3bf53dac106a0290b0483ecbc89d40fcc961f3e",
			Name:    "Wrapped Flow",
			ABI:     implABI,
		},
	)
	if decoded == nil {
		t.Fatal("expected decoded call")
	}
	if decoded["method"] != "deposit" {
		t.Fatalf("expected deposit method, got %#v", decoded["method"])
	}
	if decoded["via_proxy"] != true {
		t.Fatalf("expected via_proxy=true, got %#v", decoded["via_proxy"])
	}
	if decoded["implementation_name"] != "Wrapped Flow" {
		t.Fatalf("unexpected implementation_name: %#v", decoded["implementation_name"])
	}
}
