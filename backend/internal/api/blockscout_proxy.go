package api

import (
	"io"
	"log"
	"net/http"
	"time"
)

var blockscoutClient = &http.Client{Timeout: 15 * time.Second}

// proxyBlockscout forwards a request to the Blockscout API and streams the
// response back to the caller. The upstream path should start with "/".
// Query parameters from the original request are forwarded as-is.
func (s *Server) proxyBlockscout(w http.ResponseWriter, r *http.Request, upstreamPath string) {
	target := s.blockscoutURL + upstreamPath
	if q := r.URL.RawQuery; q != "" {
		target += "?" + q
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to build upstream request")
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := blockscoutClient.Do(req)
	if err != nil {
		log.Printf("blockscout proxy error: %v", err)
		writeAPIError(w, http.StatusBadGateway, "upstream blockscout unavailable")
		return
	}
	defer resp.Body.Close()

	// Forward content-type and status from Blockscout.
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
