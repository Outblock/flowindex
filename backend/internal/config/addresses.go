package config

import (
	"os"
	"strings"
	"sync"
)

// FlowAddresses holds network-specific contract addresses.
// Addresses are stored WITHOUT the 0x prefix.
type FlowAddresses struct {
	FlowIDTableStaking string
	FlowEpoch          string
	FlowToken          string
	FungibleToken       string
	NonFungibleToken    string
	MetadataViews       string
	ViewResolver        string
	EVM                 string
	FlowServiceAccount  string
	FlowFees            string
	LockedTokens        string
	StakingCollection   string
	FlowEVMBridge       string
	FlowEVMBridgeConfig string
	FlowEVMBridgeUtils  string
	FungibleTokenMetadataViews string
}

var (
	addresses     *FlowAddresses
	addressesOnce sync.Once
)

var mainnetAddresses = FlowAddresses{
	FlowIDTableStaking: "8624b52f9ddcd04a",
	FlowEpoch:          "8624b52f9ddcd04a",
	FlowToken:          "1654653399040a61",
	FungibleToken:       "f233dcee88fe0abe",
	NonFungibleToken:    "1d7e57aa55817448",
	MetadataViews:       "1d7e57aa55817448",
	ViewResolver:        "1d7e57aa55817448",
	EVM:                 "e467b9dd11fa00df",
	FlowServiceAccount:  "e467b9dd11fa00df",
	FlowFees:            "f919ee77447b7497",
	LockedTokens:        "8d0e87b65159ae63",
	StakingCollection:   "8d0e87b65159ae63",
	FlowEVMBridge:       "1e4aa0b87d10b141",
	FlowEVMBridgeConfig: "1e4aa0b87d10b141",
	FlowEVMBridgeUtils:  "1e4aa0b87d10b141",
	FungibleTokenMetadataViews: "f233dcee88fe0abe",
}

var testnetAddresses = FlowAddresses{
	FlowIDTableStaking: "9eca2b38b18b5dfe",
	FlowEpoch:          "9eca2b38b18b5dfe",
	FlowToken:          "7e60df042a9c0868",
	FungibleToken:       "9a0766d93b6608b7",
	NonFungibleToken:    "631e88ae7f1d7c20",
	MetadataViews:       "631e88ae7f1d7c20",
	ViewResolver:        "631e88ae7f1d7c20",
	EVM:                 "8c5303eaa26202d6",
	FlowServiceAccount:  "8c5303eaa26202d6",
	FlowFees:            "912d5440f7e3769e",
	LockedTokens:        "95e019a17d0e23d7",
	StakingCollection:   "95e019a17d0e23d7",
	FlowEVMBridge:       "dfc20aee650fcbdf",
	FlowEVMBridgeConfig: "dfc20aee650fcbdf",
	FlowEVMBridgeUtils:  "dfc20aee650fcbdf",
	FungibleTokenMetadataViews: "9a0766d93b6608b7",
}

// Addr returns the global FlowAddresses for the configured network.
// Reads FLOW_NETWORK env var on first call ("testnet" or "mainnet", default "mainnet").
func Addr() *FlowAddresses {
	addressesOnce.Do(func() {
		network := strings.TrimSpace(strings.ToLower(os.Getenv("FLOW_NETWORK")))
		switch network {
		case "testnet":
			a := testnetAddresses
			addresses = &a
		default:
			a := mainnetAddresses
			addresses = &a
		}
	})
	return addresses
}

// Network returns "testnet" or "mainnet" based on FLOW_NETWORK env var.
func Network() string {
	network := strings.TrimSpace(strings.ToLower(os.Getenv("FLOW_NETWORK")))
	if network == "testnet" {
		return "testnet"
	}
	return "mainnet"
}
