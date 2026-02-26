package api

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
)

// BuildCommit is set by main to the git commit hash baked in at build time.
var BuildCommit = "dev"

// BackfillProgress tracks the state of the analytics backward backfill job.
// Updated by main.go, read by the /status API endpoint.
type BackfillProgress struct {
	mu            sync.Mutex
	Enabled       bool      `json:"enabled"`
	TipHeight     uint64    `json:"tip_height"`
	TargetHeight  uint64    `json:"target_height"`
	CurrentHeight uint64    `json:"current_height"`
	Processed     uint64    `json:"processed"`
	Speed         float64   `json:"speed"`         // blocks/sec
	StartedAt     time.Time `json:"started_at"`
	Done          bool      `json:"done"`
}

func NewBackfillProgress() *BackfillProgress {
	return &BackfillProgress{}
}

func (bp *BackfillProgress) Init(tipHeight, targetHeight uint64) {
	bp.mu.Lock()
	defer bp.mu.Unlock()
	bp.Enabled = true
	bp.TipHeight = tipHeight
	bp.TargetHeight = targetHeight
	bp.CurrentHeight = tipHeight
	bp.StartedAt = time.Now()
}

func (bp *BackfillProgress) Update(currentHeight, processed uint64, speed float64) {
	bp.mu.Lock()
	defer bp.mu.Unlock()
	bp.CurrentHeight = currentHeight
	bp.Processed = processed
	bp.Speed = speed
}

func (bp *BackfillProgress) MarkDone() {
	bp.mu.Lock()
	defer bp.mu.Unlock()
	bp.Done = true
}

func (bp *BackfillProgress) Snapshot() map[string]interface{} {
	bp.mu.Lock()
	defer bp.mu.Unlock()
	if !bp.Enabled {
		return nil
	}
	totalRange := float64(0)
	if bp.TipHeight > bp.TargetHeight {
		totalRange = float64(bp.TipHeight - bp.TargetHeight)
	}
	progress := float64(0)
	if totalRange > 0 {
		progress = float64(bp.Processed) / totalRange * 100
	}
	remaining := uint64(0)
	if bp.CurrentHeight > bp.TargetHeight {
		remaining = bp.CurrentHeight - bp.TargetHeight
	}
	eta := float64(0)
	if bp.Speed > 0 {
		eta = float64(remaining) / bp.Speed
	}
	return map[string]interface{}{
		"enabled":        true,
		"tip_height":     bp.TipHeight,
		"target_height":  bp.TargetHeight,
		"current_height": bp.CurrentHeight,
		"processed":      bp.Processed,
		"total":          uint64(totalRange),
		"progress":       progress,
		"speed":          bp.Speed,
		"remaining":      remaining,
		"eta_seconds":    eta,
		"done":           bp.Done,
		"started_at":     bp.StartedAt.UTC().Format(time.RFC3339),
	}
}

type Server struct {
	repo             *repository.Repository
	client           FlowClient
	httpServer       *http.Server
	startBlock       uint64
	blockscoutURL    string // e.g. "https://evm.flowindex.dev"
	backfillProgress *BackfillProgress
	statusCache      struct {
		mu        sync.Mutex
		payload   []byte
		expiresAt time.Time
	}
	statusRangesCache struct {
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

func NewServer(repo *repository.Repository, client FlowClient, port string, startBlock uint64, opts ...func(*Server)) *Server {
	r := mux.NewRouter()

	bsURL := strings.TrimRight(os.Getenv("BLOCKSCOUT_URL"), "/")
	if bsURL == "" {
		bsURL = "https://evm.flowindex.dev"
	}

	s := &Server{
		repo:          repo,
		client:        client,
		startBlock:    startBlock,
		blockscoutURL: bsURL,
	}
	for _, opt := range opts {
		opt(s)
	}
	if s.backfillProgress == nil {
		s.backfillProgress = NewBackfillProgress()
	}

	r.Use(commonMiddleware)
	r.Use(rateLimitMiddleware)

	registerBaseRoutes(r, s)
	registerAdminRoutes(r, s)
	registerAPIRoutes(r, s)

	s.httpServer = &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	return s
}

func (s *Server) SetBackfillProgress(bp *BackfillProgress) {
	s.backfillProgress = bp
}

func (s *Server) Start() error {
	// Pre-warm the indexed_ranges cache in the background so the first
	// request doesn't have to wait for the expensive bucket query.
	go s.refreshRangesCacheLoop()
	return s.httpServer.ListenAndServe()
}

func (s *Server) refreshRangesCacheLoop() {
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		payload, err := s.buildStatusPayload(ctx, true)
		cancel()
		if err == nil && len(payload) > 0 {
			s.statusRangesCache.mu.Lock()
			s.statusRangesCache.payload = payload
			s.statusRangesCache.expiresAt = time.Now().Add(5 * time.Minute)
			s.statusRangesCache.mu.Unlock()
		}
		time.Sleep(5 * time.Minute)
	}
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
