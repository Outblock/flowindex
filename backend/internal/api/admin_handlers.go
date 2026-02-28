package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/config"
	"flowscan-clone/internal/ingester"
	"flowscan-clone/internal/models"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func (s *Server) handleAdminRefetchTokenMetadata(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
		return
	}

	ctx := r.Context()

	// Fetch all FT tokens missing metadata (no limit).
	ftMissing, err := s.repo.ListFTTokensMissingMetadata(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Fetch all NFT collections missing metadata.
	nftMissing, err := s.repo.ListNFTCollectionsMissingMetadata(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	ftUpdated := 0
	ftFailed := 0
	for _, t := range ftMissing {
		md, ok := fetchFTMetadataViaClient(ctx, s.client, t.ContractAddress, t.ContractName)
		if !ok {
			ftFailed++
			continue
		}
		if err := s.repo.UpsertFTTokens(ctx, []models.FTToken{md}); err != nil {
			log.Printf("[admin] ft upsert error %s.%s: %v", t.ContractAddress, t.ContractName, err)
			ftFailed++
			continue
		}
		ftUpdated++
	}

	nftUpdated := 0
	nftFailed := 0
	for _, c := range nftMissing {
		md, ok := fetchNFTCollectionMetadataViaClient(ctx, s.client, c.ContractAddress, c.ContractName)
		if !ok {
			nftFailed++
			continue
		}
		if err := s.repo.UpsertNFTCollections(ctx, []models.NFTCollection{md}); err != nil {
			log.Printf("[admin] nft upsert error %s.%s: %v", c.ContractAddress, c.ContractName, err)
			nftFailed++
			continue
		}
		nftUpdated++
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"ft_missing":  len(ftMissing),
		"ft_updated":  ftUpdated,
		"ft_failed":   ftFailed,
		"nft_missing": len(nftMissing),
		"nft_updated": nftUpdated,
		"nft_failed":  nftFailed,
	})
}

// handleAdminBatchFetchMetadata fetches metadata for all FT tokens and NFT collections
// that are missing metadata, using up to 20 concurrent goroutines.
func (s *Server) handleAdminBatchFetchMetadata(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
		return
	}

	ctx := r.Context()
	const maxConcurrency = 20

	ftMissing, err := s.repo.ListFTTokensMissingMetadata(ctx, 500)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	nftMissing, err := s.repo.ListNFTCollectionsMissingMetadata(ctx, 500)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	type detail struct {
		Identifier string `json:"identifier"`
		Type       string `json:"type"`
		Status     string `json:"status"`
		Error      string `json:"error,omitempty"`
	}

	// Process FT tokens concurrently.
	var ftMu sync.Mutex
	ftUpdated := 0
	ftFailed := 0
	var details []detail
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup

	for _, t := range ftMissing {
		wg.Add(1)
		go func(t models.FTToken) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			id := fmt.Sprintf("A.%s.%s", t.ContractAddress, t.ContractName)
			md, ok := fetchFTMetadataViaClient(ctx, s.client, t.ContractAddress, t.ContractName)
			if !ok {
				ftMu.Lock()
				ftFailed++
				details = append(details, detail{Identifier: id, Type: "ft", Status: "failed", Error: "metadata not available"})
				ftMu.Unlock()
				return
			}
			if err := s.repo.UpsertFTTokens(ctx, []models.FTToken{md}); err != nil {
				log.Printf("[admin] ft upsert error %s: %v", id, err)
				ftMu.Lock()
				ftFailed++
				details = append(details, detail{Identifier: id, Type: "ft", Status: "failed", Error: err.Error()})
				ftMu.Unlock()
				return
			}
			ftMu.Lock()
			ftUpdated++
			details = append(details, detail{Identifier: id, Type: "ft", Status: "updated"})
			ftMu.Unlock()
		}(t)
	}
	wg.Wait()

	// Process NFT collections concurrently.
	nftUpdated := 0
	nftFailed := 0
	for _, c := range nftMissing {
		wg.Add(1)
		go func(c models.NFTCollection) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			id := fmt.Sprintf("A.%s.%s", c.ContractAddress, c.ContractName)
			md, ok := fetchNFTCollectionMetadataViaClient(ctx, s.client, c.ContractAddress, c.ContractName)
			if !ok {
				ftMu.Lock()
				nftFailed++
				details = append(details, detail{Identifier: id, Type: "nft", Status: "failed", Error: "metadata not available"})
				ftMu.Unlock()
				return
			}
			if err := s.repo.UpsertNFTCollections(ctx, []models.NFTCollection{md}); err != nil {
				log.Printf("[admin] nft upsert error %s: %v", id, err)
				ftMu.Lock()
				nftFailed++
				details = append(details, detail{Identifier: id, Type: "nft", Status: "failed", Error: err.Error()})
				ftMu.Unlock()
				return
			}
			ftMu.Lock()
			nftUpdated++
			details = append(details, detail{Identifier: id, Type: "nft", Status: "updated"})
			ftMu.Unlock()
		}(c)
	}
	wg.Wait()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"ft_total":    len(ftMissing),
		"ft_updated":  ftUpdated,
		"ft_failed":   ftFailed,
		"nft_total":   len(nftMissing),
		"nft_updated": nftUpdated,
		"nft_failed":  nftFailed,
		"details":     details,
	})
}

