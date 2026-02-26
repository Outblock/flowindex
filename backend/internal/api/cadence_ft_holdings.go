package api

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func envOrDefault(key, def string) string {
	v := strings.TrimPrefix(strings.TrimSpace(os.Getenv(key)), "0x")
	if v == "" {
		return def
	}
	return v
}

// cadenceFTHoldingsScript returns a Cadence script that queries all FT vaults
// for a given address, returning real on-chain balances plus token metadata.
// Ported from frontend/cadence/Token/get_token.cdc.
func cadenceFTHoldingsScript() string {
	ftAddr := envOrDefault("FLOW_FUNGIBLE_TOKEN_ADDRESS", "f233dcee88fe0abe")
	ftmdAddr := envOrDefault("FLOW_FUNGIBLE_TOKEN_METADATA_VIEWS_ADDRESS", ftAddr)
	mvAddr := envOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
		envOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", "1d7e57aa55817448"))
	evmBridgeAddr := envOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", "1e4aa0b87d10b141")

	return fmt.Sprintf(`
    import FungibleToken from 0x%s
    import FungibleTokenMetadataViews from 0x%s
    import MetadataViews from 0x%s
    import FlowEVMBridgeConfig from 0x%s

    access(all) fun getEVMAddress(identifier: String): String? {
        if let type = CompositeType(identifier) {
            if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
                return "0x".concat(address.toString())
            }
        }
        return nil
    }

    access(all) struct FTVaultInfo {
        access(all) let name: String?
        access(all) let symbol: String?
        access(all) var balance: UFix64
        access(all) let contractAddress: Address
        access(all) let contractName: String
        access(all) let storagePath: String
        access(all) let identifier: String
        access(all) let evmAddress: String?

        init(
            name: String?, symbol: String?,
            balance: UFix64,
            contractAddress: Address, contractName: String,
            storagePath: String, identifier: String,
            evmAddress: String?
        ) {
            self.name = name
            self.symbol = symbol
            self.balance = balance
            self.contractAddress = contractAddress
            self.contractName = contractName
            self.storagePath = storagePath
            self.identifier = identifier
            self.evmAddress = evmAddress
        }
    }

    access(all) fun main(address: Address): [FTVaultInfo] {
        let acct = getAuthAccount<auth(BorrowValue) &Account>(address)
        var results: [FTVaultInfo] = []

        let ftVaultType = Type<@{FungibleToken.Vault}>()
        let displayType = Type<FungibleTokenMetadataViews.FTDisplay>()

        acct.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
            if type.isRecovered { return true }
            if !type.isSubtype(of: ftVaultType) { return true }

            let vault = acct.storage.borrow<&{FungibleToken.Vault}>(from: path)
            if vault == nil { return true }

            let balance = vault!.balance
            let identifier = type.identifier
            let parts = identifier.split(separator: ".")
            if parts.length < 3 { return true }

            let addrString = "0x".concat(parts[1])
            let contractAddress = Address.fromString(addrString)
            if contractAddress == nil { return true }
            let contractName = parts[2]

            let display = vault!.resolveView(displayType) as! FungibleTokenMetadataViews.FTDisplay?

            var tokenName: String? = display?.name
            var tokenSymbol: String? = display?.symbol
            if tokenName == nil { tokenName = contractName }
            if tokenSymbol == nil { tokenSymbol = contractName }

            let evmAddr = getEVMAddress(identifier: identifier)

            results.append(FTVaultInfo(
                name: tokenName,
                symbol: tokenSymbol,
                balance: balance,
                contractAddress: contractAddress!,
                contractName: contractName,
                storagePath: path.toString(),
                identifier: identifier,
                evmAddress: evmAddr
            ))
            return true
        })

        return results
    }
    `, ftAddr, ftmdAddr, mvAddr, evmBridgeAddr)
}

// ftHoldingFromChain represents a single FT vault holding returned from chain.
type ftHoldingFromChain struct {
	Name            string
	Symbol          string
	Balance         string
	ContractAddress string
	ContractName    string
	StoragePath     string
	Identifier      string
	EVMAddress      string
}

// queryFTHoldingsOnChain executes the Cadence script to get all FT holdings for an address.
func (s *Server) queryFTHoldingsOnChain(ctx context.Context, address string) ([]ftHoldingFromChain, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	addr := flowsdk.HexToAddress(address)
	val, err := s.client.ExecuteScriptAtLatestBlock(ctx, []byte(cadenceFTHoldingsScript()), []cadence.Value{
		cadence.NewAddress(addr),
	})
	if err != nil {
		return nil, fmt.Errorf("cadence script failed: %w", err)
	}

	arr, ok := val.(cadence.Array)
	if !ok {
		return nil, fmt.Errorf("unexpected cadence result type: %T", val)
	}

	var results []ftHoldingFromChain
	for _, item := range arr.Values {
		st, ok := item.(cadence.Struct)
		if !ok {
			continue
		}
		fields := st.FieldsMappedByName()

		h := ftHoldingFromChain{
			Name:        apiCadenceToString(fields["name"]),
			Symbol:      apiCadenceToString(fields["symbol"]),
			Balance:     cadenceFixedPointToString(fields["balance"]),
			ContractName: apiCadenceToString(fields["contractName"]),
			StoragePath: apiCadenceToString(fields["storagePath"]),
			Identifier:  apiCadenceToString(fields["identifier"]),
			EVMAddress:  apiCadenceToString(fields["evmAddress"]),
		}

		// contractAddress is cadence.Address, not a string
		if addrVal, ok := fields["contractAddress"].(cadence.Address); ok {
			h.ContractAddress = fmt.Sprintf("%x", [8]byte(addrVal))
		}

		results = append(results, h)
	}
	return results, nil
}

// cadenceFixedPointToString converts a Cadence UFix64 to a decimal string.
func cadenceFixedPointToString(v cadence.Value) string {
	v = apiUnwrapOptional(v)
	if v == nil {
		return "0"
	}
	if fix, ok := v.(cadence.UFix64); ok {
		return fix.String()
	}
	return v.String()
}
