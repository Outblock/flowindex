package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

// TokenMetadataWorker enriches app.ft_tokens / app.nft_collections with on-chain MetadataViews.
// It is intentionally best-effort: many contracts do not implement views, and scripts can fail.
type TokenMetadataWorker struct {
	repo *repository.Repository
	flow *flowclient.Client

	newPerRange  int
	ftBackfill   int
	nftBackfill  int
	scriptTimout time.Duration
}

func NewTokenMetadataWorker(repo *repository.Repository, flow *flowclient.Client) *TokenMetadataWorker {
	newPerRange := getEnvIntDefault("TOKEN_METADATA_NEW_PER_RANGE", 50)
	ftBackfill := getEnvIntDefault("TOKEN_METADATA_FT_BACKFILL_PER_RANGE", 25)
	nftBackfill := getEnvIntDefault("TOKEN_METADATA_NFT_BACKFILL_PER_RANGE", 10)
	timeoutMs := getEnvIntDefault("TOKEN_METADATA_SCRIPT_TIMEOUT_MS", 15000)
	return &TokenMetadataWorker{
		repo:         repo,
		flow:         flow,
		newPerRange:  newPerRange,
		ftBackfill:   ftBackfill,
		nftBackfill:  nftBackfill,
		scriptTimout: time.Duration(timeoutMs) * time.Millisecond,
	}
}

func (w *TokenMetadataWorker) Name() string { return "token_metadata_worker" }

func (w *TokenMetadataWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if w.flow == nil {
		return nil
	}

	// 1) New contracts discovered in this range.
	ftNew, _ := w.repo.ListContractsByKindInRange(ctx, "FT", fromHeight, toHeight, w.newPerRange)
	nftNew, _ := w.repo.ListContractsByKindInRange(ctx, "NFT", fromHeight, toHeight, w.newPerRange)

	ftCandidates := make(map[string]models.FTToken)
	nftCandidates := make(map[string]models.NFTCollection)

	for _, c := range ftNew {
		if c.Address == "" || c.Name == "" {
			continue
		}
		key := c.Address + ":" + c.Name
		ftCandidates[key] = models.FTToken{ContractAddress: c.Address, ContractName: c.Name}
	}
	for _, c := range nftNew {
		if c.Address == "" || c.Name == "" {
			continue
		}
		key := c.Address + ":" + c.Name
		nftCandidates[key] = models.NFTCollection{ContractAddress: c.Address, ContractName: c.Name}
	}

	// 2) Opportunistic backfill for previously-discovered tokens that are missing metadata.
	if w.ftBackfill > 0 {
		missing, err := w.repo.ListFTTokensMissingMetadata(ctx, w.ftBackfill)
		if err == nil {
			for _, t := range missing {
				if t.ContractAddress == "" || t.ContractName == "" {
					continue
				}
				key := t.ContractAddress + ":" + t.ContractName
				ftCandidates[key] = models.FTToken{ContractAddress: t.ContractAddress, ContractName: t.ContractName}
			}
		}
	}
	if w.nftBackfill > 0 {
		missing, err := w.repo.ListNFTCollectionsMissingMetadata(ctx, w.nftBackfill)
		if err == nil {
			for _, c := range missing {
				if c.ContractAddress == "" || c.ContractName == "" {
					continue
				}
				key := c.ContractAddress + ":" + c.ContractName
				nftCandidates[key] = models.NFTCollection{ContractAddress: c.ContractAddress, ContractName: c.ContractName}
			}
		}
	}

	// 3) Resolve FT metadata.
	if len(ftCandidates) > 0 {
		var updates []models.FTToken
		for _, t := range ftCandidates {
			md, ok := w.fetchFTMetadata(ctx, t.ContractAddress, t.ContractName)
			if !ok {
				continue
			}
			updates = append(updates, md)
		}
		if err := w.repo.UpsertFTTokens(ctx, updates); err != nil {
			return err
		}
	}

	// 4) Resolve NFT collection metadata (name from NFTCollectionDisplay).
	if len(nftCandidates) > 0 {
		var updates []models.NFTCollection
		for _, c := range nftCandidates {
			md, ok := w.fetchNFTCollectionMetadata(ctx, c.ContractAddress, c.ContractName)
			if !ok {
				continue
			}
			updates = append(updates, md)
		}
		if err := w.repo.UpsertNFTCollections(ctx, updates); err != nil {
			return err
		}
	}

	return nil
}