// handleAdminRefetchBridge re-checks EVM bridge addresses for all tokens/collections
// that have metadata but no evm_address.
func (s *Server) handleAdminRefetchBridge(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
		return
	}

	ctx := r.Context()
	script := adminBridgeOnlyScript()
	timeout := 15 * time.Second

	// NFT collections missing bridge
	nftMissing, err := s.repo.ListNFTCollectionsMissingBridge(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	nftUpdated := 0
	nftFailed := 0
	for _, c := range nftMissing {
		identifier := fmt.Sprintf("A.%s.%s.NFT", c.ContractAddress, c.ContractName)
		evmAddr := adminQueryBridgeAddress(ctx, s.client, script, identifier, timeout)
		if evmAddr == "" {
			continue
		}
		if err := s.repo.UpdateEVMBridgeAddress(ctx, "app.nft_collections", c.ContractAddress, c.ContractName, evmAddr); err != nil {
			log.Printf("[admin] nft bridge update error %s.%s: %v", c.ContractAddress, c.ContractName, err)
			nftFailed++
			continue
		}
		log.Printf("[admin] nft bridge updated %s.%s -> %s", c.ContractAddress, c.ContractName, evmAddr)
		nftUpdated++
	}

	// FT tokens missing bridge
	ftMissing, err := s.repo.ListFTTokensMissingBridge(ctx, 10000)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	ftUpdated := 0
	ftFailed := 0
	for _, t := range ftMissing {
		identifier := fmt.Sprintf("A.%s.%s.Vault", t.ContractAddress, t.ContractName)
		evmAddr := adminQueryBridgeAddress(ctx, s.client, script, identifier, timeout)
		if evmAddr == "" {
			continue
		}
		if err := s.repo.UpdateEVMBridgeAddress(ctx, "app.ft_tokens", t.ContractAddress, t.ContractName, evmAddr); err != nil {
			log.Printf("[admin] ft bridge update error %s.%s: %v", t.ContractAddress, t.ContractName, err)
			ftFailed++
			continue
		}
		log.Printf("[admin] ft bridge updated %s.%s -> %s", t.ContractAddress, t.ContractName, evmAddr)
		ftUpdated++
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"nft_checked": len(nftMissing),
		"nft_updated": nftUpdated,
		"nft_failed":  nftFailed,
		"ft_checked":  len(ftMissing),
		"ft_updated":  ftUpdated,
		"ft_failed":   ftFailed,
	})
}

func adminQueryBridgeAddress(ctx context.Context, client FlowClient, script string, identifier string, timeout time.Duration) string {
	idVal, _ := cadence.NewString(identifier)
	ctxExec, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(script), []cadence.Value{idVal})
	if err != nil {
		return ""
	}
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if s, ok := v.(cadence.String); ok {
		return string(s)
	}
	return ""
}

func adminBridgeOnlyScript() string {
	evmBridgeAddr := adminGetEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", config.Addr().FlowEVMBridgeConfig)
	return fmt.Sprintf(`
		import FlowEVMBridgeConfig from 0x%s

		access(all) fun main(identifier: String): String? {
			if let type = CompositeType(identifier) {
				if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
					return "0x".concat(address.toString())
				}
			}
			return nil
		}
	`, evmBridgeAddr)
}

// --- helpers (reuse logic from token_metadata_worker but using the FlowClient interface) ---

func fetchFTMetadataViaClient(ctx context.Context, client FlowClient, contractAddr, contractName string) (models.FTToken, bool) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)
	timeout := 15 * time.Second

	ctxExec, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(adminFTCombinedScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		log.Printf("[admin] FT combined script error for %s.%s: %v", contractAddr, contractName, err)
		return models.FTToken{}, false
	}

	v = adminUnwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.FTToken{}, false
	}

	fields := s.FieldsMappedByName()
	token := models.FTToken{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            adminCadenceToString(fields["name"]),
		Symbol:          adminCadenceToString(fields["symbol"]),
		Description:     adminCadenceToString(fields["description"]),
		ExternalURL:     adminCadenceToString(fields["externalURL"]),
		VaultPath:       adminCadencePathToString(fields["storagePath"]),
		ReceiverPath:    adminCadencePathToString(fields["receiverPath"]),
		BalancePath:     adminCadencePathToString(fields["balancePath"]),
		EVMAddress:      adminCadenceToString(fields["evmAddress"]),
		TotalSupply:     adminCadenceUFix64ToString(fields["totalSupply"]),
	}

	token.Logo = adminExtractFirstMediaURL(fields["logos"])
	token.Socials = adminExtractSocials(fields["socials"])

	if token.Name == "" && token.Symbol == "" {
		return models.FTToken{}, false
	}

	return token, true
}

