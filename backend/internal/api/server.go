package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

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
	statusCache struct {
		mu        sync.Mutex
		payload   []byte
		expiresAt time.Time
	}
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
	r.HandleFunc("/stats/network", s.handleGetNetworkStats).Methods("GET", "OPTIONS")
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
	now := time.Now()
	s.statusCache.mu.Lock()
	if now.Before(s.statusCache.expiresAt) && len(s.statusCache.payload) > 0 {
		cached := append([]byte(nil), s.statusCache.payload...)
		s.statusCache.mu.Unlock()
		w.Write(cached)
		return
	}
	s.statusCache.mu.Unlock()

	// Get indexed height from DB (Forward Tip)
	lastIndexed, err := s.repo.GetLastIndexedHeight(r.Context(), "main_ingester")
	if err != nil {
		lastIndexed = 0
	}

	// Get history height from DB (Backward Tip)
	historyIndexed, err := s.repo.GetLastIndexedHeight(r.Context(), "history_ingester")
	if err != nil {
		historyIndexed = 0
	}
	// If historyIngester never ran, it returns 0. If it ran, it returns the lowest block processed.

	// Get Real Block Range (Min/Max/Count in DB)
	minH, maxH, totalBlocks, err := s.repo.GetBlockRange(r.Context())
	if err != nil {
		minH = 0
		maxH = 0
		totalBlocks = 0
	}

	// Get latest block height from Flow (bounded latency)
	latestHeight := maxH
	{
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if h, err := s.client.GetLatestBlockHeight(ctx); err == nil {
			latestHeight = h
		} else if lastIndexed > latestHeight {
			latestHeight = lastIndexed
		}
	}

	// Calculate Progress relative to StartBlock
	progress := 0.0
	start := s.startBlock

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

	resp := map[string]interface{}{
		"chain_id":           "flow",
		"latest_height":      latestHeight,
		"indexed_height":     lastIndexed,    // Main Ingester Tip
		"history_height":     historyIndexed, // History Ingester Tip (Lowest)
		"min_height":         minH,           // Absolute Min in DB
		"max_height":         maxH,           // Absolute Max in DB
		"total_blocks":       totalBlocks,    // Count (estimate)
		"start_height":       start,
		"total_transactions": totalTxs,
		"progress":           fmt.Sprintf("%.2f%%", progress),
		"behind":             latestHeight - lastIndexed,
		"status":             "ok",
	}

	payload, err := json.Marshal(resp)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.statusCache.mu.Lock()
	s.statusCache.payload = payload
	s.statusCache.expiresAt = time.Now().Add(3 * time.Second)
	s.statusCache.mu.Unlock()

	w.Write(payload)
}

func (s *Server) handleListBlocks(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)
	cursorParam := r.URL.Query().Get("cursor")

	if cursorParam != "" {
		cursorHeight, err := parseCursorHeight(cursorParam)
		if err != nil {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}

		blocks, err := s.repo.GetBlocksByCursor(r.Context(), limit, cursorHeight)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		nextCursor := ""
		if len(blocks) == limit {
			nextCursor = fmt.Sprintf("%d", blocks[len(blocks)-1].Height)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"items":       blocks,
			"next_cursor": nextCursor,
		})
		return
	}

	blocks, err := s.repo.GetRecentBlocks(r.Context(), limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(blocks)
}

func (s *Server) handleListTransactions(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)
	cursorParam := r.URL.Query().Get("cursor")

	if cursorParam != "" {
		cursor, err := parseTxCursor(cursorParam)
		if err != nil {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}

		txs, err := s.repo.GetTransactionsByCursor(r.Context(), limit, cursor)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		nextCursor := ""
		if len(txs) == limit {
			last := txs[len(txs)-1]
			nextCursor = fmt.Sprintf("%d:%d:%s", last.BlockHeight, last.TransactionIndex, last.ID)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"items":       txs,
			"next_cursor": nextCursor,
		})
		return
	}

	txs, err := s.repo.GetRecentTransactions(r.Context(), limit, offset)
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

		// Process arguments from RPC (similar to worker)
		// rpcTx.Arguments is [][]byte, each is JSON-CDC.
		// We want to return them as a JSON array of raw JSON objects (not base64 strings).
		// Since we are returning a map[string]interface{}, let's try to unmarshal them into interface{} first
		// so when we encode the map, they are encoded as JSON objects/arrays, not strings.
		var argsList []interface{}
		for _, argBytes := range rpcTx.Arguments {
			var argJSON interface{}
			if err := json.Unmarshal(argBytes, &argJSON); err == nil {
				argsList = append(argsList, argJSON)
			} else {
				// If unmarshal fails, just append as string or raw
				argsList = append(argsList, string(argBytes))
			}
		}
		fallbackTx["arguments"] = argsList

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

