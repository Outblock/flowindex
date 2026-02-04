package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
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

	out, err := s.executeFlowViewScript(r.Context(), flowViewScriptAccountData(), []cadence.Value{
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
	if domain != "public" && domain != "private" {
		http.Error(w, "invalid domain (expected public|private)", http.StatusBadRequest)
		return
	}

	domainVal, _ := cadence.NewString(domain)

	out, err := s.executeFlowViewScript(r.Context(), flowViewScriptAccountLinks(domain), []cadence.Value{
		cadence.NewAddress([8]byte(address)),
		domainVal,
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

	raw := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("raw")))
	isRaw := raw == "1" || raw == "true" || raw == "yes"

	pathVal, _ := cadence.NewString(path)

	if uuidStr := strings.TrimSpace(r.URL.Query().Get("uuid")); uuidStr != "" {
		u, err := strconv.ParseUint(uuidStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid uuid", http.StatusBadRequest)
			return
		}
		out, err := s.executeFlowViewScript(r.Context(), flowViewScriptAccountStorageNFT(), []cadence.Value{
			cadence.NewAddress([8]byte(address)),
			pathVal,
			cadence.NewUInt64(u),
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Write(out)
		return
	}

	out, err := s.executeFlowViewScript(r.Context(), flowViewScriptAccountStorage(isRaw), []cadence.Value{
		cadence.NewAddress([8]byte(address)),
		pathVal,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Write(out)
}

func (s *Server) executeFlowViewScript(ctx context.Context, script string, args []cadence.Value) ([]byte, error) {
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

func flowViewScriptAccountData() string {
	addr := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(os.Getenv("FLOWVIEW_FDNZ_ADDRESS"))), "0x")
	if addr == "" {
		addr = "73e4a1094d0bcab6" // mainnet default
	}
	contractName := strings.TrimSpace(os.Getenv("FLOWVIEW_CONTRACT_NAME"))
	if contractName == "" {
		contractName = "FDNZ"
	}
	authCall := strings.TrimSpace(os.Getenv("FLOWVIEW_AUTH_ACCOUNT_CALL"))
	if authCall == "" {
		authCall = "getAuthAccount(address)"
	}

	return fmt.Sprintf(`
		import %s from 0x%s
		access(all) fun main(address: Address): AnyStruct {
			return %s.getAccountData(%s)
		}
	`, contractName, addr, contractName, authCall)
}

func flowViewScriptAccountLinks(domain string) string {
	addr := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(os.Getenv("FLOWVIEW_FDNZ_ADDRESS"))), "0x")
	if addr == "" {
		addr = "73e4a1094d0bcab6"
	}
	contractName := strings.TrimSpace(os.Getenv("FLOWVIEW_CONTRACT_NAME"))
	if contractName == "" {
		contractName = "FDNZ"
	}
	authCall := strings.TrimSpace(os.Getenv("FLOWVIEW_AUTH_ACCOUNT_CALL"))
	if authCall == "" {
		authCall = "getAuthAccount(address)"
	}

	return fmt.Sprintf(`
		import %s from 0x%s
		access(all) fun main(address: Address, domain: String): [{String:AnyStruct}] {
			return %s.getAccountLinks(%s, domain: domain)
		}
	`, contractName, addr, contractName, authCall)
}

func flowViewScriptAccountStorage(isRaw bool) string {
	addr := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(os.Getenv("FLOWVIEW_FDNZ_ADDRESS"))), "0x")
	if addr == "" {
		addr = "73e4a1094d0bcab6"
	}
	contractName := strings.TrimSpace(os.Getenv("FLOWVIEW_CONTRACT_NAME"))
	if contractName == "" {
		contractName = "FDNZ"
	}
	authCall := strings.TrimSpace(os.Getenv("FLOWVIEW_AUTH_ACCOUNT_CALL"))
	if authCall == "" {
		authCall = "getAuthAccount(address)"
	}

	suffix := ""
	if isRaw {
		suffix = "Raw"
	}

	return fmt.Sprintf(`
		import %s from 0x%s
		access(all) fun main(address: Address, path: String): AnyStruct {
			return %s.getAccountStorage%s(%s, path: path)
		}
	`, contractName, addr, contractName, suffix, authCall)
}

func flowViewScriptAccountStorageNFT() string {
	addr := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(os.Getenv("FLOWVIEW_FDNZ_ADDRESS"))), "0x")
	if addr == "" {
		addr = "73e4a1094d0bcab6"
	}
	contractName := strings.TrimSpace(os.Getenv("FLOWVIEW_CONTRACT_NAME"))
	if contractName == "" {
		contractName = "FDNZ"
	}
	authCall := strings.TrimSpace(os.Getenv("FLOWVIEW_AUTH_ACCOUNT_CALL"))
	if authCall == "" {
		authCall = "getAuthAccount(address)"
	}

	return fmt.Sprintf(`
		import %s from 0x%s
		access(all) fun main(address: Address, path: String, uuid: UInt64): AnyStruct {
			return %s.getAccountStorageNFT(%s, path: path, uuid: uuid)
		}
	`, contractName, addr, contractName, authCall)
}
