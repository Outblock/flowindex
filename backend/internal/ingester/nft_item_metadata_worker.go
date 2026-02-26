package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/config"
	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

// NFTItemMetadataWorker crawls (owner, collection) pairs from nft_ownership,
// batch-fetches per-NFT metadata via Cadence scripts, and stores in app.nft_items.
type NFTItemMetadataWorker struct {
	repo          *repository.Repository
	flow          *flowclient.Client
	pairsPerRange int
	nftBatchSize  int
	scriptTimeout time.Duration
}

func NewNFTItemMetadataWorker(repo *repository.Repository, flow *flowclient.Client) *NFTItemMetadataWorker {
	pairsPerRange := getEnvIntDefault("NFT_ITEM_METADATA_PAIRS_PER_RANGE", 5)
	nftBatchSize := getEnvIntDefault("NFT_ITEM_METADATA_BATCH_SIZE", 50)
	timeoutMs := getEnvIntDefault("NFT_ITEM_METADATA_SCRIPT_TIMEOUT_MS", 30000)
	return &NFTItemMetadataWorker{
		repo:          repo,
		flow:          flow,
		pairsPerRange: pairsPerRange,
		nftBatchSize:  nftBatchSize,
		scriptTimeout: time.Duration(timeoutMs) * time.Millisecond,
	}
}

func (w *NFTItemMetadataWorker) Name() string { return "nft_item_metadata_worker" }

// ProcessRange is queue-based: it ignores block heights and instead picks (owner, collection)
// pairs that need metadata. This makes it compatible with the AsyncWorker framework while
// doing its own work-finding.
func (w *NFTItemMetadataWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if w.flow == nil {
		return nil
	}

	pairs, err := w.repo.ListOwnerCollectionsNeedingMetadata(ctx, w.pairsPerRange)
	if err != nil {
		return fmt.Errorf("list owner collections: %w", err)
	}
	if len(pairs) == 0 {
		return nil
	}

	for _, pair := range pairs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := w.processOwnerCollection(ctx, pair); err != nil {
			log.Printf("[nft_item_metadata_worker] error processing %s/%s.%s: %v",
				pair.Owner, pair.ContractAddress, pair.ContractName, err)
			// Continue to next pair rather than failing the whole range.
		}
	}
	return nil
}

func (w *NFTItemMetadataWorker) processOwnerCollection(ctx context.Context, pair repository.OwnerCollectionPair) error {
	// 1. Resolve public path (cached in nft_collections).
	publicPath, err := w.resolvePublicPath(ctx, pair.ContractAddress, pair.ContractName)
	if err != nil {
		log.Printf("[nft_item_metadata_worker] cannot resolve public path for %s.%s: %v",
			pair.ContractAddress, pair.ContractName, err)
		return nil // Skip collection, don't fail
	}
	if publicPath == "" {
		return nil // Collection doesn't expose a public path
	}

	// Strip /public/ prefix — PublicPath(identifier:) needs just the identifier.
	publicPath = strings.TrimPrefix(publicPath, "/public/")

	// 2. Get NFT IDs that need metadata.
	nftIDs, err := w.repo.ListNFTIDsForOwnerCollection(ctx, pair.Owner, pair.ContractAddress, pair.ContractName)
	if err != nil {
		return fmt.Errorf("list nft ids: %w", err)
	}
	if len(nftIDs) == 0 {
		return nil
	}

	// 3. Batch fetch metadata.
	for i := 0; i < len(nftIDs); i += w.nftBatchSize {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		end := i + w.nftBatchSize
		if end > len(nftIDs) {
			end = len(nftIDs)
		}
		chunk := nftIDs[i:end]

		items, err := w.fetchNFTMetadataBatch(ctx, pair.Owner, publicPath, pair.ContractAddress, pair.ContractName, chunk)
		if err != nil {
			log.Printf("[nft_item_metadata_worker] script error for %s/%s.%s (batch %d): %v",
				pair.Owner, pair.ContractAddress, pair.ContractName, i/w.nftBatchSize, err)
			// Mark these as errored with exponential backoff.
			_ = w.repo.MarkNFTItemsError(ctx, pair.ContractAddress, pair.ContractName, chunk, err.Error(), 0)
			continue
		}

		if len(items) > 0 {
			if err := w.repo.UpsertNFTItems(ctx, items); err != nil {
				return fmt.Errorf("upsert nft items: %w", err)
			}
		}

		// Mark any IDs that weren't in the result as errored (NFT may not exist or borrowNFT failed).
		fetched := make(map[string]bool)
		for _, item := range items {
			fetched[item.NFTID] = true
		}
		var missing []string
		for _, id := range chunk {
			if !fetched[id] {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			_ = w.repo.MarkNFTItemsError(ctx, pair.ContractAddress, pair.ContractName, missing, "not returned by script", 0)
		}
	}
	return nil
}

func (w *NFTItemMetadataWorker) resolvePublicPath(ctx context.Context, contractAddr, contractName string) (string, error) {
	// Check cache first.
	cached, err := w.repo.GetCollectionPublicPath(ctx, contractAddr, contractName)
	if err != nil {
		return "", err
	}
	if cached != "" {
		return cached, nil
	}

	// Execute Cadence script to resolve.
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimeout)
	defer cancel()

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(cadenceResolvePublicPathScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return "", err
	}

	v = unwrapOptional(v)
	if v == nil {
		return "", nil
	}

	path := cadenceToString(v)
	if path == "" {
		return "", nil
	}

	// Cache it.
	if err := w.repo.UpdateCollectionPublicPath(ctx, contractAddr, contractName, path); err != nil {
		log.Printf("[nft_item_metadata_worker] failed to cache public_path for %s.%s: %v", contractAddr, contractName, err)
	}
	return path, nil
}