func parsePagination(r *http.Request) (int, int) {
	limitStr := r.URL.Query().Get("limit")
	pageStr := r.URL.Query().Get("page")
	offsetStr := r.URL.Query().Get("offset")

	limit := 10 // Default limit
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	} else if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			offset = (p - 1) * limit
		}
	}

	return limit, offset
}

func parseCursorHeight(cursor string) (*uint64, error) {
	if cursor == "" {
		return nil, nil
	}
	h, err := strconv.ParseUint(cursor, 10, 64)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func parseTxCursor(cursor string) (*repository.TxCursor, error) {
	if cursor == "" {
		return nil, nil
	}
	parts := strings.SplitN(cursor, ":", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid cursor")
	}
	bh, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return nil, err
	}
	txIndex, err := strconv.Atoi(parts[1])
	if err != nil {
		return nil, err
	}
	id := parts[2]
	if id == "" {
		return nil, fmt.Errorf("invalid cursor id")
	}
	return &repository.TxCursor{BlockHeight: bh, TxIndex: txIndex, ID: id}, nil
}

func parseAddressTxCursor(cursor string) (*repository.AddressTxCursor, error) {
	if cursor == "" {
		return nil, nil
	}
	parts := strings.SplitN(cursor, ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid cursor")
	}
	bh, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return nil, err
	}
	id := parts[1]
	if id == "" {
		return nil, fmt.Errorf("invalid cursor id")
	}
	return &repository.AddressTxCursor{BlockHeight: bh, TxID: id}, nil
}

func parseTokenTransferCursor(cursor string) (*repository.TokenTransferCursor, error) {
	if cursor == "" {
		return nil, nil
	}
	parts := strings.SplitN(cursor, ":", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid cursor")
	}
	bh, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return nil, err
	}
	txID := parts[1]
	if txID == "" {
		return nil, fmt.Errorf("invalid cursor tx id")
	}
	eventIndex, err := strconv.Atoi(parts[2])
	if err != nil {
		return nil, err
	}
	return &repository.TokenTransferCursor{BlockHeight: bh, TxID: txID, EventIndex: eventIndex}, nil
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

	// Create a simplified response wrapper
	// Balance is uint64 in atomic units (1e-8 Flow). Convert to float for JSON.
	balanceVal := float64(acc.Balance) / 100000000.0

	// RPC Fallback for Keys: If DB has no keys but RPC account does (which it always does if fetched), use them.
	// The previous implementation relied on the `acc` from client.GetAccount, which ALREADY contains keys from RPC.
	// However, if we want to prioritize DB keys we would need to check DB first.
	// But here the code calls s.client.GetAccount(r.Context(), address) at the top of the handler.
	// So `acc` IS from RPC.
	// The issue might be that the previous code was just encoding `acc.Keys`.
	// Let's ensure we are encoding them correctly.

	// Reformatted keys for easier reading
	var formattedKeys []map[string]interface{}
	for _, key := range acc.Keys {
		formattedKeys = append(formattedKeys, map[string]interface{}{
			"index":           key.Index,
			"public_key":      key.PublicKey.String(),
			"sign_algo":       key.SigAlgo.String(),
			"hash_algo":       key.HashAlgo.String(),
			"weight":          key.Weight,
			"sequence_number": key.SequenceNumber,
			"revoked":         key.Revoked,
		})
	}

	resp := map[string]interface{}{
		"address":   acc.Address.Hex(),
		"balance":   balanceVal,
		"keys":      formattedKeys, // Use formatted keys
		"contracts": acc.Contracts, // Contracts map is usually fine
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleGetAccountTransactions(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	// Sanitize address (remove 0x, lowercase) matching DB format
	address := flowsdk.HexToAddress(vars["address"]).String()

	limit, offset := parsePagination(r)
	cursorParam := r.URL.Query().Get("cursor")

	if cursorParam != "" {
		cursor, err := parseAddressTxCursor(cursorParam)
		if err != nil {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}

		txs, err := s.repo.GetTransactionsByAddressCursor(r.Context(), address, limit, cursor)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		nextCursor := ""
		if len(txs) == limit {
			last := txs[len(txs)-1]
			nextCursor = fmt.Sprintf("%d:%s", last.BlockHeight, last.ID)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"items":       txs,
			"next_cursor": nextCursor,
		})
		return
	}

	txs, err := s.repo.GetTransactionsByAddress(r.Context(), address, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(txs)
}

func (s *Server) handleGetAccountTokenTransfers(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := flowsdk.HexToAddress(vars["address"]).String()

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	cursorParam := r.URL.Query().Get("cursor")
	_, hasCursor := r.URL.Query()["cursor"]

	if hasCursor {
		cursor, err := parseTokenTransferCursor(cursorParam)
		if err != nil {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}

		transfers, err := s.repo.GetTokenTransfersByAddressCursor(r.Context(), address, limit, cursor)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		nextCursor := ""
		if len(transfers) == limit {
			last := transfers[len(transfers)-1]
			nextCursor = fmt.Sprintf("%d:%s:%d", last.BlockHeight, last.TransactionID, last.EventIndex)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"items":       transfers,
			"next_cursor": nextCursor,
		})
		return
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
	address := flowsdk.HexToAddress(vars["address"]).String()

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	cursorParam := r.URL.Query().Get("cursor")
	_, hasCursor := r.URL.Query()["cursor"]

	if hasCursor {
		cursor, err := parseTokenTransferCursor(cursorParam)
		if err != nil {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}

		transfers, err := s.repo.GetNFTTransfersByAddressCursor(r.Context(), address, limit, cursor)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		nextCursor := ""
		if len(transfers) == limit {
			last := transfers[len(transfers)-1]
			nextCursor = fmt.Sprintf("%d:%s:%d", last.BlockHeight, last.TransactionID, last.EventIndex)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"items":       transfers,
			"next_cursor": nextCursor,
		})
		return
	}

	transfers, err := s.repo.GetNFTTransfersByAddress(r.Context(), address)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transfers)
}

