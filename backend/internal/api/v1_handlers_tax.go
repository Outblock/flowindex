package api

import (
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

// handleTaxReport handles GET /flow/v1/account/{address}/tax-report
// and GET /accounting/v1/account/{address}/tax-report.
//
// Query params:
//   - start_date: ISO date string (e.g. 2024-01-01)
//   - end_date: ISO date string (e.g. 2024-12-31)
//   - limit, offset: pagination
func (s *Server) handleTaxReport(w http.ResponseWriter, r *http.Request) {
	address := normalizeAddr(mux.Vars(r)["address"])
	if address == "" {
		writeAPIError(w, http.StatusBadRequest, "address is required")
		return
	}

	limit, offset := parseLimitOffset(r)

	// Parse optional date range
	startDateStr := r.URL.Query().Get("start_date")
	endDateStr := r.URL.Query().Get("end_date")

	var startDate, endDate *time.Time
	if startDateStr != "" {
		t, err := time.Parse("2006-01-02", startDateStr)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid start_date format, use YYYY-MM-DD")
			return
		}
		startDate = &t
	}
	if endDateStr != "" {
		t, err := time.Parse("2006-01-02", endDateStr)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid end_date format, use YYYY-MM-DD")
			return
		}
		// End of day
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		endDate = &endOfDay
	}

	// Fetch FT transfers for this address
	ftTransfers, ftHasMore, err := s.repo.ListTokenTransfersWithContractFiltered(
		r.Context(), false, address, "", "", "", nil, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Fetch NFT transfers for this address
	nftTransfers, nftHasMore, err := s.repo.ListTokenTransfersWithContractFiltered(
		r.Context(), true, address, "", "", "", nil, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Build transfer list with per-transfer historical price info
	ftIDs := collectTransferTokenIDs(ftTransfers, false)
	ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)

	var transfers []map[string]interface{}
	var totalFTIn, totalFTOut float64

	for _, t := range ftTransfers {
		ts := t.TokenTransfer.Timestamp
		if startDate != nil && ts.Before(*startDate) {
			continue
		}
		if endDate != nil && ts.After(*endDate) {
			continue
		}

		amount := parseFloatOrZero(t.TokenTransfer.Amount)
		direction := transferDirection(address, t.TokenTransfer.FromAddress, t.TokenTransfer.ToAddress)
		if direction == "deposit" {
			totalFTIn += amount
		} else {
			totalFTOut += amount
		}

		tokenIdentifier := formatTokenVaultIdentifier(t.TokenTransfer.TokenContractAddress, t.ContractName)

		// Historical price lookup
		var usdPrice float64
		id := formatTokenVaultIdentifier(t.TokenTransfer.TokenContractAddress, t.ContractName)
		if m, ok := ftMeta[id]; ok && m.MarketSymbol != "" {
			usdPrice, _ = s.priceCache.GetPriceAt(m.MarketSymbol, ts)
		} else if t.ContractName == "FlowToken" {
			usdPrice, _ = s.priceCache.GetPriceAt("FLOW", ts)
		}

		entry := map[string]interface{}{
			"type":             "ft",
			"transaction_hash": t.TokenTransfer.TransactionID,
			"block_height":     t.TokenTransfer.BlockHeight,
			"timestamp":        formatTime(ts),
			"token":            tokenIdentifier,
			"amount":           amount,
			"direction":        direction,
			"sender":           formatAddressV1(t.TokenTransfer.FromAddress),
			"receiver":         formatAddressV1(t.TokenTransfer.ToAddress),
			"approx_usd_price": usdPrice,
			"usd_value":        amount * usdPrice,
		}
		transfers = append(transfers, entry)
	}

	for _, t := range nftTransfers {
		ts := t.TokenTransfer.Timestamp
		if startDate != nil && ts.Before(*startDate) {
			continue
		}
		if endDate != nil && ts.After(*endDate) {
			continue
		}

		direction := transferDirection(address, t.TokenTransfer.FromAddress, t.TokenTransfer.ToAddress)
		nftType := formatTokenIdentifier(t.TokenTransfer.TokenContractAddress, t.ContractName)

		entry := map[string]interface{}{
			"type":             "nft",
			"transaction_hash": t.TokenTransfer.TransactionID,
			"block_height":     t.TokenTransfer.BlockHeight,
			"timestamp":        formatTime(ts),
			"nft_type":         nftType,
			"nft_id":           t.TokenTransfer.TokenID,
			"direction":        direction,
			"sender":           formatAddressV1(t.TokenTransfer.FromAddress),
			"receiver":         formatAddressV1(t.TokenTransfer.ToAddress),
		}
		transfers = append(transfers, entry)
	}

	if transfers == nil {
		transfers = make([]map[string]interface{}, 0)
	}

	// Get latest FLOW price for summary
	latestFlowPrice := 0.0
	if p, ok := s.priceCache.GetLatestPrice("FLOW"); ok {
		latestFlowPrice = p
	}

	summary := map[string]interface{}{
		"address":         formatAddressV1(address),
		"total_transfers": len(transfers),
		"total_ft_in":     totalFTIn,
		"total_ft_out":    totalFTOut,
		"flow_price_usd":  latestFlowPrice,
		"transfers":       transfers,
	}

	writeAPIResponse(w, []interface{}{summary}, map[string]interface{}{
		"limit":        limit,
		"offset":       offset,
		"ft_has_more":  ftHasMore,
		"nft_has_more": nftHasMore,
	}, nil)
}
