package api

import (
	"net/http"
	"time"
)

func (s *Server) handleAnalyticsDaily(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsDateRange(r)
	stats, err := s.repo.GetAnalyticsDailyStats(r.Context(), from, to)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
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