func fetchNFTCollectionMetadataViaClient(ctx context.Context, client FlowClient, contractAddr, contractName string) (models.NFTCollection, bool) {
	addr := flowsdk.HexToAddress(contractAddr)
	nameVal, _ := cadence.NewString(contractName)
	timeout := 15 * time.Second

	ctxExec, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	v, err := client.ExecuteScriptAtLatestBlock(ctxExec, []byte(adminNFTCollectionDisplayWithBridgeScript()), []cadence.Value{
		cadence.NewAddress([8]byte(addr)),
		nameVal,
	})
	if err != nil {
		return models.NFTCollection{}, false
	}

	v = adminUnwrapOptional(v)
	s, ok := v.(cadence.Struct)
	if !ok {
		return models.NFTCollection{}, false
	}
	topFields := s.FieldsMappedByName()

	// Extract EVM address from the wrapper struct.
	evmAddress := adminCadenceToString(topFields["evmAddress"])

	// Extract the display struct.
	displayVal := adminUnwrapOptional(topFields["display"])
	if displayVal == nil {
		if evmAddress != "" {
			return models.NFTCollection{
				ContractAddress: contractAddr,
				ContractName:    contractName,
				EVMAddress:      evmAddress,
			}, true
		}
		return models.NFTCollection{}, false
	}
	displayStruct, ok := displayVal.(cadence.Struct)
	if !ok {
		return models.NFTCollection{}, false
	}
	fields := displayStruct.FieldsMappedByName()
	name := adminCadenceToString(fields["name"])
	if name == "" {
		return models.NFTCollection{}, false
	}

	description := adminCadenceToString(fields["description"])
	externalURL := ""
	if ext := adminUnwrapOptional(fields["externalURL"]); ext != nil {
		if st, ok := ext.(cadence.Struct); ok {
			externalURL = adminCadenceToString(st.FieldsMappedByName()["url"])
		}
	}

	socials := adminExtractSocials(fields["socials"])

	symbol := contractName

	return models.NFTCollection{
		ContractAddress: contractAddr,
		ContractName:    contractName,
		Name:            name,
		Symbol:          symbol,
		Description:     description,
		ExternalURL:     externalURL,
		SquareImage:     adminExtractMediaImageURL(fields["squareImage"]),
		BannerImage:     adminExtractMediaImageURL(fields["bannerImage"]),
		Socials:         socials,
		EVMAddress:      evmAddress,
	}, true
}

// --- Import Token handlers ---

func (s *Server) handleAdminImportTokenPreview(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
		return
	}

	var req struct {
		Address      string `json:"address"`
		ContractName string `json:"contract_name"`
		Type         string `json:"type"` // "ft" or "nft"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.Address = strings.TrimPrefix(strings.TrimSpace(req.Address), "0x")
	req.ContractName = strings.TrimSpace(req.ContractName)
	if req.Address == "" || req.ContractName == "" {
		writeAPIError(w, http.StatusBadRequest, "address and contract_name are required")
		return
	}
	if req.Type != "ft" && req.Type != "nft" {
		writeAPIError(w, http.StatusBadRequest, "type must be 'ft' or 'nft'")
		return
	}

	ctx := r.Context()

	if req.Type == "ft" {
		md, ok := fetchFTMetadataViaClient(ctx, s.client, req.Address, req.ContractName)
		if !ok {
			writeAPIError(w, http.StatusNotFound, "could not fetch FT metadata from chain")
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"data": md})
	} else {
		md, ok := fetchNFTCollectionMetadataViaClient(ctx, s.client, req.Address, req.ContractName)
		if !ok {
			writeAPIError(w, http.StatusNotFound, "could not fetch NFT metadata from chain")
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"data": md})
	}
}

func (s *Server) handleAdminSaveImportedToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type            string `json:"type"` // "ft" or "nft"
		ContractAddress string `json:"contract_address"`
		ContractName    string `json:"contract_name"`
		Name            string `json:"name"`
		Symbol          string `json:"symbol"`
		Description     string `json:"description"`
		ExternalURL     string `json:"external_url"`
		// FT-specific
		Logo         string `json:"logo"`
		Decimals     int    `json:"decimals"`
		VaultPath    string `json:"vault_path"`
		ReceiverPath string `json:"receiver_path"`
		BalancePath  string `json:"balance_path"`
		// NFT-specific
		SquareImage string `json:"square_image"`
		BannerImage string `json:"banner_image"`
		// Shared
		EVMAddress string `json:"evm_address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.ContractAddress = strings.TrimPrefix(strings.TrimSpace(req.ContractAddress), "0x")
	if req.ContractAddress == "" || req.ContractName == "" {
		writeAPIError(w, http.StatusBadRequest, "contract_address and contract_name are required")
		return
	}
	if req.Type != "ft" && req.Type != "nft" {
		writeAPIError(w, http.StatusBadRequest, "type must be 'ft' or 'nft'")
		return
	}

	ctx := r.Context()

	if req.Type == "ft" {
		token := models.FTToken{
			ContractAddress: req.ContractAddress,
			ContractName:    req.ContractName,
			Name:            req.Name,
			Symbol:          req.Symbol,
			Decimals:        req.Decimals,
			Description:     req.Description,
			ExternalURL:     req.ExternalURL,
			Logo:            req.Logo,
			VaultPath:       req.VaultPath,
			ReceiverPath:    req.ReceiverPath,
			BalancePath:     req.BalancePath,
			EVMAddress:      req.EVMAddress,
		}
		if err := s.repo.UpsertFTTokens(ctx, []models.FTToken{token}); err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	} else {
		coll := models.NFTCollection{
			ContractAddress: req.ContractAddress,
			ContractName:    req.ContractName,
			Name:            req.Name,
			Symbol:          req.Symbol,
			Description:     req.Description,
			ExternalURL:     req.ExternalURL,
			SquareImage:     req.SquareImage,
			BannerImage:     req.BannerImage,
			EVMAddress:      req.EVMAddress,
		}
		if err := s.repo.UpsertNFTCollections(ctx, []models.NFTCollection{coll}); err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	}
}

// --- Cadence helpers (prefixed to avoid collision with ingester package) ---

func adminUnwrapOptional(v cadence.Value) cadence.Value {
	if opt, ok := v.(cadence.Optional); ok {
		if opt.Value == nil {
			return nil
		}
		return opt.Value
	}
	return v
}

func adminCadenceToString(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if s, ok := v.(cadence.String); ok {
		return string(s)
	}
	return ""
}

func adminCadencePathToString(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if p, ok := v.(cadence.Path); ok {
		return "/" + p.Domain.Identifier() + "/" + p.Identifier
	}
	return adminCadenceToString(v)
}

func adminCadenceUFix64ToString(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	if fix, ok := v.(cadence.UFix64); ok {
		return fix.String()
	}
	return ""
}

func adminCadenceToInt(v cadence.Value) (int, bool) {
	v = adminUnwrapOptional(v)
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

// --- Cadence scripts ---

func adminGetEnvOrDefault(key, def string) string {
	v := strings.TrimPrefix(strings.TrimSpace(os.Getenv(key)), "0x")
	if v == "" {
		return def
	}
	return v
}

func adminViewResolverAddr() string {
	if v := adminGetEnvOrDefault("FLOW_VIEW_RESOLVER_ADDRESS", ""); v != "" {
		return v
	}
	if v := adminGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS", ""); v != "" {
		return v
	}
	if v := adminGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", ""); v != "" {
		return v
	}
	return config.Addr().MetadataViews
}

func adminFTAddr() string {
	return adminGetEnvOrDefault("FLOW_FUNGIBLE_TOKEN_ADDRESS", config.Addr().FungibleToken)
}

func adminFTMetadataViewsAddr() string {
	if v := adminGetEnvOrDefault("FLOW_FUNGIBLE_TOKEN_METADATA_VIEWS_ADDRESS", ""); v != "" {
		return v
	}
	return adminFTAddr()
}

// adminFTCombinedScript fetches both FTDisplay and FTVaultData in a single call.
// Iterates the contract account's storage to find vaults, then calls vault.resolveView().
// This approach works for all contracts including those in recovered state.
func adminFTCombinedScript() string {
	evmBridgeAddr := adminGetEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", config.Addr().FlowEVMBridgeConfig)

	return fmt.Sprintf(`
        import ViewResolver from 0x%s
        import FungibleToken from 0x%s
        import FungibleTokenMetadataViews from 0x%s
        import MetadataViews from 0x%s
        import FlowEVMBridgeConfig from 0x%s

        access(all) fun getEVMAddress(identifier: String): String? {
            if let type = CompositeType(identifier) {
                if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
                    return "0x".concat(address.toString())
                }
            }
            return nil
        }

        access(all) struct FTInfo {
            access(all) let name: String?
            access(all) let symbol: String?
            access(all) let description: String?
            access(all) let externalURL: String?
            access(all) let logos: MetadataViews.Medias?
            access(all) let socials: {String: MetadataViews.ExternalURL}?
            access(all) let storagePath: StoragePath?
            access(all) let receiverPath: PublicPath?
            access(all) let balancePath: PublicPath?
            access(all) let evmAddress: String?
            access(all) let totalSupply: UFix64

            init(
                name: String?, symbol: String?, description: String?,
                externalURL: String?,
                logos: MetadataViews.Medias?,
                socials: {String: MetadataViews.ExternalURL}?,
                storagePath: StoragePath?, receiverPath: PublicPath?, balancePath: PublicPath?,
                evmAddress: String?,
                totalSupply: UFix64
            ) {
                self.name = name
                self.symbol = symbol
                self.description = description
                self.externalURL = externalURL
                self.logos = logos
                self.socials = socials
                self.storagePath = storagePath
                self.receiverPath = receiverPath
                self.balancePath = balancePath
                self.evmAddress = evmAddress
                self.totalSupply = totalSupply
            }
        }

        access(all) fun main(contractAddress: Address, contractName: String): FTInfo? {
            let displayType = Type<FungibleTokenMetadataViews.FTDisplay>()
            let dataType = Type<FungibleTokenMetadataViews.FTVaultData>()

            var display: FungibleTokenMetadataViews.FTDisplay? = nil
            var data: FungibleTokenMetadataViews.FTVaultData? = nil

            // Try 1: Borrow vault from storage and call resolveView.
            // Safe for recovered contracts (skips them via isRecovered check).
            let authAcct = getAuthAccount<auth(BorrowValue) &Account>(contractAddress)
            let ftVaultType = Type<@{FungibleToken.Vault}>()
            authAcct.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
                if type.isRecovered { return true }
                if !type.isSubtype(of: ftVaultType) { return true }
                let parts = type.identifier.split(separator: ".")
                if parts.length < 3 { return true }
                if parts[2] != contractName { return true }
                let vault = authAcct.storage.borrow<&{FungibleToken.Vault}>(from: path)
                if vault == nil { return true }
                display = vault!.resolveView(displayType) as! FungibleTokenMetadataViews.FTDisplay?
                data = vault!.resolveView(dataType) as! FungibleTokenMetadataViews.FTVaultData?
                return false
            })

            // Try 2: ViewResolver contract borrow fallback.
            // For contracts that don't have a vault in the deployer's storage.
            if display == nil {
                let acct = getAccount(contractAddress)
                let viewResolver = acct.contracts.borrow<&{ViewResolver}>(name: contractName)
                if viewResolver != nil {
                    display = viewResolver!.resolveContractView(resourceType: nil, viewType: displayType) as! FungibleTokenMetadataViews.FTDisplay?
                    data = viewResolver!.resolveContractView(resourceType: nil, viewType: dataType) as! FungibleTokenMetadataViews.FTVaultData?
                }
            }

            if display == nil { return nil }

            var extURL: String? = nil
            if display!.externalURL != nil {
                extURL = display!.externalURL!.url
            }

            let identifier = "A.".concat(contractAddress.toString().slice(from: 2, upTo: contractAddress.toString().length)).concat(".").concat(contractName).concat(".Vault")
            let evmAddr = getEVMAddress(identifier: identifier)

            // Read totalSupply via FungibleTokenMetadataViews.TotalSupply view
            var supply: UFix64 = 0.0
            let supplyType = Type<FungibleTokenMetadataViews.TotalSupply>()
            let vrAcct = getAccount(contractAddress)
            if let vr = vrAcct.contracts.borrow<&{ViewResolver}>(name: contractName) {
                if let ts = vr.resolveContractView(resourceType: nil, viewType: supplyType) as! FungibleTokenMetadataViews.TotalSupply? {
                    supply = ts.supply
                }
            }

            return FTInfo(
                name: display!.name,
                symbol: display!.symbol,
                description: display!.description,
                externalURL: extURL,
                logos: display!.logos,
                socials: display!.socials,
                storagePath: data?.storagePath,
                receiverPath: data?.receiverPath,
                balancePath: data?.metadataPath,
                evmAddress: evmAddr,
                totalSupply: supply
            )
        }
    `, adminViewResolverAddr(), adminFTAddr(), adminFTMetadataViewsAddr(), adminViewResolverAddr(), evmBridgeAddr)
}

// adminNFTCollectionDisplayWithBridgeScript returns the combined script that fetches
// both NFTCollectionDisplay metadata and the EVM bridge address.
func adminNFTCollectionDisplayWithBridgeScript() string {
	metadataViewsAddr := adminGetEnvOrDefault("FLOW_METADATA_VIEWS_ADDRESS", "")
	if metadataViewsAddr == "" {
		metadataViewsAddr = adminGetEnvOrDefault("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS", config.Addr().MetadataViews)
	}
	evmBridgeAddr := adminGetEnvOrDefault("FLOW_EVM_BRIDGE_CONFIG_ADDRESS", config.Addr().FlowEVMBridgeConfig)

	return fmt.Sprintf(`
        import ViewResolver from 0x%s
        import MetadataViews from 0x%s
        import FlowEVMBridgeConfig from 0x%s

        access(all) struct NFTCollectionInfo {
            access(all) let display: MetadataViews.NFTCollectionDisplay?
            access(all) let evmAddress: String?

            init(display: MetadataViews.NFTCollectionDisplay?, evmAddress: String?) {
                self.display = display
                self.evmAddress = evmAddress
            }
        }

        access(all) fun getEVMAddress(identifier: String): String? {
            if let type = CompositeType(identifier) {
                if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
                    return "0x".concat(address.toString())
                }
            }
            return nil
        }

        access(all) fun main(contractAddress: Address, contractName: String): NFTCollectionInfo? {
            let acct = getAccount(contractAddress)
            let viewResolver = acct.contracts.borrow<&{ViewResolver}>(name: contractName)
            if viewResolver == nil { return nil }
            let display = viewResolver!.resolveContractView(
                resourceType: nil,
                viewType: Type<MetadataViews.NFTCollectionDisplay>()
            ) as! MetadataViews.NFTCollectionDisplay?

            let identifier = "A.".concat(contractAddress.toString().slice(from: 2, upTo: contractAddress.toString().length)).concat(".").concat(contractName).concat(".NFT")
            let evmAddr = getEVMAddress(identifier: identifier)

            return NFTCollectionInfo(display: display, evmAddress: evmAddr)
        }
    `, adminViewResolverAddr(), metadataViewsAddr, evmBridgeAddr)
}

// --- Cadence value extraction helpers (admin-prefixed to avoid collision with ingester) ---

func adminExtractFirstMediaURL(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return ""
	}
	items := adminUnwrapOptional(s.FieldsMappedByName()["items"])
	if items == nil {
		return ""
	}
	arr, ok := items.(cadence.Array)
	if !ok {
		return ""
	}
	for _, elem := range arr.Values {
		media, ok := adminUnwrapOptional(elem).(cadence.Struct)
		if !ok {
			continue
		}
		url := adminExtractMediaFileURL(media.FieldsMappedByName()["file"])
		if url != "" {
			return url
		}
	}
	return ""
}

func adminExtractMediaURLs(v cadence.Value) []byte {
	v = adminUnwrapOptional(v)
	if v == nil {
		return nil
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return nil
	}
	items := adminUnwrapOptional(s.FieldsMappedByName()["items"])
	if items == nil {
		return nil
	}
	arr, ok := items.(cadence.Array)
	if !ok {
		return nil
	}
	type mediaItem struct {
		URL       string `json:"url"`
		MediaType string `json:"mediaType,omitempty"`
	}
	var result []mediaItem
	for _, elem := range arr.Values {
		media, ok := adminUnwrapOptional(elem).(cadence.Struct)
		if !ok {
			continue
		}
		mf := media.FieldsMappedByName()
		url := adminExtractMediaFileURL(mf["file"])
		if url == "" {
			continue
		}
		mt := adminCadenceToString(mf["mediaType"])
		result = append(result, mediaItem{URL: url, MediaType: mt})
	}
	if len(result) == 0 {
		return nil
	}
	b, _ := json.Marshal(result)
	return b
}

func adminExtractMediaFileURL(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return adminTrimQuotes(adminCadenceToString(v))
	}
	fields := s.FieldsMappedByName()
	if url := adminCadenceToString(fields["url"]); url != "" {
		return adminTrimQuotes(url)
	}
	if cid := adminTrimQuotes(adminCadenceToString(fields["cid"])); cid != "" {
		path := adminTrimQuotes(adminCadenceToString(fields["path"]))
		if path != "" {
			return "https://ipfs.io/ipfs/" + cid + "/" + path
		}
		return "https://ipfs.io/ipfs/" + cid
	}
	return ""
}

func adminTrimQuotes(s string) string {
	return strings.Trim(s, "\"")
}

func adminExtractMediaImageURL(v cadence.Value) string {
	v = adminUnwrapOptional(v)
	if v == nil {
		return ""
	}
	s, ok := v.(cadence.Struct)
	if !ok {
		return ""
	}
	return adminExtractMediaFileURL(s.FieldsMappedByName()["file"])
}

func adminExtractSocials(v cadence.Value) []byte {
	v = adminUnwrapOptional(v)
	if v == nil {
		return nil
	}
	dict, ok := v.(cadence.Dictionary)
	if !ok {
		return nil
	}
	result := make(map[string]string)
	for _, pair := range dict.Pairs {
		key := adminCadenceToString(pair.Key)
		if key == "" {
			continue
		}
		val := adminUnwrapOptional(pair.Value)
		if val == nil {
			continue
		}
		if st, ok := val.(cadence.Struct); ok {
			url := adminCadenceToString(st.FieldsMappedByName()["url"])
			if url != "" {
				result[key] = url
			}
		} else if s := adminCadenceToString(val); s != "" {
			result[key] = s
		}
	}
	if len(result) == 0 {
		return nil
	}
	b, _ := json.Marshal(result)
	return b
}

// handleAdminRefreshDailyStats triggers a full re-aggregation of daily_stats.
// POST /admin/refresh-daily-stats
func (s *Server) handleAdminRefreshDailyStats(w http.ResponseWriter, r *http.Request) {
	log.Printf("[admin] Triggering full daily stats refresh")
	go func() {
		ctx := context.Background()
		if err := s.repo.RefreshDailyStats(ctx, true); err != nil {
			log.Printf("[admin] daily stats refresh error: %v", err)
		} else {
			log.Printf("[admin] daily stats refresh complete")
		}
	}()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Daily stats refresh started in background",
	})
}

// handleAdminBackfillAnalytics triggers analytics deriver backfill for a block range.
// POST /admin/backfill-analytics  {"from_height":123,"to_height":456}
func (s *Server) handleAdminBackfillAnalytics(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FromHeight uint64 `json:"from_height"`
		ToHeight   uint64 `json:"to_height"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.FromHeight == 0 || req.ToHeight == 0 || req.ToHeight <= req.FromHeight {
		writeAPIError(w, http.StatusBadRequest, "invalid range: require from_height > 0 and to_height > from_height")
		return
	}

	log.Printf("[admin] Triggering analytics backfill range [%d, %d)", req.FromHeight, req.ToHeight)
	go func() {
		ctx := context.Background()
		worker := ingester.NewAnalyticsDeriverWorker(s.repo)
		if err := worker.ProcessRange(ctx, req.FromHeight, req.ToHeight); err != nil {
			log.Printf("[admin] analytics backfill error [%d,%d): %v", req.FromHeight, req.ToHeight, err)
			return
		}
		log.Printf("[admin] analytics backfill complete [%d, %d)", req.FromHeight, req.ToHeight)
	}()

	writeAPIResponse(w, map[string]interface{}{
		"message":     "Analytics backfill started in background",
		"from_height": req.FromHeight,
		"to_height":   req.ToHeight,
	}, nil, nil)
}

