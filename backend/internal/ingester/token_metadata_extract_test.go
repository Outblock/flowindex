package ingester

import (
	"encoding/json"
	"testing"

	"github.com/onflow/cadence"
	"github.com/onflow/cadence/common"
)

// --- NFT Collection EVM Bridge parsing tests ---

// Helper to build the MetadataViews.NFTCollectionDisplay struct that the Cadence script returns.
func buildNFTCollectionDisplay(name, description string) cadence.Value {
	// MetadataViews.ExternalURL
	extURLType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.ExternalURL",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)
	// MetadataViews.HTTPFile
	httpFileType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.HTTPFile",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)
	// MetadataViews.Media
	mediaType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Media",
		[]cadence.Field{
			{Identifier: "file", Type: httpFileType},
			{Identifier: "mediaType", Type: cadence.StringType},
		},
		nil,
	)
	// MetadataViews.NFTCollectionDisplay
	displayType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.NFTCollectionDisplay",
		[]cadence.Field{
			{Identifier: "name", Type: cadence.StringType},
			{Identifier: "description", Type: cadence.StringType},
			{Identifier: "externalURL", Type: extURLType},
			{Identifier: "squareImage", Type: mediaType},
			{Identifier: "bannerImage", Type: mediaType},
			{Identifier: "socials", Type: cadence.NewDictionaryType(cadence.StringType, extURLType)},
		},
		nil,
	)

	httpFile := cadence.NewStruct([]cadence.Value{cadence.String("https://example.com/img.png")}).WithType(httpFileType)
	media := cadence.NewStruct([]cadence.Value{httpFile, cadence.String("image/png")}).WithType(mediaType)
	extURL := cadence.NewStruct([]cadence.Value{cadence.String("https://example.com")}).WithType(extURLType)
	socials := cadence.NewDictionary(nil).WithType(cadence.NewDictionaryType(cadence.StringType, extURLType))

	return cadence.NewStruct([]cadence.Value{
		cadence.String(name),
		cadence.String(description),
		extURL,
		media,
		media,
		socials,
	}).WithType(displayType)
}

// buildNFTCollectionInfo builds the wrapper struct returned by cadenceNFTCollectionDisplayScript.
func buildNFTCollectionInfo(display cadence.Value, evmAddress *string) cadence.Value {
	displayOptType := cadence.NewOptionalType(display.Type())
	evmOptType := cadence.NewOptionalType(cadence.StringType)

	infoType := cadence.NewStructType(
		nil,
		"NFTCollectionInfo",
		[]cadence.Field{
			{Identifier: "display", Type: displayOptType},
			{Identifier: "evmAddress", Type: evmOptType},
		},
		nil,
	)

	var evmVal cadence.Value
	if evmAddress != nil {
		evmVal = cadence.NewOptional(cadence.String(*evmAddress))
	} else {
		evmVal = cadence.NewOptional(nil)
	}

	return cadence.NewStruct([]cadence.Value{
		cadence.NewOptional(display),
		evmVal,
	}).WithType(infoType)
}

func TestParseNFTCollectionInfo_WithEVMAddress(t *testing.T) {
	display := buildNFTCollectionDisplay("TestNFT", "A test NFT collection")
	evmAddr := "0x1234567890abcdef1234567890abcdef12345678"
	info := buildNFTCollectionInfo(display, &evmAddr)

	// Simulate the parsing logic from fetchNFTCollectionMetadata
	v := unwrapOptional(info)
	s, ok := v.(cadence.Struct)
	if !ok {
		t.Fatal("expected struct")
	}
	topFields := s.FieldsMappedByName()

	gotEVM := cadenceToString(topFields["evmAddress"])
	if gotEVM != evmAddr {
		t.Errorf("expected evmAddress=%q, got=%q", evmAddr, gotEVM)
	}

	displayVal := unwrapOptional(topFields["display"])
	if displayVal == nil {
		t.Fatal("expected non-nil display")
	}
	ds, ok := displayVal.(cadence.Struct)
	if !ok {
		t.Fatal("expected display struct")
	}
	fields := ds.FieldsMappedByName()
	gotName := cadenceToString(fields["name"])
	if gotName != "TestNFT" {
		t.Errorf("expected name=TestNFT, got=%q", gotName)
	}
}

