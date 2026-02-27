package eventbus

import (
	"sync"
	"testing"
	"time"
)

func TestBus_SubscribeAndPublish(t *testing.T) {
	bus := New()
	defer bus.Close()

	received := make(chan Event, 10)
	bus.Subscribe("ft.transfer", received)

	bus.Publish(Event{
		Type:      "ft.transfer",
		Height:    100,
		Timestamp: time.Now(),
		Data:      map[string]string{"from": "0xABC"},
	})

	select {
	case evt := <-received:
		if evt.Type != "ft.transfer" {
			t.Errorf("expected ft.transfer, got %s", evt.Type)
		}
		if evt.Height != 100 {
			t.Errorf("expected height 100, got %d", evt.Height)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestBus_MultipleSubscribers(t *testing.T) {
	bus := New()
	defer bus.Close()

	ch1 := make(chan Event, 10)
	ch2 := make(chan Event, 10)
	bus.Subscribe("ft.transfer", ch1)
	bus.Subscribe("ft.transfer", ch2)

	bus.Publish(Event{Type: "ft.transfer", Height: 1})

	for _, ch := range []chan Event{ch1, ch2} {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatal("subscriber did not receive event")
		}
	}
}

func TestBus_TypeFiltering(t *testing.T) {
	bus := New()
	defer bus.Close()

	ftCh := make(chan Event, 10)
	nftCh := make(chan Event, 10)
	bus.Subscribe("ft.transfer", ftCh)
	bus.Subscribe("nft.transfer", nftCh)

	bus.Publish(Event{Type: "ft.transfer", Height: 1})

	select {
	case <-ftCh:
	case <-time.After(time.Second):
		t.Fatal("ft subscriber did not receive event")
	}

	select {
	case <-nftCh:
		t.Fatal("nft subscriber should NOT receive ft.transfer event")
	case <-time.After(50 * time.Millisecond):
		// good
	}
}

func TestBus_PublishBatch(t *testing.T) {
	bus := New()
	defer bus.Close()

	received := make(chan Event, 100)
	bus.Subscribe("ft.transfer", received)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(h uint64) {
			defer wg.Done()
			bus.Publish(Event{Type: "ft.transfer", Height: h})
		}(uint64(i))
	}
	wg.Wait()

	time.Sleep(100 * time.Millisecond)
	if len(received) != 50 {
		t.Errorf("expected 50 events, got %d", len(received))
	}
}
