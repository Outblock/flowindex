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

// handleAdminRefetchBridge re-checks EVM bridge addresses for all tokens/collections
// that have metadata but no evm_address.
func (s *Server) handleAdminRefetchBridge(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
		return
	}

	ctx := r.Context()
	script := adminBridgeOnlyScript()
	timeout := 15 * time.Second

	// NFT collections missing bridge
	nftMissing, err := s.repo.ListNFTCollectionsMissingBridge(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	nftUpdated := 0
	nftFailed := 0
	for _, c := range nftMissing {
		identifier := fmt.Sprintf("A.%s.%s.NFT", c.ContractAddress, c.ContractName)
		evmAddr := adminQueryBridgeAddress(ctx, s.client, script, identifier, timeout)
		if evmAddr == "" {
			continue
		}
		if err := s.repo.UpdateEVMBridgeAddress(ctx, "app.nft_collections", c.ContractAddress, c.ContractName, evmAddr); err != nil {
			log.Printf("[admin] nft bridge update error %s.%s: %v", c.ContractAddress, c.ContractName, err)
			nftFailed++
			continue
		}
		log.Printf("[admin] nft bridge updated %s.%s -> %s", c.ContractAddress, c.ContractName, evmAddr)
		nftUpdated++
	}

	// FT tokens missing bridge
	ftMissing, err := s.repo.ListFTTokensMissingBridge(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	ftUpdated := 0
	ftFailed := 0
	for _, t := range ftMissing {
		identifier := fmt.Sprintf("A.%s.%s.Vault", t.ContractAddress, t.ContractName)
		evmAddr := adminQueryBridgeAddress(ctx, s.client, script, identifier, timeout)
		if evmAddr == "" {
			continue
		}
		if err := s.repo.UpdateEVMBridgeAddress(ctx, "app.ft_tokens", t.ContractAddress, t.ContractName, evmAddr); err != nil {
			log.Printf("[admin] ft bridge update error %s.%s: %v", t.ContractAddress, t.ContractName, err)
			ftFailed++
			continue
		}
		log.Printf("[admin] ft bridge updated %s.%s -> %s", t.ContractAddress, t.ContractName, evmAddr)
		ftUpdated++
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"nft_checked": len(nftMissing),
		"nft_updated": nftUpdated,
		"nft_failed":  nftFailed,
		"ft_checked":  len(ftMissing),
		"ft_updated":  ftUpdated,
		"ft_failed":   ftFailed,
	})
}

func adminQueryBridgeAddress(ctx context.Context, client FlowClient, script string, identifier string, timeout time.Duration) string {
	idVal, _ := cadence.NewString(identifier)
	ctxExec, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(script), []cadence.Value{idVal})
	if err != nil {
		return ""
	}
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if s, ok := v.(cadence.String); ok {
		return string(s)
	}
	return ""
}

