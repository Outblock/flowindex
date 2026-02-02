package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	flowsdk "github.com/onflow/flow-go-sdk"
)

// --- WebSocket Hub ---

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mutex      sync.Mutex
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

var hub = &Hub{
	broadcast:  make(chan []byte),
	register:   make(chan *Client),
	unregister: make(chan *Client),
	clients:    make(map[*Client]bool),
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mutex.Lock()
			h.clients[client] = true
			h.mutex.Unlock()
		case client := <-h.unregister:
			h.mutex.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mutex.Unlock()
		case message := <-h.broadcast:
			h.mutex.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mutex.Unlock()
		}
	}
}

// --- WebSocket Server ---

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	client := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
	}

	hub.register <- client

	// Write pump
	go func() {
		defer func() {
			hub.unregister <- client
			conn.Close()
		}()
		for {
			message, ok := <-client.send
			if !ok {
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			w.Close()
		}
	}()

	// Read pump (keep connection alive)
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

// --- Broadcast Helpers ---

type BroadcastMessage struct {
	Type    string      `json:"type"` // "new_block", "new_transaction"
	Payload interface{} `json:"payload"`
}

func BroadcastNewBlock(block models.Block) {
	msg := BroadcastMessage{
		Type:    "new_block",
		Payload: block,
	}
	data, _ := json.Marshal(msg)
	hub.broadcast <- data
}

func BroadcastNewTransaction(tx models.Transaction) {
	msg := BroadcastMessage{
		Type:    "new_transaction",
		Payload: tx,
	}
	data, _ := json.Marshal(msg)
	hub.broadcast <- data
}

// --- Init ---

func init() {
	go hub.run()
}

// --- Server & Routes ---

// --- Server & Routes ---

type Server struct {
	repo       *repository.Repository
	client     *flow.Client
	httpServer *http.Server
	startBlock uint64
}

func NewServer(repo *repository.Repository, client *flow.Client, port string, startBlock uint64) *Server {
	r := mux.NewRouter()

	s := &Server{
		repo:       repo,
		client:     client,
		startBlock: startBlock,
	}

	// Middleware
	r.Use(commonMiddleware)

	// Routes
	r.HandleFunc("/health", s.handleHealth).Methods("GET", "OPTIONS")
	r.HandleFunc("/status", s.handleStatus).Methods("GET", "OPTIONS")
	r.HandleFunc("/ws", s.handleWebSocket).Methods("GET", "OPTIONS") // WebSocket Endpoint
	r.HandleFunc("/blocks", s.handleListBlocks).Methods("GET", "OPTIONS")
	r.HandleFunc("/blocks/{id}", s.handleGetBlock).Methods("GET", "OPTIONS")
	r.HandleFunc("/transactions", s.handleListTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/transactions/{id}", s.handleGetTransaction).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounts/{address}", s.handleGetAccount).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounts/{address}/transactions", s.handleGetAccountTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounts/{address}/token-transfers", s.handleGetAccountTokenTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounts/{address}/nft-transfers", s.handleGetAccountNFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounts/{address}/stats", s.handleGetAddressStats).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounts/{address}/contract", s.handleGetContractByAddress).Methods("GET", "OPTIONS")
	r.HandleFunc("/stats/daily", s.handleGetDailyStats).Methods("GET", "OPTIONS")
	r.HandleFunc("/keys/{publicKey}", s.handleGetAddressByPublicKey).Methods("GET", "OPTIONS")

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

// Handlers

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	// Get latest block height from Flow
	latestHeight, err := s.client.GetLatestBlockHeight(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get indexed height from DB
	lastIndexed, err := s.repo.GetLastIndexedHeight(r.Context(), "main_ingester")
	if err != nil {
		lastIndexed = 0
	}

	// Calculate Progress relative to StartBlock
	progress := 0.0
	start := s.startBlock

	// Safety: If somehow indexed is less than start (e.g. old data), treat start as indexed?
	// Or just calc as is.

	totalRange := float64(latestHeight - start)
	indexedRange := float64(lastIndexed - start)

	if lastIndexed < start {
		indexedRange = 0
	}

	if totalRange > 0 {
		progress = (indexedRange / totalRange) * 100
	}

	// Cap at 100%
	if progress > 100 {
		progress = 100
	}
	if progress < 0 {
		progress = 0
	}

	// Get total transactions
	totalTxs, err := s.repo.GetTotalTransactions(r.Context())
	if err != nil {
		totalTxs = 0
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"chain_id":           "flow",
		"latest_height":      latestHeight,
		"indexed_height":     lastIndexed,
		"start_height":       start,
		"total_transactions": totalTxs,
		"progress":           fmt.Sprintf("%.2f%%", progress),
		"behind":             latestHeight - lastIndexed,
		"status":             "ok",
	})
}

