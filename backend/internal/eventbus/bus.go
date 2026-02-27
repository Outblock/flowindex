package eventbus

import (
	"sync"
	"time"
)

// Event represents a blockchain event routed through the bus.
type Event struct {
	Type      string
	Height    uint64
	Timestamp time.Time
	Data      interface{}
}

// Bus is an in-process event bus that routes events to subscribers
// based on event type. It uses Go channels for delivery and is
// safe for concurrent use.
type Bus struct {
	mu          sync.RWMutex
	subscribers map[string][]chan<- Event
	closed      bool
}

// New creates a new Bus ready for use.
func New() *Bus {
	return &Bus{
		subscribers: make(map[string][]chan<- Event),
	}
}

// Subscribe registers a channel to receive events of the given type.
// The caller is responsible for creating the channel with sufficient
// buffer capacity; slow subscribers will have events dropped.
func (b *Bus) Subscribe(eventType string, ch chan<- Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscribers[eventType] = append(b.subscribers[eventType], ch)
}

// Publish sends an event to all subscribers registered for that event type.
// If a subscriber's channel is full, the event is dropped for that subscriber.
// Publish is a no-op after Close has been called.
func (b *Bus) Publish(evt Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return
	}
	for _, ch := range b.subscribers[evt.Type] {
		select {
		case ch <- evt:
		default:
			// drop if subscriber is slow
		}
	}
}

// Close marks the bus as closed. After Close, Publish is a no-op.
// Close does not close subscriber channels; that is the caller's responsibility.
func (b *Bus) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
}