func adminBridgeOnlyScript() string {
	evmBridgeAddr := adminGetEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", "1e4aa0b87d10b141")
	return fmt.Sprintf(`
		import FlowEVMBridgeConfig from 0x%s

		access(all) fun main(identifier: String): String? {
			if let type = CompositeType(identifier) {
				if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
					return "0x".concat(address.toString())
				}
			}
			return nil
		}
	`, evmBridgeAddr)
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

	token.Logo = adminExtractFirstMediaURL(fields["logos"])
	token.Socials = adminExtractSocials(fields["socials"])

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

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(adminNFTCollectionDisplayWithBridgeScript()), []cadence.Value{
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
	topFields := s.FieldsMappedByName()

	// Extract EVM address from the wrapper struct.
	evmAddress := adminCadenceToString(topFields["evmAddress"])

	// Extract the display struct.
	displayVal := adminUnwrapOptional(topFields["display"])
	if displayVal == nil {
		if evmAddress != "" {
			return models.NFTCollection{
				ContractAddress: contractAddr,
				ContractName:    contractName,
				EVMAddress:      evmAddress,
			}, true
		}
		return models.NFTCollection{}, false
	}
	displayStruct, ok := displayVal.(cadence.Struct)
	if !ok {
		return models.NFTCollection{}, false
	}
	fields := displayStruct.FieldsMappedByName()
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

	socials := adminExtractSocials(fields["socials"])

	symbol := contractName

	return models.NFTCollection{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            name,
		Symbol:          symbol,
		Description:     description,
		ExternalURL:     externalURL,
		SquareImage:     adminExtractMediaImageURL(fields["squareImage"]),
		BannerImage:     adminExtractMediaImageURL(fields["bannerImage"]),
		Socials:         socials,
		EVMAddress:      evmAddress,
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

// adminNFTCollectionDisplayWithBridgeScript returns the combined script that fetches
// both NFTCollectionDisplay metadata and the EVM bridge address.
func adminNFTCollectionDisplayWithBridgeScript() string {
	metadataViewsAddr := adminGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS", "")
	if metadataViewsAddr == "" {
		metadataViewsAddr = adminGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", "1d7e57aa55817448")
	}
	evmBridgeAddr := adminGetEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", "1e4aa0b87d10b141")

	return fmt.Sprintf(`
        import ViewResolver from 0x%s
        import MetadataViews from 0x%s
        import FlowEVMBridgeConfig from 0x%s

        access(all) struct NFTCollectionInfo {
            access(all) let display: MetadataViews.NFTCollectionDisplay?
            access(all) let evmAddress: String?

            init(display: MetadataViews.NFTCollectionDisplay?, evmAddress: String?) {
                self.display = display
                self.evmAddress = evmAddress
            }
        }

        access(all) fun getEVMAddress(identifier: String): String? {
            if let type = CompositeType(identifier) {
                if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
                    return "0x".concat(address.toString())
                }
            }
            return nil
        }

        access(all) fun main(contractAddress: Address, contractName: String): NFTCollectionInfo? {
            let acct = getAccount(contractAddress)
            let viewResolver = acct.contracts.borrow<&{ViewResolver}>(name: contractName)
            if viewResolver == nil { return nil }
            let display = viewResolver!.resolveContractView(
                resourceType: nil,
                viewType: Type<MetadataViews.NFTCollectionDisplay>()
            ) as! MetadataViews.NFTCollectionDisplay?

            let identifier = "A.".concat(contractAddress.toString().slice(from: 2, upTo: contractAddress.toString().length)).concat(".").concat(contractName).concat(".NFT")
            let evmAddr = getEVMAddress(identifier: identifier)

            return NFTCollectionInfo(display: display, evmAddress: evmAddr)
        }
    `, adminViewResolverAddr(), metadataViewsAddr, evmBridgeAddr)
}

// --- Cadence value extraction helpers (admin-prefixed to avoid collision with ingester) ---

func adminExtractFirstMediaURL(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return ""
	}
	items := adminUnwrapOptional(s.FieldsMappedByName()["items"])
	if items == nil {
		return ""
	}
	arr, ok := items.(cadence.Array)
	if !ok {
		return ""
	}
	for _, elem := range arr.Values {
		media, ok := adminUnwrapOptional(elem).(cadence.Struct)
		if !ok {
			continue
		}
		url := adminExtractMediaFileURL(media.FieldsMappedByName()["file"])
		if url != "" {
			return url
		}
	}
	return ""
}

func adminExtractMediaURLs(v cadence.Value) []byte {
	v = adminUnwrapOptional(v)
	if v == nil {
		return nil
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return nil
	}
	items := adminUnwrapOptional(s.FieldsMappedByName()["items"])
	if items == nil {
		return nil
	}
	arr, ok := items.(cadence.Array)
	if !ok {
		return nil
	}
	type mediaItem struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType,omitempty"`
	}
	var result []mediaItem
	for _, elem := range arr.Values {
		media, ok := adminUnwrapOptional(elem).(cadence.Struct)
		if !ok {
			continue
		}
		mf := media.FieldsMappedByName()
		url := adminExtractMediaFileURL(mf["file"])
		if url == "" {
			continue
		}
		mt := adminCadenceToString(mf["mediaType"])
		result = append(result, mediaItem{URL: url, MediaType: mt})
	}
	if len(result) == 0 {
		return nil
	}
	b, _ := json.Marshal(result)
	return b
}

func adminExtractMediaFileURL(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return adminCadenceToString(v)
	}
	fields := s.FieldsMappedByName()
	if url := adminCadenceToString(fields["url"]); url != "" {
		return url
	}
	if cid := adminCadenceToString(fields["cid"]); cid != "" {
		path := adminCadenceToString(fields["path"])
		if path != "" {
			return "https://ipfs.io/ipfs/" + cid + "/" + path
		}
		return "https://ipfs.io/ipfs/" + cid
	}
	return ""
}

func adminExtractMediaImageURL(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return ""
	}
	return adminExtractMediaFileURL(s.FieldsMappedByName()["file"])
}

func adminExtractSocials(v cadence.Value) []byte {
	v = adminUnwrapOptional(v)
	if v == nil {
		return nil
	}
	dict, ok := v.(cadence.Dictionary)
	if !ok {
		return nil
	}
	result := make(map[string]string)
	for _, pair := range dict.Pairs {
		key := adminCadenceToString(pair.Key)
		if key == "" {
			continue
		}
		val := adminUnwrapOptional(pair.Value)
		if val == nil {
			continue
		}
		if st, ok := val.(cadence.Struct); ok {
			url := adminCadenceToString(st.FieldsMappedByName()["url"])
			if url != "" {
				result[key] = url
			}
		} else if s := adminCadenceToString(val); s != "" {
			result[key] = s
		}
	}
	if len(result) == 0 {
		return nil
	}
	b, _ := json.Marshal(result)
	return b
}