func (w *TokenMetadataWorker) fetchFTMetadata(ctx context.Context, contractAddr, contractName string) (models.FTToken, bool) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimout)
	defer cancel()

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(cadenceFTCombinedScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return models.FTToken{}, false
	}

	v = unwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.FTToken{}, false
	}

	fields := s.FieldsMappedByName()
	token := models.FTToken{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            cadenceToString(fields["name"]),
		Symbol:          cadenceToString(fields["symbol"]),
		Description:     cadenceToString(fields["description"]),
		ExternalURL:     cadenceToString(fields["externalURL"]),
		VaultPath:       cadencePathToString(fields["storagePath"]),
		ReceiverPath:    cadencePathToString(fields["receiverPath"]),
		BalancePath:     cadencePathToString(fields["balancePath"]),
	}

	token.Logo = extractFirstMediaURL(fields["logos"])
	token.Socials = extractSocials(fields["socials"])
	token.EVMAddress = cadenceToString(fields["evmAddress"])

	if token.Name == "" && token.Symbol == "" {
		return models.FTToken{}, false
	}

	return token, true
}

func (w *TokenMetadataWorker) fetchNFTCollectionMetadata(ctx context.Context, contractAddr, contractName string) (models.NFTCollection, bool) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimout)
	defer cancel()

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(cadenceNFTCollectionDisplayScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return models.NFTCollection{}, false
	}

	v = unwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.NFTCollection{}, false
	}
	topFields := s.FieldsMappedByName()

	// Extract EVM address from the wrapper struct.
	evmAddress := cadenceToString(topFields["evmAddress"])

	// Extract the display struct.
	displayVal := unwrapOptional(topFields["display"])
	if displayVal == nil {
		// Even without display, if we got an EVM address, return partial info.
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
	name := cadenceToString(fields["name"])
	if name == "" {
		return models.NFTCollection{}, false
	}

	description := cadenceToString(fields["description"])
	externalURL := ""
	if ext := unwrapOptional(fields["externalURL"]); ext != nil {
		if st, ok := ext.(cadence.Struct); ok {
			externalURL = cadenceToString(st.FieldsMappedByName()["url"])
		}
	}

	socials := extractSocials(fields["socials"])

	// Many NFT contracts don't expose a "symbol" in standard views. Use contract name as fallback.
	symbol := contractName

	return models.NFTCollection{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            name,
		Symbol:          symbol,
		Description:     description,
		ExternalURL:     externalURL,
		SquareImage:     extractMediaImageURL(fields["squareImage"]),
		BannerImage:     extractMediaImageURL(fields["bannerImage"]),
		Socials:         socials,
		EVMAddress:      evmAddress,
	}, true
}

func unwrapOptional(v cadence.Value) cadence.Value {
	if opt, ok := v.(cadence.Optional); ok {
		if opt.Value == nil {
			return nil
		}
		return opt.Value
	}
	return v
}

func cadenceToString(v cadence.Value) string {
	v = unwrapOptional(v)
	if v == nil {
		return ""
	}
	if s, ok := v.(cadence.String); ok {
		return string(s)
	}
	return ""
}

func cadencePathToString(v cadence.Value) string {
	v = unwrapOptional(v)
	if v == nil {
		return ""
	}
	if p, ok := v.(cadence.Path); ok {
		return "/" + p.Domain.Identifier() + "/" + p.Identifier
	}
	// Fallback: try as string.
	return cadenceToString(v)
}

