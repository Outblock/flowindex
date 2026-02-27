package api

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

func (s *Server) handleAnalyticsDaily(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsDateRange(r)
	stats, err := s.repo.GetAnalyticsDailyStats(r.Context(), from, to)
	if err != nil {
		log.Printf("[analytics] enriched daily query failed, fallback to base stats: %v", err)
		stats, err = s.repo.GetAnalyticsDailyBaseStats(r.Context(), from, to)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeAPIResponse(w, stats, map[string]interface{}{"count": len(stats)}, nil)
}

func (s *Server) handleAnalyticsTransfersDaily(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsDateRange(r)
	stats, err := s.repo.GetTransferDailyStats(r.Context(), from, to)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, map[string]interface{}{"count": len(stats)}, nil)
}

func (s *Server) handleAnalyticsDailyModule(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsDateRange(r)
	module := mux.Vars(r)["module"]

	var (
		stats interface{}
		err   error
	)

	switch module {
	case "accounts":
		stats, err = s.repo.GetAnalyticsDailyAccountsModule(r.Context(), from, to)
	case "evm":
		stats, err = s.repo.GetAnalyticsDailyEVMModule(r.Context(), from, to)
	case "defi":
		stats, err = s.repo.GetAnalyticsDailyDefiModule(r.Context(), from, to)
	case "epoch":
		stats, err = s.repo.GetAnalyticsDailyEpochModule(r.Context(), from, to)
	case "bridge":
		stats, err = s.repo.GetAnalyticsDailyBridgeModule(r.Context(), from, to)
	case "contracts":
		stats, err = s.repo.GetAnalyticsDailyContractsModule(r.Context(), from, to)
	default:
		writeAPIError(w, http.StatusBadRequest, "unsupported module")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, nil, nil)
}

// parseAnalyticsDateRange extracts ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to last 90 days.
func parseAnalyticsDateRange(r *http.Request) (time.Time, time.Time) {
	now := time.Now().UTC()
	to := now
	from := now.AddDate(0, 0, -90)

	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			from = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			to = t
		}
	}
	return from, to
}

func (s *Server) handleBigTransfers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	offset := 0
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			offset = n
		}
	}
	minUSD := 10000.0
	if v := q.Get("min_usd"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			minUSD = f
		}
	}

	var transferTypes []string
	if v := q.Get("type"); v != "" {
		for _, t := range strings.Split(v, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				transferTypes = append(transferTypes, t)
			}
		}
	}

	priceMap := s.priceCache.GetAllLatestPrices()
	if len(priceMap) == 0 {
		writeAPIResponse(w, []repository.BigTransfer{}, map[string]interface{}{"count": 0}, nil)
		return
	}

	results, err := s.repo.GetBigTransfers(r.Context(), priceMap, minUSD, limit, offset, transferTypes)
	if err != nil {
		log.Printf("[big-transfers] query error: %v", err)
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, results, map[string]interface{}{"count": len(results)}, nil)
}