// handleAdminResetTokenWorker fixes cross-VM FLOW transfer data.
// It deletes bogus FT transfers with contract_name='EVM' and resets the
// token_worker to re-process from the earliest affected block height.
func (s *Server) handleAdminResetTokenWorker(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 1. Delete bogus EVM FT transfers and get earliest affected height
	evmDeleted, minHeight, err := s.repo.DeleteFTTransfersByContractName(ctx, "EVM")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "delete EVM transfers: "+err.Error())
		return
	}
	log.Printf("[admin] Deleted %d bogus EVM FT transfers (earliest height: %d)", evmDeleted, minHeight)

	if minHeight == 0 {
		writeAPIResponse(w, map[string]interface{}{
			"evm_transfers_deleted": evmDeleted,
			"message":               "No bogus EVM transfers found. Nothing to reset.",
		}, nil, nil)
		return
	}

	// 2. Align to range boundary (TOKEN_WORKER_RANGE default 1000)
	resetHeight := (minHeight / 1000) * 1000

	// 3. Reset token_worker from the earliest affected height
	leasesDeleted, err := s.repo.ResetWorkerToHeight(ctx, "token_worker", resetHeight)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "reset token_worker: "+err.Error())
		return
	}
	log.Printf("[admin] Reset token_worker to height %d: deleted %d leases", resetHeight, leasesDeleted)

	writeAPIResponse(w, map[string]interface{}{
		"reset_from_height":     resetHeight,
		"evm_transfers_deleted": evmDeleted,
		"leases_deleted":        leasesDeleted,
		"message":               fmt.Sprintf("token_worker reset to height %d. It will re-process from there on next tick.", resetHeight),
	}, nil, nil)
}