func (w *NFTItemMetadataWorker) fetchNFTMetadataBatch(ctx context.Context, owner, publicPathID, contractAddr, contractName string, nftIDs []string) ([]models.NFTItem, error) {
	ownerAddr := flowsdk.HexToAddress(owner)
	pathVal, _ := cadence.NewString(publicPathID)

	// Convert string IDs to UInt64 cadence array.
	cadenceIDs := make([]cadence.Value, 0, len(nftIDs))
	for _, id := range nftIDs {
		n, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			continue // Skip non-numeric IDs
		}
		cadenceIDs = append(cadenceIDs, cadence.NewUInt64(n))
	}
	if len(cadenceIDs) == 0 {
		return nil, nil
	}

	idsArray := cadence.NewArray(cadenceIDs).WithType(cadence.NewVariableSizedArrayType(cadence.UInt64Type))

	ctxExec, cancel := context.WithTimeout(ctx, w.scriptTimeout)
	defer cancel()

	v, err := w.flow.ExecuteScriptAtLatestBlock(ctxExec, []byte(cadenceBatchNFTMetadataScript()), []cadence.Value{
		cadence.NewAddress([8]byte(ownerAddr)),
		pathVal,
		idsArray,
	})
	if err != nil {
		return nil, err
	}

	arr, ok := v.(cadence.Array)
	if !ok {
		return nil, fmt.Errorf("expected array, got %T", v)
	}

	var items []models.NFTItem
	for _, elem := range arr.Values {
		item, ok := w.parseNFTMetaStruct(elem, contractAddr, contractName)
		if ok {
			items = append(items, item)
		}
	}
	return items, nil
}

func (w *NFTItemMetadataWorker) parseNFTMetaStruct(v cadence.Value, contractAddr, contractName string) (models.NFTItem, bool) {
	v = unwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.NFTItem{}, false
	}
	fields := s.FieldsMappedByName()

	item := models.NFTItem{
		ContractAddress: contractAddr,
		ContractName:    contractName,
	}

	// id (UInt64)
	if idVal := unwrapOptional(fields["id"]); idVal != nil {
		item.NFTID = idVal.String()
	}
	if item.NFTID == "" {
		return models.NFTItem{}, false
	}

	item.Name = cadenceToString(fields["name"])
	item.Description = cadenceToString(fields["description"])
	item.Thumbnail = cadenceToString(fields["thumbnail"])
	item.ExternalURL = cadenceToString(fields["externalURL"])

	if sn := unwrapOptional(fields["serialNumber"]); sn != nil {
		if n, ok := cadenceToUint(sn); ok {
			v := int64(n)
			item.SerialNumber = &v
		}
	}

	item.EditionName = cadenceToString(fields["editionName"])
	if en := unwrapOptional(fields["editionNumber"]); en != nil {
		if n, ok := cadenceToUint(en); ok {
			v := int64(n)
			item.EditionNumber = &v
		}
	}
	if em := unwrapOptional(fields["editionMax"]); em != nil {
		if n, ok := cadenceToUint(em); ok {
			v := int64(n)
			item.EditionMax = &v
		}
	}

	item.RarityScore = cadenceToString(fields["rarityScore"])
	item.RarityDescription = cadenceToString(fields["rarityDescription"])

	// Traits as JSON.
	if traits := unwrapOptional(fields["traits"]); traits != nil {
		if arr, ok := traits.(cadence.Array); ok {
			type traitEntry struct {
				Name  string      `json:"name"`
				Value interface{} `json:"value"`
			}
			var parsed []traitEntry
			for _, t := range arr.Values {
				t = unwrapOptional(t)
				if st, ok := t.(cadence.Struct); ok {
					tf := st.FieldsMappedByName()
					name := cadenceToString(tf["name"])
					val := cadenceToString(tf["value"])
					if name != "" {
						parsed = append(parsed, traitEntry{Name: name, Value: val})
					}
				}
			}
			if len(parsed) > 0 {
				b, _ := json.Marshal(parsed)
				item.Traits = b
			}
		}
	}

	return item, true
}

