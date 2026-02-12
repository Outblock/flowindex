package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"flowscan-clone/internal/models"

	"github.com/onflow/cadence"
	cadjson "github.com/onflow/cadence/encoding/json"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func (s *Server) handleAdminRefetchTokenMetadata(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
		return
	}

	ctx := r.Context()

	// Fetch all FT tokens missing metadata (no limit).
	ftMissing, err := s.repo.ListFTTokensMissingMetadata(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Fetch all NFT collections missing metadata.
	nftMissing, err := s.repo.ListNFTCollectionsMissingMetadata(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	ftUpdated := 0
	ftFailed := 0
	for _, t := range ftMissing {
		md, ok := fetchFTMetadataViaClient(ctx, s.client, t.ContractAddress, t.ContractName)
		if !ok {
			ftFailed++
			continue
		}
		if err := s.repo.UpsertFTTokens(ctx, []models.FTToken{md}); err != nil {
			log.Printf("[admin] ft upsert error %s.%s: %v", t.ContractAddress, t.ContractName, err)
			ftFailed++
			continue
		}
		ftUpdated++
	}

	nftUpdated := 0
	nftFailed := 0
	for _, c := range nftMissing {
		md, ok := fetchNFTCollectionMetadataViaClient(ctx, s.client, c.ContractAddress, c.ContractName)
		if !ok {
			nftFailed++
			continue
		}
		if err := s.repo.UpsertNFTCollections(ctx, []models.NFTCollection{md}); err != nil {
			log.Printf("[admin] nft upsert error %s.%s: %v", c.ContractAddress, c.ContractName, err)
			nftFailed++
			continue
		}
		nftUpdated++
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"ft_missing":  len(ftMissing),
		"ft_updated":  ftUpdated,
		"ft_failed":   ftFailed,
		"nft_missing": len(nftMissing),
		"nft_updated": nftUpdated,
		"nft_failed":  nftFailed,
	})
}

// --- helpers (reuse logic from token_metadata_worker but using the FlowClient interface) ---

func fetchFTMetadataViaClient(ctx context.Context, client FlowClient, contractAddr, contractName string) (models.FTToken, bool) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)
	timeout := 15 * time.Second

	ctxExec, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(adminFTCombinedScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		log.Printf("[admin] FT combined script error for %s.%s: %v", contractAddr, contractName, err)
		return models.FTToken{}, false
	}

	v = adminUnwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.FTToken{}, false
	}

	fields := s.FieldsMappedByName()
	token := models.FTToken{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            adminCadenceToString(fields["name"]),
		Symbol:          adminCadenceToString(fields["symbol"]),
		Description:     adminCadenceToString(fields["description"]),
		ExternalURL:     adminCadenceToString(fields["externalURL"]),
		VaultPath:       adminCadencePathToString(fields["storagePath"]),
		ReceiverPath:    adminCadencePathToString(fields["receiverPath"]),
		BalancePath:     adminCadencePathToString(fields["balancePath"]),
	}

	if logosVal := adminUnwrapOptional(fields["logos"]); logosVal != nil {
		if b, err := cadjson.Encode(logosVal); err == nil && len(b) > 0 {
			token.Logo = b
		}
	}
	if socialsVal := adminUnwrapOptional(fields["socials"]); socialsVal != nil {
		if b, err := cadjson.Encode(socialsVal); err == nil && len(b) > 0 {
			token.Socials = b
		}
	}

	if token.Name == "" && token.Symbol == "" {
		return models.FTToken{}, false
	}

	return token, true
}

