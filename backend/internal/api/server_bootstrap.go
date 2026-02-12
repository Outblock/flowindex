package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

type Server struct {
	repo        *repository.Repository
	client      FlowClient
	httpServer  *http.Server
	startBlock  uint64
	statusCache struct {
		mu        sync.Mutex
		payload   []byte
		expiresAt time.Time
	}
	latestHeightCache struct {
		mu        sync.Mutex
		height    uint64
		updatedAt time.Time
	}
}

func NewServer(repo *repository.Repository, client FlowClient, port string, startBlock uint64) *Server {
	r := mux.NewRouter()

	s := &Server{
		repo:       repo,
		client:     client,
		startBlock: startBlock,
	}

	r.Use(commonMiddleware)
	r.Use(rateLimitMiddleware)

	registerBaseRoutes(r, s)
	registerAdminRoutes(r, s)
	registerLegacyRoutes(r, s)
	registerV1Routes(r, s)

	v1 := r.PathPrefix("/api/v1").Subrouter()
	registerV1Routes(v1, s)

	v2 := r.PathPrefix("/api/v2").Subrouter()
	registerV2Routes(v2, s)

	s.httpServer = &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	return s
}

func (s *Server) Start() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func commonMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
