package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/onflow/cadence"
	cadjson "github.com/onflow/cadence/encoding/json"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func (s *Server) handleGetAccountContractCode(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := flowsdk.HexToAddress(vars["address"])
	name := strings.TrimSpace(vars["name"])
	if name == "" {
		http.Error(w, "missing contract name", http.StatusBadRequest)
		return
	}

	acc, err := s.client.GetAccount(r.Context(), address)
	if err != nil {
		http.Error(w, "Account not found or fetch failed", http.StatusNotFound)
		return
	}

	code, ok := acc.Contracts[name]
	if !ok {
		http.Error(w, "Contract not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"address":    acc.Address.Hex(),
		"name":       name,
		"byte_size":  len(code),
		"code":       string(code),
		"fetched_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleGetAccountStorage(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := flowsdk.HexToAddress(vars["address"])

	out, err := s.executeCadenceScript(r.Context(), cadenceStorageOverviewScript(), []cadence.Value{
		cadence.NewAddress([8]byte(address)),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Write(out)
}

func (s *Server) handleGetAccountStorageLinks(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := flowsdk.HexToAddress(vars["address"])

	domain := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("domain")))
	if domain != "public" {
		http.Error(w, "invalid domain (expected public)", http.StatusBadRequest)
		return
	}

	out, err := s.executeCadenceScript(r.Context(), cadencePublicPathsScript(), []cadence.Value{
		cadence.NewAddress([8]byte(address)),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Write(out)
}

func (s *Server) handleGetAccountStorageItem(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := flowsdk.HexToAddress(vars["address"])

	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	// Cadence StoragePath(identifier:) requires a valid identifier.
	// We accept either "foo" or "storage/foo" and normalize to "foo".
	if strings.Contains(path, "/") {
		parts := strings.Split(path, "/")
		path = parts[len(parts)-1]
	}
	if !storageIdentifierRe.MatchString(path) {
		http.Error(w, "invalid storage path identifier", http.StatusBadRequest)
		return
	}

	pathVal, _ := cadence.NewString(path)

	out, err := s.executeCadenceScript(r.Context(), cadenceStorageItemScript(), []cadence.Value{
		cadence.NewAddress([8]byte(address)),
		pathVal,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Write(out)
}

func (s *Server) executeCadenceScript(ctx context.Context, script string, args []cadence.Value) ([]byte, error) {
	ctxExec, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	v, err := s.client.ExecuteScriptAtLatestBlock(ctxExec, []byte(script), args)
	if err != nil {
		return nil, fmt.Errorf("failed to execute script: %w", err)
	}

	b, err := cadjson.Encode(v)
	if err != nil {
		return nil, fmt.Errorf("failed to encode cadence value: %w", err)
	}
	return b, nil
}

var storageIdentifierRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func cadenceStorageOverviewScript() string {
	// Cadence v1 account APIs:
	// - https://cadence-lang.org/docs/language/accounts#authaccount
	// - https://cadence-lang.org/docs/language/account-storage
	return `
		access(all) fun main(address: Address): {String: AnyStruct} {
			let account = getAuthAccount<auth(Storage) &Account>(address)

			let storagePaths = account.storage.storagePaths
			let publicPaths = account.storage.publicPaths

			// Best-effort type map for quick browsing.
			var types: {String: Type} = {}
			for path in storagePaths {
				if let t = account.storage.type(at: path) {
					types[path.toString()] = t
				}
			}

			return {
				"used": account.storage.used,
				"capacity": account.storage.capacity,
				"storagePaths": storagePaths,
				"publicPaths": publicPaths,
				"types": types
			}
		}
	`
}

func cadencePublicPathsScript() string {
	return `
		access(all) fun main(address: Address): [PublicPath] {
			let account = getAuthAccount<auth(Storage) &Account>(address)
			return account.storage.publicPaths
		}
	`
}

func cadenceStorageItemScript() string {
	return `
		access(all) fun main(address: Address, path: String): {String: AnyStruct} {
			let account = getAuthAccount<auth(Storage) &Account>(address)
			let storagePath = StoragePath(identifier: path)!

			let t = account.storage.type(at: storagePath)
			let v = account.storage.borrow<&Any>(from: storagePath)

			return {
				"path": storagePath,
				"type": t,
				"value": v
			}
		}
	`
}