func fetchNFTCollectionMetadataViaClient(ctx context.Context, client FlowClient, contractAddr, contractName string) (models.NFTCollection, bool) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)
	timeout := 15 * time.Second

	ctxExec, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(adminNFTCollectionDisplayScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return models.NFTCollection{}, false
	}

	v = adminUnwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.NFTCollection{}, false
	}
	fields := s.FieldsMappedByName()
	name := adminCadenceToString(fields["name"])
	if name == "" {
		return models.NFTCollection{}, false
	}

	description := adminCadenceToString(fields["description"])
	externalURL := ""
	if ext := adminUnwrapOptional(fields["externalURL"]); ext != nil {
		if st, ok := ext.(cadence.Struct); ok {
			externalURL = adminCadenceToString(st.FieldsMappedByName()["url"])
		}
	}

	var squareImage, bannerImage, socials []byte
	if v := adminUnwrapOptional(fields["squareImage"]); v != nil {
		squareImage, _ = cadjson.Encode(v)
	}
	if v := adminUnwrapOptional(fields["bannerImage"]); v != nil {
		bannerImage, _ = cadjson.Encode(v)
	}
	if v := adminUnwrapOptional(fields["socials"]); v != nil {
		socials, _ = cadjson.Encode(v)
	}

	symbol := contractName

	return models.NFTCollection{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            name,
		Symbol:          symbol,
		Description:     description,
		ExternalURL:     externalURL,
		SquareImage:     squareImage,
		BannerImage:     bannerImage,
		Socials:         socials,
	}, true
}

// --- Cadence helpers (prefixed to avoid collision with ingester package) ---

func adminUnwrapOptional(v cadence.Value) cadence.Value {
	if opt, ok := v.(cadence.Optional); ok {
		if opt.Value == nil {
			return nil
		}
		return opt.Value
	}
	return v
}

func adminCadenceToString(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if s, ok := v.(cadence.String); ok {
		return string(s)
	}
	return ""
}

func adminCadencePathToString(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if p, ok := v.(cadence.Path); ok {
		return "/" + p.Domain.Identifier() + "/" + p.Identifier
	}
	return adminCadenceToString(v)
}

func adminCadenceToInt(v cadence.Value) (int, bool) {
	v = adminUnwrapOptional(v)
	switch x := v.(type) {
	case cadence.Int:
		return x.Int(), true
	case cadence.Int8:
		return int(x), true
	case cadence.Int16:
		return int(x), true
	case cadence.Int32:
		return int(x), true
	case cadence.Int64:
		return int(x), true
	case cadence.UInt:
		return x.Int(), true
	case cadence.UInt8:
		return int(x), true
	case cadence.UInt16:
		return int(x), true
	case cadence.UInt32:
		return int(x), true
	case cadence.UInt64:
		return int(x), true
	default:
		return 0, false
	}
}

// --- Cadence scripts ---

func adminGetEnvOrDefault(key, def string) string {
	v := strings.TrimPrefix(strings.TrimSpace(os.Getenv(key)), "0x")
	if v == "" {
		return def
	}
	return v
}

func adminViewResolverAddr() string {
	if v := adminGetEnvOrDefault("FLOW_VIEW_RESOLVER_ADDRESS", ""); v != "" {
		return v
	}
	if v := adminGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS", ""); v != "" {
		return v
	}
	if v := adminGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", ""); v != "" {
		return v
	}
	return "1d7e57aa55817448"
}

func adminFTAddr() string {
	return adminGetEnvOrDefault("FLOW_FUNGIBLE_TOKEN_ADDRESS", "f233dcee88fe0abe")
}

func adminFTMetadataViewsAddr() string {
	if v := adminGetEnvOrDefault("FLOW_FUNGIBLE_TOKEN_METADATA_VIEWS_ADDRESS", ""); v != "" {
		return v
	}
	return adminFTAddr()
}