// extractFirstMediaURL extracts the first URL from a MetadataViews.Medias value.
// Returns a plain URL string (e.g., "https://example.com/logo.svg").
func extractFirstMediaURL(v cadence.Value) string {
	v = unwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return ""
	}
	items := unwrapOptional(s.FieldsMappedByName()["items"])
	if items == nil {
		return ""
	}
	arr, ok := items.(cadence.Array)
	if !ok {
		return ""
	}
	for _, elem := range arr.Values {
		media, ok := unwrapOptional(elem).(cadence.Struct)
		if !ok {
			continue
		}
		url := extractMediaFileURL(media.FieldsMappedByName()["file"])
		if url != "" {
			return url
		}
	}
	return ""
}

// extractMediaURLs extracts URLs from a MetadataViews.Medias cadence value.
// Returns JSON like [{"url":"https://...","mediaType":"image/svg+xml"}]
func extractMediaURLs(v cadence.Value) []byte {
	v = unwrapOptional(v)
	if v == nil {
		return nil
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return nil
	}
	items := unwrapOptional(s.FieldsMappedByName()["items"])
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
		media, ok := unwrapOptional(elem).(cadence.Struct)
		if !ok {
			continue
		}
		mf := media.FieldsMappedByName()
		url := extractMediaFileURL(mf["file"])
		if url == "" {
			continue
		}
		mt := cadenceToString(mf["mediaType"])
		result = append(result, mediaItem{URL: url, MediaType: mt})
	}
	if len(result) == 0 {
		return nil
	}
	b, _ := json.Marshal(result)
	return b
}

// extractMediaFileURL extracts URL from MetadataViews.HTTPFile or IPFSFile.
func extractMediaFileURL(v cadence.Value) string {
	v = unwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return cadenceToString(v)
	}
	fields := s.FieldsMappedByName()
	// HTTPFile has "url" field
	if url := cadenceToString(fields["url"]); url != "" {
		return url
	}
	// IPFSFile has "cid" field
	if cid := cadenceToString(fields["cid"]); cid != "" {
		path := cadenceToString(fields["path"])
		if path != "" {
			return "https://ipfs.io/ipfs/" + cid + "/" + path
		}
		return "https://ipfs.io/ipfs/" + cid
	}
	return ""
}

// extractMediaImageURL extracts URL from a single MetadataViews.Media value.
// Used for squareImage/bannerImage which are single Media structs.
func extractMediaImageURL(v cadence.Value) string {
	v = unwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return ""
	}
	return extractMediaFileURL(s.FieldsMappedByName()["file"])
}

// extractSocials extracts a {String: ExternalURL} dictionary into {"key":"url"} JSON.
func extractSocials(v cadence.Value) []byte {
	v = unwrapOptional(v)
	if v == nil {
		return nil
	}
	dict, ok := v.(cadence.Dictionary)
	if !ok {
		return nil
	}
	result := make(map[string]string)
	for _, pair := range dict.Pairs {
		key := cadenceToString(pair.Key)
		if key == "" {
			continue
		}
		val := unwrapOptional(pair.Value)
		if val == nil {
			continue
		}
		// ExternalURL is a struct with "url" field
		if st, ok := val.(cadence.Struct); ok {
			url := cadenceToString(st.FieldsMappedByName()["url"])
			if url != "" {
				result[key] = url
			}
		} else if s := cadenceToString(val); s != "" {
			result[key] = s
		}
	}
	if len(result) == 0 {
		return nil
	}
	b, _ := json.Marshal(result)
	return b
}