// handleAdminResetHistoryDeriver resets history_deriver checkpoints to a given height.
// POST /admin/reset-history-deriver  {"height": 123000000}
// This allows re-processing of blocks that were skipped due to processor failures.
func (s *Server) handleAdminResetHistoryDeriver(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Height uint64 `json:"height"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Height == 0 {
		writeAPIError(w, http.StatusBadRequest, "height is required and must be > 0")
		return
	}

	ctx := r.Context()

	// Reset both UP and DOWN cursors (force set, ignoring GREATEST/LEAST).
	if err := s.repo.SetCheckpoint(ctx, "history_deriver", req.Height); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "reset history_deriver: "+err.Error())
		return
	}
	if err := s.repo.SetCheckpoint(ctx, "history_deriver_down", req.Height); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "reset history_deriver_down: "+err.Error())
		return
	}

	log.Printf("[admin] Reset history_deriver UP and DOWN checkpoints to %d", req.Height)

	writeAPIResponse(w, map[string]interface{}{
		"reset_to_height": req.Height,
		"message":         fmt.Sprintf("history_deriver checkpoints reset to %d. It will re-process from there.", req.Height),
	}, nil, nil)
}

// handleAdminResolveErrors marks indexing errors as resolved for a given worker.
// POST /admin/resolve-errors  {"worker": "accounts_worker"}
func (s *Server) handleAdminResolveErrors(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Worker string `json:"worker"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Worker == "" {
		writeAPIError(w, http.StatusBadRequest, "worker is required")
		return
	}

	ctx := r.Context()
	count, err := s.repo.ResolveErrorsByWorker(ctx, req.Worker)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[admin] Resolved %d errors for worker %s", count, req.Worker)

	writeAPIResponse(w, map[string]interface{}{
		"worker":   req.Worker,
		"resolved": count,
	}, nil, nil)
}