func cadenceToUint(v cadence.Value) (uint64, bool) {
	switch x := v.(type) {
	case cadence.UInt64:
		return uint64(x), true
	case cadence.UInt32:
		return uint64(x), true
	case cadence.UInt16:
		return uint64(x), true
	case cadence.UInt8:
		return uint64(x), true
	case cadence.UInt:
		n, err := strconv.ParseUint(x.String(), 10, 64)
		return n, err == nil
	case cadence.Int:
		n, err := strconv.ParseUint(x.String(), 10, 64)
		return n, err == nil
	case cadence.Int64:
		if x >= 0 {
			return uint64(x), true
		}
		return 0, false
	default:
		n, err := strconv.ParseUint(v.String(), 10, 64)
		return n, err == nil
	}
}

// Cadence scripts

func cadenceResolvePublicPathScript() string {
	viewResolverAddr := getEnvOrDefault("FLOW_VIEW_RESOLVER_ADDRESS",
		getEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
			getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews)))
	metadataViewsAddr := getEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
		getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews))

	return fmt.Sprintf(`
		import ViewResolver from 0x%s
		import MetadataViews from 0x%s

		access(all) fun main(contractAddress: Address, contractName: String): String? {
			let acct = getAccount(contractAddress)
			let vr = acct.contracts.borrow<&{ViewResolver}>(name: contractName)
			if vr == nil { return nil }
			let data = vr!.resolveContractView(
				resourceType: nil,
				viewType: Type<MetadataViews.NFTCollectionData>()
			) as! MetadataViews.NFTCollectionData?
			if data == nil { return nil }
			return data!.publicPath.toString()
		}
	`, viewResolverAddr, metadataViewsAddr)
}

func cadenceBatchNFTMetadataScript() string {
	nftAddr := getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().NonFungibleToken)
	metadataViewsAddr := getEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
		getEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews))

	return fmt.Sprintf(`
		import NonFungibleToken from 0x%s
		import MetadataViews from 0x%s

		access(all) struct NFTMeta {
			access(all) let id: UInt64
			access(all) let name: String?
			access(all) let description: String?
			access(all) let thumbnail: String?
			access(all) let externalURL: String?
			access(all) let serialNumber: UInt64?
			access(all) let editionName: String?
			access(all) let editionNumber: UInt64?
			access(all) let editionMax: UInt64?
			access(all) let rarityScore: String?
			access(all) let rarityDescription: String?
			access(all) let traits: [MetadataViews.Trait]?

			init(
				id: UInt64,
				name: String?,
				description: String?,
				thumbnail: String?,
				externalURL: String?,
				serialNumber: UInt64?,
				editionName: String?,
				editionNumber: UInt64?,
				editionMax: UInt64?,
				rarityScore: String?,
				rarityDescription: String?,
				traits: [MetadataViews.Trait]?
			) {
				self.id = id
				self.name = name
				self.description = description
				self.thumbnail = thumbnail
				self.externalURL = externalURL
				self.serialNumber = serialNumber
				self.editionName = editionName
				self.editionNumber = editionNumber
				self.editionMax = editionMax
				self.rarityScore = rarityScore
				self.rarityDescription = rarityDescription
				self.traits = traits
			}
		}

		access(all) fun main(owner: Address, publicPathID: String, ids: [UInt64]): [NFTMeta] {
			let account = getAccount(owner)
			let path = PublicPath(identifier: publicPathID)!
			let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection}>(path)
			if collectionRef == nil { return [] }

			let results: [NFTMeta] = []
			for id in ids {
				let nft = collectionRef!.borrowNFT(id)
				if nft == nil { continue }

				var name: String? = nil
				var desc: String? = nil
				var thumb: String? = nil
				var extURL: String? = nil
				var serial: UInt64? = nil
				var edName: String? = nil
				var edNum: UInt64? = nil
				var edMax: UInt64? = nil
				var rarScore: String? = nil
				var rarDesc: String? = nil
				var traits: [MetadataViews.Trait]? = nil

				// Display
				if let display = MetadataViews.getDisplay(nft!) {
					name = display.name
					desc = display.description
					thumb = display.thumbnail.uri()
				}

				// ExternalURL
				if let ext = MetadataViews.getExternalURL(nft!) {
					extURL = ext.url
				}

				// Serial
				if let s = MetadataViews.getSerial(nft!) {
					serial = s.number
				}

				// Editions
				if let editions = MetadataViews.getEditions(nft!) {
					if editions.infoList.length > 0 {
						let ed = editions.infoList[0]
						edName = ed.name
						edNum = ed.number
						edMax = ed.max
					}
				}

				// Rarity
				if let rarity = MetadataViews.getRarity(nft!) {
					if rarity.score != nil {
						rarScore = rarity.score!.toString()
					}
					rarDesc = rarity.description
				}

				// Traits
				if let t = MetadataViews.getTraits(nft!) {
					traits = t.traits
				}

				results.append(NFTMeta(
					id: id,
					name: name,
					description: desc,
					thumbnail: thumb,
					externalURL: extURL,
					serialNumber: serial,
					editionName: edName,
					editionNumber: edNum,
					editionMax: edMax,
					rarityScore: rarScore,
					rarityDescription: rarDesc,
					traits: traits
				))
			}
			return results
		}
	`, nftAddr, metadataViewsAddr)
}
