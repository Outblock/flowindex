package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/onflow/cadence"
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
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"path":  path,
			"error": err.Error(),
			"note":  "Storage values are not readable via read-only scripts without authorization. Type resolution may fail for legacy Cadence contracts.",
		})
		return
	}
	w.Write(out)
}

var storageIdentifierRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func cadencePublicPathsScript() string {
	return `
		access(all) fun main(address: Address): [PublicPath] {
			let account = getAccount(address)
			var out: [PublicPath] = []
			for p in account.storage.publicPaths {
				out.append(p)
			}
			return out
		}
	`
}

func cadenceStorageItemScript() string {
	return `
		access(all) fun main(address: Address, path: String): {String: AnyStruct} {
			let account = getAccount(address)
			let storagePath = StoragePath(identifier: path)!

			return {
				"path": storagePath,
				"type": account.storage.type(at: storagePath),
				"note": "Storage value reads require authorization (getAuthAccount / entitlements). This endpoint only returns best-effort type information."
			}
		}
	`
}
