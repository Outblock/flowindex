package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/config"
	"flowscan-clone/internal/models"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

const (
	onDemandMaxNFTs       = 50
	onDemandScriptTimeout = 10 * time.Second
)

// fetchAndEnrichNFTItems resolves metadata for stub NFTItems on-demand via Cadence scripts.
// It looks up owners from nft_ownership, resolves the collection's public path, executes
// a batch metadata Cadence script per owner group, caches results, and returns enriched items.
func (s *Server) fetchAndEnrichNFTItems(ctx context.Context, contractAddr, contractName string, stubs []models.NFTItem) []models.NFTItem {
	if s.client == nil {
		return stubs
	}

	// Cap to avoid huge Cadence calls.
	if len(stubs) > onDemandMaxNFTs {
		stubs = stubs[:onDemandMaxNFTs]
	}

	// Collect NFT IDs.
	nftIDs := make([]string, len(stubs))
	for i, stub := range stubs {
		nftIDs[i] = stub.NFTID
	}

	// Look up owners from nft_ownership.
	ownerMap, err := s.repo.GetNFTOwnersByIDs(ctx, contractAddr, contractName, nftIDs)
	if err != nil {
		log.Printf("[nft_metadata_fetch] failed to get owners: %v", err)
		return stubs
	}
	if len(ownerMap) == 0 {
		return stubs
	}

	// Resolve public path.
	publicPath, err := s.resolvePublicPath(ctx, contractAddr, contractName)
	if err != nil || publicPath == "" {
		if err != nil {
			log.Printf("[nft_metadata_fetch] failed to resolve public path for %s.%s: %v", contractAddr, contractName, err)
		}
		return stubs
	}
	// Strip /public/ prefix — PublicPath(identifier:) needs just the identifier.
	publicPath = strings.TrimPrefix(publicPath, "/public/")

	// Group NFT IDs by owner.
	ownerGroups := make(map[string][]string)
	for _, id := range nftIDs {
		owner, ok := ownerMap[id]
		if !ok {
			continue
		}
		ownerGroups[owner] = append(ownerGroups[owner], id)
	}

	// Fetch metadata per owner group.
	fetched := make(map[string]models.NFTItem)
	for owner, ids := range ownerGroups {
		items, err := fetchNFTMetadataBatchViaClient(ctx, s.client, owner, publicPath, contractAddr, contractName, ids)
		if err != nil {
			log.Printf("[nft_metadata_fetch] cadence error for owner %s / %s.%s: %v", owner, contractAddr, contractName, err)
			continue
		}
		for _, item := range items {
			fetched[item.NFTID] = item
		}
	}

	if len(fetched) == 0 {
		return stubs
	}

	// Cache fetched items for future requests.
	toUpsert := make([]models.NFTItem, 0, len(fetched))
	for _, item := range fetched {
		toUpsert = append(toUpsert, item)
	}
	if err := s.repo.UpsertNFTItems(ctx, toUpsert); err != nil {
		log.Printf("[nft_metadata_fetch] failed to cache items: %v", err)
	}

	// Merge fetched data into stubs.
	result := make([]models.NFTItem, 0, len(stubs))
	for _, stub := range stubs {
		if enriched, ok := fetched[stub.NFTID]; ok {
			result = append(result, enriched)
		} else {
			result = append(result, stub)
		}
	}
	return result
}

// resolvePublicPath checks the cached public_path, falling back to a Cadence script.
func (s *Server) resolvePublicPath(ctx context.Context, contractAddr, contractName string) (string, error) {
	cached, err := s.repo.GetCollectionPublicPath(ctx, contractAddr, contractName)
	if err != nil {
		return "", err
	}
	if cached != "" {
		return cached, nil
	}

	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)

	ctxExec, cancel := context.WithTimeout(ctx, onDemandScriptTimeout)
	defer cancel()

	v, err := s.client.ExecuteScriptAtLatestBlock(ctxExec, []byte(apiCadenceResolvePublicPathScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return "", err
	}

	v = apiUnwrapOptional(v)
	if v == nil {
		return "", nil
	}
	path := apiCadenceToString(v)
	if path == "" {
		return "", nil
	}

	// Cache it.
	if err := s.repo.UpdateCollectionPublicPath(ctx, contractAddr, contractName, path); err != nil {
		log.Printf("[nft_metadata_fetch] failed to cache public_path for %s.%s: %v", contractAddr, contractName, err)
	}
	return path, nil
}

