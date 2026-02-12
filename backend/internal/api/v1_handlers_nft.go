package api

import (
	"net/http"

	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

func (s *Server) handleFlowNFTTransfers(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	height, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	addrFilter := normalizeAddr(r.URL.Query().Get("address"))
	tokenAddr, tokenName := parseTokenParam(r.URL.Query().Get("nft_type"))
	transfers, hasMore, err := s.repo.ListTokenTransfersWithContractFiltered(r.Context(), true, addrFilter, tokenAddr, tokenName, r.URL.Query().Get("transaction_hash"), height, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	nftIDs := collectTransferTokenIDs(transfers, true)
	nftMeta, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), nftIDs)
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		id := formatTokenIdentifier(t.TokenContractAddress, t.ContractName)
		var m *repository.TokenMetadataInfo
		if meta, ok := nftMeta[id]; ok {
			m = &meta
		}
		out = append(out, toNFTTransferOutput(t.TokenTransfer, t.ContractName, addrFilter, m))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

func (s *Server) handleFlowListNFTCollections(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	collections, err := s.repo.ListNFTCollectionSummaries(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	total, err := s.repo.CountNFTCollectionSummaries(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(collections))
	for _, c := range collections {
		out = append(out, toNFTCollectionOutput(c))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": total}, nil)
}

func (s *Server) handleFlowGetNFTCollection(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	summary, err := s.repo.GetNFTCollectionSummary(r.Context(), collectionAddr, collectionName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if summary == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toNFTCollectionOutput(*summary)}, nil, nil)
}

func (s *Server) handleFlowNFTHoldingsByCollection(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	rows, hasMore, err := s.repo.ListNFTOwnerCountsByCollection(r.Context(), collectionAddr, collectionName, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	totalNFTs, err := s.repo.CountNFTsByCollection(r.Context(), collectionAddr, collectionName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		percentage := 0.0
		if totalNFTs > 0 {
			percentage = float64(row.Count) / float64(totalNFTs)
		}
		out = append(out, toNFTHoldingOutput(row.Owner, row.Count, percentage, formatTokenIdentifier(collectionAddr, collectionName)))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore, "total_nfts": totalNFTs}, nil)
}

func (s *Server) handleFlowTopNFTAccounts(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	rows, hasMore, err := s.repo.ListNFTOwnerCountsByCollection(r.Context(), collectionAddr, collectionName, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	totalNFTs, err := s.repo.CountNFTsByCollection(r.Context(), collectionAddr, collectionName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		percentage := 0.0
		if totalNFTs > 0 {
			percentage = float64(row.Count) / float64(totalNFTs)
		}
		out = append(out, toNFTHoldingOutput(row.Owner, row.Count, percentage, formatTokenIdentifier(collectionAddr, collectionName)))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore, "total_nfts": totalNFTs}, nil)
}

func (s *Server) handleFlowNFTItem(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	id := mux.Vars(r)["id"]
	item, err := s.repo.GetNFTOwnership(r.Context(), collectionAddr, collectionName, id)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	out := toCombinedNFTDetails(*item)
	// Enrich with metadata from nft_items if available.
	meta, _ := s.repo.GetNFTItem(r.Context(), collectionAddr, collectionName, id)
	if meta != nil {
		enrichNFTItemOutput(out, meta)
	}
	writeAPIResponse(w, []interface{}{out}, nil, nil)
}

func (s *Server) handleFlowNFTCollectionItems(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)
	items, hasMore, err := s.repo.ListNFTItems(r.Context(), collectionAddr, collectionName, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, toNFTItemOutput(item))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

func (s *Server) handleFlowNFTSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeAPIResponse(w, []interface{}{}, map[string]interface{}{"limit": 0, "offset": 0, "count": 0, "has_more": false}, nil)
		return
	}
	collectionAddr, collectionName := parseTokenParam(r.URL.Query().Get("collection"))
	limit, offset := parseLimitOffset(r)
	items, hasMore, err := s.repo.SearchNFTItems(r.Context(), query, collectionAddr, collectionName, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, toNFTItemOutput(item))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}

func (s *Server) handleFlowNFTItemTransfers(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	id := mux.Vars(r)["id"]
	limit, offset := parseLimitOffset(r)

	transfers, hasMore, err := s.repo.ListNFTItemTransfers(r.Context(), collectionAddr, collectionName, id, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	nftIDs2 := collectTransferTokenIDs(transfers, true)
	nftMeta2, _ := s.repo.GetNFTCollectionMetadataByIdentifiers(r.Context(), nftIDs2)
	out := make([]map[string]interface{}, 0, len(transfers))
	for _, t := range transfers {
		id := formatTokenIdentifier(t.TokenContractAddress, t.ContractName)
		var m *repository.TokenMetadataInfo
		if meta, ok := nftMeta2[id]; ok {
			m = &meta
		}
		out = append(out, toNFTTransferOutput(t.TokenTransfer, t.ContractName, "", m))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out), "has_more": hasMore}, nil)
}