func TestParseNFTCollectionInfo_WithoutEVMAddress(t *testing.T) {
	display := buildNFTCollectionDisplay("TestNFT", "A test NFT collection")
	info := buildNFTCollectionInfo(display, nil)

	v := unwrapOptional(info)
	s, ok := v.(cadence.Struct)
	if !ok {
		t.Fatal("expected struct")
	}
	topFields := s.FieldsMappedByName()

	gotEVM := cadenceToString(topFields["evmAddress"])
	if gotEVM != "" {
		t.Errorf("expected empty evmAddress, got=%q", gotEVM)
	}
}

// --- FT Token EVM Bridge parsing tests ---

func buildFTInfo(name, symbol string, evmAddress *string) cadence.Value {
	evmOptType := cadence.NewOptionalType(cadence.StringType)
	optStringType := cadence.NewOptionalType(cadence.StringType)
	optPathType := cadence.NewOptionalType(cadence.PathType)

	// MetadataViews.Medias (optional)
	httpFileType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.HTTPFile",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)
	mediaType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Media",
		[]cadence.Field{
			{Identifier: "file", Type: httpFileType},
			{Identifier: "mediaType", Type: cadence.StringType},
		},
		nil,
	)
	mediasType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Medias",
		[]cadence.Field{
			{Identifier: "items", Type: cadence.NewVariableSizedArrayType(mediaType)},
		},
		nil,
	)
	optMediasType := cadence.NewOptionalType(mediasType)

	extURLType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.ExternalURL",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)
	optSocialsType := cadence.NewOptionalType(cadence.NewDictionaryType(cadence.StringType, extURLType))

	ftInfoType := cadence.NewStructType(
		nil,
		"FTInfo",
		[]cadence.Field{
			{Identifier: "name", Type: optStringType},
			{Identifier: "symbol", Type: optStringType},
			{Identifier: "description", Type: optStringType},
			{Identifier: "externalURL", Type: optStringType},
			{Identifier: "logos", Type: optMediasType},
			{Identifier: "socials", Type: optSocialsType},
			{Identifier: "storagePath", Type: optPathType},
			{Identifier: "receiverPath", Type: optPathType},
			{Identifier: "balancePath", Type: optPathType},
			{Identifier: "evmAddress", Type: evmOptType},
		},
		nil,
	)

	var evmVal cadence.Value
	if evmAddress != nil {
		evmVal = cadence.NewOptional(cadence.String(*evmAddress))
	} else {
		evmVal = cadence.NewOptional(nil)
	}

	return cadence.NewStruct([]cadence.Value{
		cadence.NewOptional(cadence.String(name)),
		cadence.NewOptional(cadence.String(symbol)),
		cadence.NewOptional(cadence.String("A test FT")),
		cadence.NewOptional(nil), // externalURL
		cadence.NewOptional(nil), // logos
		cadence.NewOptional(nil), // socials
		cadence.NewOptional(nil), // storagePath
		cadence.NewOptional(nil), // receiverPath
		cadence.NewOptional(nil), // balancePath
		evmVal,
	}).WithType(ftInfoType)
}

func TestParseFTInfo_WithEVMAddress(t *testing.T) {
	evmAddr := "0xdeadbeef12345678deadbeef12345678deadbeef"
	info := buildFTInfo("USDC", "USDC", &evmAddr)

	// Simulate parseFTTokenResponse logic
	v := unwrapOptional(info)
	s, ok := v.(cadence.Struct)
	if !ok {
		t.Fatal("expected struct")
	}
	fields := s.FieldsMappedByName()

	gotName := cadenceToString(fields["name"])
	if gotName != "USDC" {
		t.Errorf("expected name=USDC, got=%q", gotName)
	}

	gotEVM := cadenceToString(fields["evmAddress"])
	if gotEVM != evmAddr {
		t.Errorf("expected evmAddress=%q, got=%q", evmAddr, gotEVM)
	}
}

func TestParseFTInfo_WithoutEVMAddress(t *testing.T) {
	info := buildFTInfo("FLOW", "FLOW", nil)

	v := unwrapOptional(info)
	s, ok := v.(cadence.Struct)
	if !ok {
		t.Fatal("expected struct")
	}
	fields := s.FieldsMappedByName()

	gotEVM := cadenceToString(fields["evmAddress"])
	if gotEVM != "" {
		t.Errorf("expected empty evmAddress, got=%q", gotEVM)
	}
}