func (s *Server) handleListBlocks(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	blocks, err := s.repo.GetRecentBlocks(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(blocks)
}

func (s *Server) handleListTransactions(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	txs, err := s.repo.GetRecentTransactions(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(txs)
}

func (s *Server) handleGetBlock(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	idOrHeight := vars["id"]

	var block *models.Block
	var err error

	// Try parsing as height (number) first
	if height, parseErr := strconv.ParseUint(idOrHeight, 10, 64); parseErr == nil {
		block, err = s.repo.GetBlockByHeight(r.Context(), height)
	} else {
		// Otherwise treat as block ID (hash)
		block, err = s.repo.GetBlockByID(r.Context(), idOrHeight)
	}

	if err != nil {
		http.Error(w, "Block not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(block)
}

func (s *Server) handleGetTransaction(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Try database first
	tx, err := s.repo.GetTransactionByID(r.Context(), id)
	if err != nil {
		// Fallback to RPC for unindexed transactions
		log.Printf("[API] Transaction %s not in DB, falling back to RPC", id)

		rpcTx, rpcErr := s.client.GetTransaction(r.Context(), flowsdk.HexToID(id))
		if rpcErr != nil {
			http.Error(w, "Transaction not found in database or on-chain", http.StatusNotFound)
			return
		}

		rpcResult, resultErr := s.client.GetTransactionResult(r.Context(), flowsdk.HexToID(id))
		if resultErr != nil {
			log.Printf("[API] Could not fetch transaction result from RPC: %v", resultErr)
		}

		// Convert RPC transaction to our model format (matching internal/models/models.go Transaction struct)
		fallbackTx := map[string]interface{}{
			"id":                       id,
			"type":                     "PENDING",                       // Default for RPC/Mempool
			"status":                   "PENDING",                       // Default
			"block_height":             rpcTx.ReferenceBlockID.String(), // Placeholder, or use rpcResult.BlockHeight if avail
			"time":                     "",                              // Not available in RPC usually
			"payer_address":            rpcTx.Payer.String(),
			"proposer_address":         rpcTx.ProposalKey.Address.String(),
			"proposer_key_index":       rpcTx.ProposalKey.KeyIndex,
			"proposer_sequence_number": rpcTx.ProposalKey.SequenceNumber,
			"gas_limit":                rpcTx.GasLimit,
			"gas_used":                 0, // Not available until sealed/result
			"computation_usage":        0,
			"script":                   string(rpcTx.Script),
			"authorizers":              convertAddresses(rpcTx.Authorizers),
			"event_count":              0,
			"error_message":            "",
			"is_indexed":               false,
		}

		// Add result data if available
		if rpcResult != nil {
			fallbackTx["status"] = rpcResult.Status.String()
			fallbackTx["block_height"] = rpcResult.BlockHeight
			fallbackTx["events"] = convertEvents(rpcResult.Events)
			fallbackTx["event_count"] = len(rpcResult.Events)

			// Only add error message if error is not nil
			if rpcResult.Error != nil {
				fallbackTx["error_message"] = rpcResult.Error.Error()
			}
		}

		json.NewEncoder(w).Encode(fallbackTx)
		return
	}

	// Transaction found in database
	json.NewEncoder(w).Encode(tx)
}

// Helper to convert Flow addresses to strings
func convertAddresses(addrs []flowsdk.Address) []string {
	result := make([]string, len(addrs))
	for i, addr := range addrs {
		result[i] = addr.String()
	}
	return result
}

// Helper to convert Flow events to JSON-friendly format
func convertEvents(events []flowsdk.Event) []map[string]interface{} {
	result := make([]map[string]interface{}, len(events))
	for i, event := range events {
		result[i] = map[string]interface{}{
			"type":              event.Type,
			"transaction_index": event.TransactionIndex,
			"event_index":       event.EventIndex,
			"payload":           event.Payload,
		}
	}
	return result
}

func (s *Server) handleGetAccount(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	addrStr := vars["address"]

	address := flowsdk.HexToAddress(addrStr)

	acc, err := s.client.GetAccount(r.Context(), address)
	if err != nil {
		http.Error(w, "Account not found or fetch failed", http.StatusNotFound)
		return
	}

	// Transform for JSON if needed, or return raw
	// flow.Account has fields like Balance (uint64), Keys, Contracts
	// We might want to format Balance (which is uint64 in Cadence units usually, but SDK returns uint64? No, SDK returns flow.Account which has Balance uint64)
	// Actually flow.Account Balance is specific. Let's return raw for now.

	// Create a simplified response wrapper
	resp := map[string]interface{}{
		"address":   acc.Address.Hex(),
		"balance":   acc.Balance, // Note: This is uint64, 10^8
		"keys":      acc.Keys,
		"contracts": acc.Contracts,
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleGetAccountTransactions(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	txs, err := s.repo.GetTransactionsByAddress(r.Context(), address, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(txs)
}

func (s *Server) handleGetAccountTokenTransfers(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	transfers, err := s.repo.GetTokenTransfersByAddress(r.Context(), address, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transfers)
}

func (s *Server) handleGetAccountNFTTransfers(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	transfers, err := s.repo.GetNFTTransfersByAddress(r.Context(), address)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transfers)
}

func (s *Server) handleGetAddressStats(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	stats, err := s.repo.GetAddressStats(r.Context(), address)
	if err != nil {
		// If not found, it might just be a new address
		http.Error(w, "Stats not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(stats)
}

func (s *Server) handleGetContractByAddress(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	contract, err := s.repo.GetContractByAddress(r.Context(), address)
	if err != nil {
		http.Error(w, "Contract not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(contract)
}
func (s *Server) handleGetAddressByPublicKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	publicKey := vars["publicKey"]

	address, err := s.repo.GetAddressByPublicKey(r.Context(), publicKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if address == "" {
		http.Error(w, "Public key not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"address": address,
	})
}

func (s *Server) handleGetDailyStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetDailyStats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(stats)
}