func (s *Server) handleGetAddressStats(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := flowsdk.HexToAddress(vars["address"]).String()

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
	address := flowsdk.HexToAddress(vars["address"]).String()

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

// NetworkStats represents the aggregated network statistics
type NetworkStats struct {
	Price          float64 `json:"price"`
	PriceChange24h float64 `json:"price_change_24h"`
	MarketCap      float64 `json:"market_cap"`
	Epoch          int     `json:"epoch"`
	EpochProgress  float64 `json:"epoch_progress"` // 0-100
	TotalStaked    float64 `json:"total_staked"`
	ActiveNodes    int     `json:"active_nodes"`
	UpdatedAt      int64   `json:"updated_at"`
}

var (
	cachedStats     NetworkStats
	lastStatsUpdate int64
	statsMutex      sync.Mutex
)

func (s *Server) handleGetNetworkStats(w http.ResponseWriter, r *http.Request) {
	statsMutex.Lock()
	defer statsMutex.Unlock()

	// Cache for 5 minutes
	if time.Now().Unix()-lastStatsUpdate > 300 {
		// Update Price (CoinGecko)
		price, change, mcap := fetchFlowPrice()
		cachedStats.Price = price
		cachedStats.PriceChange24h = change
		cachedStats.MarketCap = mcap

		// Mock/Calculation for Epoch (Real implementation would query chain)
		// Assuming ~1 week epochs, arbitrary start
		cachedStats.Epoch = 124
		cachedStats.EpochProgress = 65.4
		cachedStats.TotalStaked = 850000000.00
		cachedStats.ActiveNodes = 455
		cachedStats.UpdatedAt = time.Now().Unix()

		lastStatsUpdate = time.Now().Unix()
	}

	json.NewEncoder(w).Encode(cachedStats)
}

func fetchFlowPrice() (float64, float64, float64) {
	resp, err := http.Get("https://api.coingecko.com/api/v3/simple/price?ids=flow&vs_currencies=usd&include_24hr_change=true&include_market_cap=true")
	if err != nil {
		log.Printf("Error fetching flow price: %v", err)
		return 0, 0, 0
	}
	defer resp.Body.Close()

	var result map[string]struct {
		USD          float64 `json:"usd"`
		USDChange24h float64 `json:"usd_24h_change"`
		USDMarketCap float64 `json:"usd_market_cap"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("Error decoding price response: %v", err)
		return 0, 0, 0
	}

	if data, ok := result["flow"]; ok {
		return data.USD, data.USDChange24h, data.USDMarketCap
	}
	return 0, 0, 0
}