func TestExtractMediaURLs(t *testing.T) {
	// Build MetadataViews.Medias struct with one HTTPFile item
	httpFileType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.HTTPFile",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)
	mediaType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Media",
		[]cadence.Field{
			{Identifier: "file", Type: httpFileType},
			{Identifier: "mediaType", Type: cadence.StringType},
		},
		nil,
	)
	mediasType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Medias",
		[]cadence.Field{
			{Identifier: "items", Type: cadence.NewVariableSizedArrayType(mediaType)},
		},
		nil,
	)

	httpFile := cadence.NewStruct([]cadence.Value{
		cadence.String("https://example.com/logo.svg"),
	}).WithType(httpFileType)
	media := cadence.NewStruct([]cadence.Value{
		httpFile,
		cadence.String("image/svg+xml"),
	}).WithType(mediaType)
	medias := cadence.NewStruct([]cadence.Value{
		cadence.NewArray([]cadence.Value{media}).WithType(cadence.NewVariableSizedArrayType(mediaType)),
	}).WithType(mediasType)

	result := extractMediaURLs(medias)
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	var items []struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType"`
	}
	if err := json.Unmarshal(result, &items); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].URL != "https://example.com/logo.svg" {
		t.Errorf("unexpected URL: %s", items[0].URL)
	}
	if items[0].MediaType != "image/svg+xml" {
		t.Errorf("unexpected mediaType: %s", items[0].MediaType)
	}
}

func TestExtractMediaURLs_Nil(t *testing.T) {
	result := extractMediaURLs(cadence.NewOptional(nil))
	if result != nil {
		t.Errorf("expected nil for nil optional, got %s", string(result))
	}
}

func TestExtractSocials(t *testing.T) {
	// Build {String: MetadataViews.ExternalURL} dictionary
	extURLType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.ExternalURL",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)

	twitter := cadence.NewStruct([]cadence.Value{
		cadence.String("https://twitter.com/flow_blockchain"),
	}).WithType(extURLType)
	discord := cadence.NewStruct([]cadence.Value{
		cadence.String("https://discord.gg/flow"),
	}).WithType(extURLType)

	dict := cadence.NewDictionary([]cadence.KeyValuePair{
		{Key: cadence.String("twitter"), Value: twitter},
		{Key: cadence.String("discord"), Value: discord},
	}).WithType(cadence.NewDictionaryType(cadence.StringType, extURLType))

	result := extractSocials(dict)
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	var m map[string]string
	if err := json.Unmarshal(result, &m); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if m["twitter"] != "https://twitter.com/flow_blockchain" {
		t.Errorf("unexpected twitter: %s", m["twitter"])
	}
	if m["discord"] != "https://discord.gg/flow" {
		t.Errorf("unexpected discord: %s", m["discord"])
	}
}

func TestExtractSocials_Nil(t *testing.T) {
	result := extractSocials(cadence.NewOptional(nil))
	if result != nil {
		t.Errorf("expected nil for nil optional, got %s", string(result))
	}
}

func TestExtractMediaImageURL(t *testing.T) {
	httpFileType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.HTTPFile",
		[]cadence.Field{{Identifier: "url", Type: cadence.StringType}},
		nil,
	)
	mediaType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Media",
		[]cadence.Field{
			{Identifier: "file", Type: httpFileType},
			{Identifier: "mediaType", Type: cadence.StringType},
		},
		nil,
	)

	httpFile := cadence.NewStruct([]cadence.Value{
		cadence.String("https://example.com/square.png"),
	}).WithType(httpFileType)
	media := cadence.NewStruct([]cadence.Value{
		httpFile,
		cadence.String("image/png"),
	}).WithType(mediaType)

	url := extractMediaImageURL(media)
	if url != "https://example.com/square.png" {
		t.Errorf("unexpected URL: %s", url)
	}
}

func TestExtractMediaImageURL_IPFS(t *testing.T) {
	ipfsFileType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.IPFSFile",
		[]cadence.Field{
			{Identifier: "cid", Type: cadence.StringType},
			{Identifier: "path", Type: cadence.NewOptionalType(cadence.StringType)},
		},
		nil,
	)
	mediaType := cadence.NewStructType(
		common.NewStringLocation(nil, "MetadataViews"),
		"MetadataViews.Media",
		[]cadence.Field{
			{Identifier: "file", Type: ipfsFileType},
			{Identifier: "mediaType", Type: cadence.StringType},
		},
		nil,
	)

	ipfsFile := cadence.NewStruct([]cadence.Value{
		cadence.String("QmHash123"),
		cadence.NewOptional(nil),
	}).WithType(ipfsFileType)
	media := cadence.NewStruct([]cadence.Value{
		ipfsFile,
		cadence.String("image/png"),
	}).WithType(mediaType)

	url := extractMediaImageURL(media)
	if url != "https://ipfs.io/ipfs/QmHash123" {
		t.Errorf("unexpected URL: %s", url)
	}
}
