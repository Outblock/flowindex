package ingester

import (
	"encoding/json"
	"testing"

	"github.com/onflow/cadence"
	"github.com/onflow/cadence/common"
)

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
