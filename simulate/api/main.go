package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
)

func main() {
	emulatorURL := os.Getenv("EMULATOR_URL")
	if emulatorURL == "" {
		emulatorURL = "http://localhost:8888"
	}
	adminURL := os.Getenv("EMULATOR_ADMIN_URL")
	if adminURL == "" {
		adminURL = "http://localhost:8080"
	}
	grpcURL := os.Getenv("EMULATOR_GRPC_URL")
	if grpcURL == "" {
		grpcURL = derivePortURL(emulatorURL, "3569")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "9090"
	}

	allowedOrigins := os.Getenv("CORS_ORIGINS") // comma-separated, e.g. "https://simulator.flowindex.io,http://localhost:5174"

	emulatorContainer := os.Getenv("EMULATOR_CONTAINER")
	if emulatorContainer == "" {
		emulatorContainer = "simulator"
	}

	stuckTimeout := 60 // seconds
	if v := os.Getenv("STUCK_TIMEOUT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			stuckTimeout = n
		}
	}

	client := NewClientWithAdminAndGRPC(emulatorURL, adminURL, grpcURL)
	handler := NewHandler(client, emulatorContainer, stuckTimeout)

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ok, err := client.HealthCheck(r.Context())
		if !ok || err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"unhealthy","error":"` + err.Error() + `"}`))
			return
		}
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Simulate endpoint
	mux.HandleFunc("POST /api/simulate", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w, r, allowedOrigins)
		w.Header().Set("Content-Type", "application/json")
		handler.HandleSimulate(w, r)
	})

	// CORS preflight
	mux.HandleFunc("OPTIONS /api/simulate", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w, r, allowedOrigins)
		w.WriteHeader(http.StatusNoContent)
	})

	log.Printf("[simulator-api] starting on :%s (emulator=%s, admin=%s, grpc=%s)", port, emulatorURL, adminURL, grpcURL)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func setCORS(w http.ResponseWriter, r *http.Request, allowedOrigins string) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	if allowedOrigins == "" || allowedOrigins == "*" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else {
		// Check if origin is in allowed list
		for _, allowed := range splitOrigins(allowedOrigins) {
			if origin == allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				break
			}
		}
	}
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "86400")
}

func splitOrigins(s string) []string {
	var out []string
	for _, part := range split(s, ",") {
		trimmed := trim(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func split(s, sep string) []string {
	var result []string
	for {
		i := indexOf(s, sep)
		if i < 0 {
			result = append(result, s)
			break
		}
		result = append(result, s[:i])
		s = s[i+len(sep):]
	}
	return result
}

func indexOf(s, sub string) int {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func trim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}