func cadenceToInt(v cadence.Value) (int, bool) {
	v = unwrapOptional(v)
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

func getEnvIntDefault(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// Cadence scripts

// cadenceFTCombinedScript returns a single Cadence script that fetches both
// FTVaultData (paths) and FTDisplay (name, symbol, logos, etc.) in one call.
// It iterates the contract account's storage to find vaults, then calls vault.resolveView().
// This approach works for all contracts including those in recovered state.
func cadenceFTCombinedScript() string {
	viewResolverAddr := getEnvOrDefault("FLOW_VIEW_RESOLVER_ADDRESS",
		getEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
			getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", "1d7e57aa55817448")))

	ftAddr := getEnvOrDefault("FLOW_FUNGIBLE_TOKEN_ADDRESS", "f233dcee88fe0abe")

	ftmdAddr := getEnvOrDefault("FLOW_FUNGIBLE_TOKEN_METADATA_VIEWS_ADDRESS", ftAddr)

	evmBridgeAddr := getEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", "1e4aa0b87d10b141")

	return fmt.Sprintf(`
        import ViewResolver from 0x%s
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
            access(all) let evmAddress: String?

            init(
                name: String?, symbol: String?, description: String?,
                externalURL: String?,
                logos: MetadataViews.Medias?,
                socials: {String: MetadataViews.ExternalURL}?,
                storagePath: StoragePath?, receiverPath: PublicPath?, balancePath: PublicPath?,
                evmAddress: String?
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
                self.evmAddress = evmAddress
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

            let identifier = "A.".concat(contractAddress.toString().slice(from: 2, upTo: contractAddress.toString().length)).concat(".").concat(contractName).concat(".Vault")
            let evmAddr = getEVMAddress(identifier: identifier)

            return FTInfo(
                name: display!.name,
                symbol: display!.symbol,
                description: display!.description,
                externalURL: extURL,
                logos: display!.logos,
                socials: display!.socials,
                storagePath: data?.storagePath,
                receiverPath: data?.receiverPath,
                balancePath: data?.metadataPath,
                evmAddress: evmAddr
            )
        }
    `, viewResolverAddr, ftAddr, ftmdAddr, viewResolverAddr, evmBridgeAddr)
}

func getEnvOrDefault(key, def string) string {
	v := strings.TrimPrefix(strings.TrimSpace(os.Getenv(key)), "0x")
	if v == "" {
		return def
	}
	return v
}

func cadenceNFTCollectionDisplayScript() string {
	viewResolverAddr := strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_VIEW_RESOLVER_ADDRESS")), "0x")
	if viewResolverAddr == "" {
		viewResolverAddr = strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_METADATA_VIEWS_ADDRESS")), "0x")
	}
	if viewResolverAddr == "" {
		viewResolverAddr = strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS")), "0x")
	}
	if viewResolverAddr == "" {
		viewResolverAddr = "1d7e57aa55817448"
	}

	metadataViewsAddr := strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_METADATA_VIEWS_ADDRESS")), "0x")
	if metadataViewsAddr == "" {
		metadataViewsAddr = strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS")), "0x")
	}
	if metadataViewsAddr == "" {
		metadataViewsAddr = "1d7e57aa55817448"
	}

	evmBridgeAddr := getEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", "1e4aa0b87d10b141")

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

            // Discover the actual NFT type from NFTCollectionData view.
            // This handles legacy contracts where the NFT resource isn't named "NFT"
            // (e.g., TopShot.Moment, AllDay.MomentNFT, etc.)
            var evmAddr: String? = nil
            let collectionData = viewResolver!.resolveContractView(
                resourceType: nil,
                viewType: Type<MetadataViews.NFTCollectionData>()
            ) as! MetadataViews.NFTCollectionData?
            if collectionData != nil {
                // storedNFTType gives us the concrete NFT type (e.g. A.<addr>.TopShot.Moment)
                let nftTypeId = collectionData!.storedNFTType.identifier
                evmAddr = getEVMAddress(identifier: nftTypeId)
            }

            // Fallback: try standard ".NFT" identifier
            if evmAddr == nil {
                let addrHex = contractAddress.toString().slice(from: 2, upTo: contractAddress.toString().length)
                let standardId = "A.".concat(addrHex).concat(".").concat(contractName).concat(".NFT")
                evmAddr = getEVMAddress(identifier: standardId)
            }

            return NFTCollectionInfo(display: display, evmAddress: evmAddr)
        }
    `, viewResolverAddr, metadataViewsAddr, evmBridgeAddr)
}

