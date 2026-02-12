package ingester

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/onflow/cadence"
	cadjson "github.com/onflow/cadence/encoding/json"
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

	if logosVal := unwrapOptional(fields["logos"]); logosVal != nil {
		if b, err := cadjson.Encode(logosVal); err == nil && len(b) > 0 {
			token.Logo = b
		}
	}
	if socialsVal := unwrapOptional(fields["socials"]); socialsVal != nil {
		if b, err := cadjson.Encode(socialsVal); err == nil && len(b) > 0 {
			token.Socials = b
		}
	}

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
	fields := s.FieldsMappedByName()
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

	var squareImage, bannerImage, socials []byte
	if v := unwrapOptional(fields["squareImage"]); v != nil {
		squareImage, _ = cadjson.Encode(v)
	}
	if v := unwrapOptional(fields["bannerImage"]); v != nil {
		bannerImage, _ = cadjson.Encode(v)
	}
	if v := unwrapOptional(fields["socials"]); v != nil {
		socials, _ = cadjson.Encode(v)
	}

	// Many NFT contracts don't expose a "symbol" in standard views. Use contract name as fallback.
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
    `, viewResolverAddr, ftAddr, ftmdAddr, viewResolverAddr)
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
    `, viewResolverAddr, metadataViewsAddr)
}

// For debugging: produce a JSON-CDC encoding of a Cadence value.
// Not used in hot path, but handy when extending field extraction.
func _encodeCadenceJSON(v cadence.Value) string {
	b, _ := cadjson.Encode(v)
	return string(b)
}
