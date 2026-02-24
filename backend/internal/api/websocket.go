package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"flowscan-clone/internal/models"

	"github.com/gorilla/websocket"
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

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
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

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (s *Server) handleStatusWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Status WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		payload, err := s.buildStatusPayload(r.Context(), false)
		if err != nil {
			payload = []byte(`{"status":"error"}`)
		}
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			return
		}
		<-ticker.C
	}
}

type BroadcastMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type WSBlock struct {
	Height     uint64    `json:"height"`
	ID         string    `json:"id"`
	Timestamp  time.Time `json:"timestamp"`
	TxCount    int       `json:"tx_count"`
	EventCount int       `json:"event_count"`
}

type WSTransaction struct {
	ID              string    `json:"id"`
	BlockHeight     uint64    `json:"block_height"`
	Status          string    `json:"status"`
	PayerAddress    string    `json:"payer_address,omitempty"`
	ProposerAddress string    `json:"proposer_address,omitempty"`
	Timestamp       time.Time `json:"timestamp"`
	ExecutionStatus string    `json:"execution_status,omitempty"`
	ErrorMessage    string    `json:"error_message,omitempty"`
}

func BroadcastNewBlock(block models.Block) {
	ts := block.Timestamp
	if ts.IsZero() {
		ts = block.CreatedAt
	}
	payload := WSBlock{
		Height:     block.Height,
		ID:         block.ID,
		Timestamp:  ts,
		TxCount:    block.TxCount,
		EventCount: block.EventCount,
	}
	msg := BroadcastMessage{Type: "new_block", Payload: payload}
	data, _ := json.Marshal(msg)
	hub.broadcast <- data
}

func BroadcastNewTransaction(tx models.Transaction) {
	ts := tx.Timestamp
	if ts.IsZero() {
		ts = tx.CreatedAt
	}
	payload := WSTransaction{
		ID:              tx.ID,
		BlockHeight:     tx.BlockHeight,
		Status:          tx.Status,
		PayerAddress:    tx.PayerAddress,
		ProposerAddress: tx.ProposerAddress,
		Timestamp:       ts,
		ExecutionStatus: tx.ExecutionStatus,
		ErrorMessage:    tx.ErrorMessage,
	}
	msg := BroadcastMessage{Type: "new_transaction", Payload: payload}
	data, _ := json.Marshal(msg)
	hub.broadcast <- data
}

func init() {
	go hub.run()
}
