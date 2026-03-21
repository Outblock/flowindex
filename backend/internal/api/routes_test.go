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

// routeToSpecPath converts a registered route to the OpenAPI path format.
// The spec paths match the registered routes directly (no version prefix insertion).
func routeToSpecPath(route string) string {
	return route
}

// Routes that are intentionally excluded from the OpenAPI spec.
var specExcludedRoutes = map[string]bool{
	// Internal/infra
	"/health":            true,
	"/openapi.yaml":      true,
	"/openapi.json":      true,
	"/ws":                true,
	"/status/gcp-vms":    true,
	"/auth/verify-key":   true,
	"/api/cadence/check": true,
	// NFT/COA backfill (admin-like)
	"/flow/nft/backfill": true,
	"/flow/coa/backfill": true,
	// Base/subrouter prefixes (not actual endpoints)
	"/status": true,
	"/admin":  true,
	// Alias: /contract/{id}/version/{id} same as /contract/{id}/{id}
	"/flow/contract/{identifier}/version/{id}": true,
	// Analytics aliases (content blockers block "analytics")
	"/analytics/daily":                  true,
	"/analytics/daily/module/{module}":  true,
	"/analytics/transfers/daily":        true,
	"/analytics/big-transfers":          true,
	"/analytics/top-contracts":          true,
	"/analytics/token-volume":           true,
	// EVM proxy routes (proxied to Blockscout, not our own API)
	"/flow/evm/transaction/{hash}/internal-transactions": true,
	"/flow/evm/transaction/{hash}/logs":                  true,
	"/flow/evm/transaction/{hash}/token-transfers":       true,
	"/flow/evm/address/{address}/transactions":           true,
	"/flow/evm/address/{address}/internal-transactions":  true,
	"/flow/evm/address/{address}/token-transfers":        true,
	"/flow/evm/address/{address}":                        true,
	"/flow/evm/address/{address}/nft":                    true,
	"/flow/evm/search":                                   true,
	"/flow/search/preview":                               true,
	// Scheduled transaction handler/search routes (new, not yet in spec)
	"/flow/scheduled-handler":                true,
	"/flow/scheduled-handler/{owner}": true,
	"/flow/scheduled-transaction/search":     true,
}

// TestAllRoutesInSpec ensures every registered public route has an OpenAPI spec entry.
// This prevents documentation drift when new endpoints are added.
func TestAllRoutesInSpec(t *testing.T) {
	specPath := "../../../openapi-v2.json"
	if _, err := os.Stat(specPath); os.IsNotExist(err) {
		t.Skip("openapi-v2.json not found, skipping route coverage test")
	}
	spec := loadSpec(t, specPath)

	// Build set of documented spec paths
	specPaths := make(map[string]bool, len(spec.Paths))
	for p := range spec.Paths {
		specPaths[p] = true
	}

	// Walk all registered routes (excluding admin, wallet, webhook subrouters)
	server := NewServer(nil, nil, "0", 0)
	router := server.httpServer.Handler.(*mux.Router)

	var missing []string
	router.Walk(func(route *mux.Route, _ *mux.Router, _ []*mux.Route) error {
		tpl, err := route.GetPathTemplate()
		if err != nil {
			return nil
		}
		// Skip wallet, webhook routes (admin routes are now documented)
		if strings.HasPrefix(tpl, "/api/v1/wallet") || strings.HasPrefix(tpl, "/webhook") {
			return nil
		}
		// /flow/address/... are aliases for /flow/account/... — skip spec check
		if strings.HasPrefix(tpl, "/flow/address/") {
			return nil
		}
		if specExcludedRoutes[tpl] {
			return nil
		}
		specPath := routeToSpecPath(tpl)
		if !specPaths[specPath] {
			missing = append(missing, tpl+" → "+specPath)
		}
		return nil
	})

	if len(missing) > 0 {
		t.Errorf("Routes registered but missing from openapi-v2.json (%d):\n  %s\n\nAdd them to the spec or to specExcludedRoutes if intentionally undocumented.",
			len(missing), strings.Join(missing, "\n  "))
	}
}