// handleAdminListSkippedRanges returns unresolved LIVE_DERIVER_SKIPPED errors.
// GET /admin/skipped-ranges?worker=tx_contracts_worker
func (s *Server) handleAdminListSkippedRanges(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	worker := r.URL.Query().Get("worker")

	rows, err := s.repo.ListSkippedRanges(ctx, worker)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, map[string]interface{}{
		"skipped_ranges": rows,
		"count":          len(rows),
	}, nil, nil)
}

// handleAdminRedirectHistoryIngester resets the history_ingester checkpoint to a
// specific height so it starts backfilling downward from there. This is used to
// fill raw block gaps between the history ingester's current position and the
// forward ingester's starting range.
// POST /admin/redirect-history-ingester  {"height": 140000000}
func (s *Server) handleAdminRedirectHistoryIngester(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Height uint64 `json:"height"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Height == 0 {
		writeAPIError(w, http.StatusBadRequest, "height is required and must be > 0")
		return
	}

	ctx := r.Context()

	// Get current checkpoint for logging.
	current, _ := s.repo.GetLastIndexedHeight(ctx, "history_ingester")

	// Force-set the history_ingester checkpoint.
	if err := s.repo.SetCheckpoint(ctx, "history_ingester", req.Height); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "set history_ingester: "+err.Error())
		return
	}

	log.Printf("[admin] Redirected history_ingester from %d to %d (will backfill downward from there)", current, req.Height)

	writeAPIResponse(w, map[string]interface{}{
		"previous_height": current,
		"new_height":      req.Height,
		"message":         fmt.Sprintf("history_ingester checkpoint moved from %d to %d. It will backfill downward from there on next restart.", current, req.Height),
	}, nil, nil)
}

// handleAdminListErrors returns unresolved indexing errors with optional worker filter.
// GET /admin/errors?worker=accounts_worker&limit=100
func (s *Server) handleAdminListErrors(w http.ResponseWriter, r *http.Request) {
	worker := r.URL.Query().Get("worker")
	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := fmt.Sscanf(l, "%d", &limit); err != nil || v != 1 {
			limit = 100
		}
	}

	errors, err := s.repo.ListIndexingErrors(r.Context(), worker, limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	// Also get top error messages grouped
	counts, err := s.repo.GetErrorMessageCounts(r.Context(), worker, 20)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	writeAPIResponse(w, map[string]interface{}{
		"errors":         errors,
		"message_counts": counts,
		"total":          len(errors),
		"filter_worker":  worker,
	}, nil, nil)
}

// handleAdminBackfillStakingBlocks runs staking_worker on specific block heights.
// POST /admin/backfill-staking  {"heights": [142651980, 141896604, ...]}
func (s *Server) handleAdminBackfillStakingBlocks(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Heights []uint64 `json:"heights"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.Heights) == 0 {
		writeAPIError(w, http.StatusBadRequest, "heights array is required")
		return
	}
	if len(req.Heights) > 500 {
		writeAPIError(w, http.StatusBadRequest, "max 500 heights per request")
		return
	}

	ctx := r.Context()
	worker := ingester.NewStakingWorker(s.repo)

	var processed, errored int
	var errMsgs []string
	for _, h := range req.Heights {
		if err := worker.ProcessRange(ctx, h, h+1); err != nil {
			errored++
			errMsgs = append(errMsgs, fmt.Sprintf("height %d: %v", h, err))
		} else {
			processed++
		}
	}

	log.Printf("[admin] backfill-staking: processed=%d errored=%d total=%d", processed, errored, len(req.Heights))

	writeAPIResponse(w, map[string]interface{}{
		"processed": processed,
		"errored":   errored,
		"total":     len(req.Heights),
		"errors":    errMsgs,
	}, nil, nil)
}