// adminFTCombinedScript fetches both FTDisplay and FTVaultData in a single call.
// Iterates the contract account's storage to find vaults, then calls vault.resolveView().
// This approach works for all contracts including those in recovered state.
func adminFTCombinedScript() string {
	return fmt.Sprintf(`
        import ViewResolver from 0x%s
        import FungibleToken from 0x%s
        import FungibleTokenMetadataViews from 0x%s
        import MetadataViews from 0x%s

        access(all) struct FTInfo {
            access(all) let name: String?
            access(all) let symbol: String?
            access(all) let description: String?
            access(all) let externalURL: String?
            access(all) let logos: MetadataViews.Medias?
            access(all) let socials: {String: MetadataViews.ExternalURL}?
            access(all) let storagePath: StoragePath?
            access(all) let receiverPath: PublicPath?
            access(all) let balancePath: PublicPath?

            init(
                name: String?, symbol: String?, description: String?,
                externalURL: String?,
                logos: MetadataViews.Medias?,
                socials: {String: MetadataViews.ExternalURL}?,
                storagePath: StoragePath?, receiverPath: PublicPath?, balancePath: PublicPath?
            ) {
                self.name = name
                self.symbol = symbol
                self.description = description
                self.externalURL = externalURL
                self.logos = logos
                self.socials = socials
                self.storagePath = storagePath
                self.receiverPath = receiverPath
                self.balancePath = balancePath
            }
        }

        access(all) fun main(contractAddress: Address, contractName: String): FTInfo? {
            let displayType = Type<FungibleTokenMetadataViews.FTDisplay>()
            let dataType = Type<FungibleTokenMetadataViews.FTVaultData>()

            var display: FungibleTokenMetadataViews.FTDisplay? = nil
            var data: FungibleTokenMetadataViews.FTVaultData? = nil

            // Try 1: Borrow vault from storage and call resolveView.
            // Safe for recovered contracts (skips them via isRecovered check).
            let authAcct = getAuthAccount<auth(BorrowValue) &Account>(contractAddress)
            let ftVaultType = Type<@{FungibleToken.Vault}>()
            authAcct.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
                if type.isRecovered { return true }
                if !type.isSubtype(of: ftVaultType) { return true }
                let parts = type.identifier.split(separator: ".")
                if parts.length < 3 { return true }
                if parts[2] != contractName { return true }
                let vault = authAcct.storage.borrow<&{FungibleToken.Vault}>(from: path)
                if vault == nil { return true }
                display = vault!.resolveView(displayType) as! FungibleTokenMetadataViews.FTDisplay?
                data = vault!.resolveView(dataType) as! FungibleTokenMetadataViews.FTVaultData?
                return false
            })

            // Try 2: ViewResolver contract borrow fallback.
            // For contracts that don't have a vault in the deployer's storage.
            if display == nil {
                let acct = getAccount(contractAddress)
                let viewResolver = acct.contracts.borrow<&{ViewResolver}>(name: contractName)
                if viewResolver != nil {
                    display = viewResolver!.resolveContractView(resourceType: nil, viewType: displayType) as! FungibleTokenMetadataViews.FTDisplay?
                    data = viewResolver!.resolveContractView(resourceType: nil, viewType: dataType) as! FungibleTokenMetadataViews.FTVaultData?
                }
            }

            if display == nil { return nil }

            var extURL: String? = nil
            if display!.externalURL != nil {
                extURL = display!.externalURL!.url
            }

            return FTInfo(
                name: display!.name,
                symbol: display!.symbol,
                description: display!.description,
                externalURL: extURL,
                logos: display!.logos,
                socials: display!.socials,
                storagePath: data?.storagePath,
                receiverPath: data?.receiverPath,
                balancePath: data?.metadataPath
            )
        }
    `, adminViewResolverAddr(), adminFTAddr(), adminFTMetadataViewsAddr(), adminViewResolverAddr())
}

func adminNFTCollectionDisplayScript() string {
	metadataViewsAddr := adminGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS", "")
	if metadataViewsAddr == "" {
		metadataViewsAddr = adminGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", "1d7e57aa55817448")
	}

	return fmt.Sprintf(`
        import ViewResolver from 0x%s
        import MetadataViews from 0x%s

        access(all) fun main(contractAddress: Address, contractName: String): MetadataViews.NFTCollectionDisplay? {
            let acct = getAccount(contractAddress)
            let viewResolver = acct.contracts.borrow<&{ViewResolver}>(name: contractName)
            if viewResolver == nil { return nil }
            let display = viewResolver!.resolveContractView(
                resourceType: nil,
                viewType: Type<MetadataViews.NFTCollectionDisplay>()
            ) as! MetadataViews.NFTCollectionDisplay?
            return display
        }
    `, adminViewResolverAddr(), metadataViewsAddr)
}
