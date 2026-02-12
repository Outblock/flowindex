package api

import (
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

type openapiSpec struct {
	Paths map[string]map[string]struct{} `json:"paths"`
}

var pathParamRegex = regexp.MustCompile(`\{[^}]+\}`)

func samplePath(p string) string {
	return pathParamRegex.ReplaceAllStringFunc(p, func(param string) string {
		switch param {
		case "{height}", "{epoch}", "{id}":
			return "1"
		case "{address}", "{node_id}", "{transaction_id}", "{transaction}", "{token}", "{publicKey}", "{nft_id}", "{nft_type}", "{hash}", "{identifier}", "{role}":
			return "test"
		default:
			return "test"
		}
	})
}

func loadSpec(t *testing.T, path string) openapiSpec {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read spec %s: %v", path, err)
	}
	var spec openapiSpec
	if err := json.Unmarshal(data, &spec); err != nil {
		t.Fatalf("parse spec %s: %v", path, err)
	}
	return spec
}

func assertRoutesFromSpec(t *testing.T, router *mux.Router, prefix string, spec openapiSpec) {
	t.Helper()
	for path, methods := range spec.Paths {
		for method := range methods {
			req, _ := http.NewRequest(strings.ToUpper(method), prefix+samplePath(path), nil)
			var match mux.RouteMatch
			if !router.Match(req, &match) {
				t.Fatalf("missing route: %s %s%s", method, prefix, path)
			}
		}
	}
}

func TestRoutesFromSpec(t *testing.T) {
	specPath := "../../../openapi.json"
	if _, err := os.Stat(specPath); os.IsNotExist(err) {
		t.Skip("openapi.json not found, skipping route spec test")
	}
	server := NewServer(nil, nil, "0", 0)
	router := server.httpServer.Handler.(*mux.Router)
	spec := loadSpec(t, specPath)
	assertRoutesFromSpec(t, router, "", spec)
}
