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
		addrRows := make(map[string]repository.FTMetadataRow)
		for _, t := range ftCandidates {
			md, ok := w.fetchFTMetadata(ctx, t.ContractAddress, t.ContractName)
			if !ok {
				continue
			}
			updates = append(updates, md)
			// Denormalized, address-keyed compatibility table.
			addrRows[md.ContractAddress] = repository.FTMetadataRow{
				ContractAddress: md.ContractAddress,
				Name:            md.Name,
				Symbol:          md.Symbol,
				Decimals:        md.Decimals,
			}
		}
		if err := w.repo.UpsertFTTokens(ctx, updates); err != nil {
			return err
		}
		if len(addrRows) > 0 {
			flat := make([]repository.FTMetadataRow, 0, len(addrRows))
			for _, r := range addrRows {
				flat = append(flat, r)
			}
			_ = w.repo.UpsertFTMetadata(ctx, flat)
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

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(cadenceFTVaultDataScript()), []cadence.Value{
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
	displayVal := unwrapOptional(fields["display"])
	display, _ := displayVal.(cadence.Struct)
	displayFields := display.FieldsMappedByName()

	name := cadenceToString(displayFields["name"])
	symbol := cadenceToString(displayFields["symbol"])
	if name == "" {
		name = cadenceToString(fields["name"])
	}
	if symbol == "" {
		symbol = cadenceToString(fields["symbol"])
	}

	decimals := 0
	if d, ok := cadenceToInt(fields["decimals"]); ok {
		decimals = d
	} else if d, ok := cadenceToInt(displayFields["decimals"]); ok {
		decimals = d
	}

	// Basic sanity: don't write empty metadata.
	if name == "" && symbol == "" && decimals == 0 {
		return models.FTToken{}, false
	}

	return models.FTToken{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            name,
		Symbol:          symbol,
		Decimals:        decimals,
	}, true
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

func cadenceFTVaultDataScript() string {
	// Addresses default to mainnet, but can be overridden via env vars.
	viewResolverAddr := strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_VIEW_RESOLVER_ADDRESS")), "0x")
	if viewResolverAddr == "" {
		// ViewResolver is deployed alongside MetadataViews on the Flow NFT address.
		viewResolverAddr = strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_METADATA_VIEWS_ADDRESS")), "0x")
	}
	if viewResolverAddr == "" {
		viewResolverAddr = strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS")), "0x")
	}
	if viewResolverAddr == "" {
		viewResolverAddr = "1d7e57aa55817448"
	}

	ftmdAddr := strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_FUNGIBLE_TOKEN_METADATA_VIEWS_ADDRESS")), "0x")
	if ftmdAddr == "" {
		// Often co-deployed with FungibleToken.
		ftmdAddr = strings.TrimPrefix(strings.TrimSpace(os.Getenv("FLOW_FUNGIBLE_TOKEN_ADDRESS")), "0x")
	}
	if ftmdAddr == "" {
		ftmdAddr = "f233dcee88fe0abe"
	}

	return fmt.Sprintf(`
        import ViewResolver from 0x%s
        import FungibleTokenMetadataViews from 0x%s

        access(all) fun main(contractAddress: Address, contractName: String): FungibleTokenMetadataViews.FTVaultData? {
            let viewResolver = getAccount(contractAddress).contracts.borrow<&{ViewResolver}>(name: contractName)
                ?? return nil
            let vaultData = viewResolver.resolveContractView(
                resourceType: nil,
                viewType: Type<FungibleTokenMetadataViews.FTVaultData>()
            ) as! FungibleTokenMetadataViews.FTVaultData?
            return vaultData
        }
    `, viewResolverAddr, ftmdAddr)
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
            let viewResolver = getAccount(contractAddress).contracts.borrow<&{ViewResolver}>(name: contractName)
                ?? return nil
            let display = viewResolver.resolveContractView(
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