// handleAdminReprocessWorker re-runs a specific worker (forward) for a height range.
// POST /admin/reprocess-worker
//
//	{"worker": "token_worker", "from_height": 85000000, "to_height": 143000000,
//	 "chunk_size": 1000, "concurrency": 4, "delete_staking_transfers": true}
//
// Supported workers: token_worker, evm_worker
func (s *Server) handleAdminReprocessWorker(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Worker                  string `json:"worker"`
		FromHeight              uint64 `json:"from_height"`
		ToHeight                uint64 `json:"to_height"`
		ChunkSize               uint64 `json:"chunk_size"`
		Concurrency             int    `json:"concurrency"`
		DeleteStakingTransfers  bool   `json:"delete_staking_transfers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Worker == "" || req.FromHeight == 0 || req.ToHeight == 0 {
		writeAPIError(w, http.StatusBadRequest, "worker, from_height, and to_height are required")
		return
	}
	if req.ToHeight < req.FromHeight {
		writeAPIError(w, http.StatusBadRequest, "to_height must be >= from_height")
		return
	}
	if req.ChunkSize == 0 {
		req.ChunkSize = 1000
	}
	if req.Concurrency < 1 {
		req.Concurrency = 1
	}
	if req.Concurrency > 16 {
		req.Concurrency = 16
	}

	// Instantiate the worker
	var proc ingester.Processor
	switch req.Worker {
	case "token_worker":
		proc = ingester.NewTokenWorker(s.repo)
	case "evm_worker":
		proc = ingester.NewEVMWorker(s.repo)
	case "proposer_key_backfill":
		if s.client == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "no Flow client configured")
			return
		}
		proc = ingester.NewProposerKeyBackfillWorker(s.repo, s.client)
	default:
		writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("unsupported worker: %s (supported: token_worker, evm_worker, proposer_key_backfill)", req.Worker))
		return
	}

	// Optional: delete staking FT transfers before re-processing
	if req.DeleteStakingTransfers && req.Worker == "token_worker" {
		stakingContracts := []string{"FlowIDTableStaking", "FlowStakingCollection", "LockedTokens", "FlowEpoch", "FlowDKG", "FlowClusterQC"}
		for _, cn := range stakingContracts {
			deleted, _, err := s.repo.DeleteFTTransfersByContractName(r.Context(), cn)
			if err != nil {
				log.Printf("[admin] reprocess-worker: failed to delete %s transfers: %v", cn, err)
			} else if deleted > 0 {
				log.Printf("[admin] reprocess-worker: deleted %d bogus %s FT transfers", deleted, cn)
			}
		}
	}

	// Build chunks
	type chunk struct{ from, to uint64 }
	var chunks []chunk
	for h := req.FromHeight; h < req.ToHeight; h += req.ChunkSize {
		end := h + req.ChunkSize
		if end > req.ToHeight {
			end = req.ToHeight
		}
		chunks = append(chunks, chunk{from: h, to: end})
	}

	totalChunks := len(chunks)
	log.Printf("[admin] reprocess-worker: %s from %d to %d (%d chunks, concurrency=%d)",
		req.Worker, req.FromHeight, req.ToHeight, totalChunks, req.Concurrency)

	// Process in parallel with bounded concurrency
	// Run in background goroutine so the HTTP response returns immediately.
	go func() {
		sem := make(chan struct{}, req.Concurrency)
		var mu sync.Mutex
		processed := 0
		errored := 0
		startTime := time.Now()

		for i, c := range chunks {
			sem <- struct{}{}
			go func(idx int, ch chunk) {
				defer func() { <-sem }()
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				if err := proc.ProcessRange(ctx, ch.from, ch.to); err != nil {
					mu.Lock()
					errored++
					mu.Unlock()
					log.Printf("[admin] reprocess-worker: %s chunk [%d,%d) FAILED: %v", req.Worker, ch.from, ch.to, err)
				} else {
					mu.Lock()
					processed++
					p := processed
					e := errored
					mu.Unlock()
					if p%100 == 0 || p+e == totalChunks {
						elapsed := time.Since(startTime).Round(time.Second)
						log.Printf("[admin] reprocess-worker: %s progress %d/%d (errors=%d) elapsed=%s",
							req.Worker, p, totalChunks, e, elapsed)
					}
				}
			}(i, c)
		}
		// Wait for all goroutines
		for i := 0; i < req.Concurrency; i++ {
			sem <- struct{}{}
		}
		elapsed := time.Since(startTime).Round(time.Second)
		log.Printf("[admin] reprocess-worker: %s DONE processed=%d errored=%d total=%d elapsed=%s",
			req.Worker, processed, errored, totalChunks, elapsed)
	}()

	writeAPIResponse(w, map[string]interface{}{
		"worker":      req.Worker,
		"from_height": req.FromHeight,
		"to_height":   req.ToHeight,
		"chunk_size":  req.ChunkSize,
		"concurrency": req.Concurrency,
		"total_chunks": totalChunks,
		"message":     fmt.Sprintf("Reprocessing %s from %d to %d in background (%d chunks). Check server logs for progress.", req.Worker, req.FromHeight, req.ToHeight, totalChunks),
	}, nil, nil)
}