// fetchNFTMetadataBatchViaClient executes the batch metadata Cadence script using the FlowClient interface.
func fetchNFTMetadataBatchViaClient(ctx context.Context, client FlowClient, owner, publicPathID, contractAddr, contractName string, nftIDs []string) ([]models.NFTItem, error) {
	ownerAddr := flowsdk.HexToAddress(owner)
	pathVal, _ := cadence.NewString(publicPathID)

	cadenceIDs := make([]cadence.Value, 0, len(nftIDs))
	for _, id := range nftIDs {
		n, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			continue
		}
		cadenceIDs = append(cadenceIDs, cadence.NewUInt64(n))
	}
	if len(cadenceIDs) == 0 {
		return nil, nil
	}

	idsArray := cadence.NewArray(cadenceIDs).WithType(cadence.NewVariableSizedArrayType(cadence.UInt64Type))

	ctxExec, cancel := context.WithTimeout(ctx, onDemandScriptTimeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(apiCadenceBatchNFTMetadataScript()), []cadence.Value{
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
		item, ok := parseNFTMetaStruct(elem, contractAddr, contractName)
		if ok {
			items = append(items, item)
		}
	}
	return items, nil
}

// parseNFTMetaStruct parses a Cadence NFTMeta struct into a models.NFTItem.
func parseNFTMetaStruct(v cadence.Value, contractAddr, contractName string) (models.NFTItem, bool) {
	v = apiUnwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.NFTItem{}, false
	}
	fields := s.FieldsMappedByName()

	item := models.NFTItem{
		ContractAddress: contractAddr,
		ContractName:    contractName,
	}

	if idVal := apiUnwrapOptional(fields["id"]); idVal != nil {
		item.NFTID = idVal.String()
	}
	if item.NFTID == "" {
		return models.NFTItem{}, false
	}

	item.Name = apiCadenceToString(fields["name"])
	item.Description = apiCadenceToString(fields["description"])
	item.Thumbnail = apiCadenceToString(fields["thumbnail"])
	item.ExternalURL = apiCadenceToString(fields["externalURL"])

	if sn := apiUnwrapOptional(fields["serialNumber"]); sn != nil {
		if n, ok := apiCadenceToUint(sn); ok {
			v := int64(n)
			item.SerialNumber = &v
		}
	}

	item.EditionName = apiCadenceToString(fields["editionName"])
	if en := apiUnwrapOptional(fields["editionNumber"]); en != nil {
		if n, ok := apiCadenceToUint(en); ok {
			v := int64(n)
			item.EditionNumber = &v
		}
	}
	if em := apiUnwrapOptional(fields["editionMax"]); em != nil {
		if n, ok := apiCadenceToUint(em); ok {
			v := int64(n)
			item.EditionMax = &v
		}
	}

	item.RarityScore = apiCadenceToString(fields["rarityScore"])
	item.RarityDescription = apiCadenceToString(fields["rarityDescription"])

	if traits := apiUnwrapOptional(fields["traits"]); traits != nil {
		if arr, ok := traits.(cadence.Array); ok {
			type traitEntry struct {
				Name  string      `json:"name"`
				Value interface{} `json:"value"`
			}
			var parsed []traitEntry
			for _, t := range arr.Values {
				t = apiUnwrapOptional(t)
				if st, ok := t.(cadence.Struct); ok {
					tf := st.FieldsMappedByName()
					name := apiCadenceToString(tf["name"])
					val := apiCadenceToString(tf["value"])
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

// --- Cadence helpers (duplicated from ingester to keep api package independent) ---

func apiUnwrapOptional(v cadence.Value) cadence.Value {
	if opt, ok := v.(cadence.Optional); ok {
		if opt.Value == nil {
			return nil
		}
		return opt.Value
	}
	return v
}

func apiCadenceToString(v cadence.Value) string {
	v = apiUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if s, ok := v.(cadence.String); ok {
		return string(s)
	}
	return ""
}

func apiCadenceToUint(v cadence.Value) (uint64, bool) {
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

func apiGetEnvOrDefault(key, def string) string {
	v := strings.TrimPrefix(strings.TrimSpace(os.Getenv(key)), "0x")
	if v == "" {
		return def
	}
	return v
}

func apiCadenceResolvePublicPathScript() string {
	viewResolverAddr := apiGetEnvOrDefault("FLOW_VIEW_RESOLVER_ADDRESS",
		apiGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
			apiGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews)))
	metadataViewsAddr := apiGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
		apiGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews))

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

func apiCadenceBatchNFTMetadataScript() string {
	nftAddr := apiGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().NonFungibleToken)
	metadataViewsAddr := apiGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS",
		apiGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews))

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
