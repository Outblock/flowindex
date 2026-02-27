package market

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type DailyPrice struct {
	Date  time.Time
	Price float64
}

type PriceCache struct {
	mu     sync.RWMutex
	prices map[string][]DailyPrice // key: uppercase asset symbol
}

func NewPriceCache() *PriceCache {
	return &PriceCache{prices: make(map[string][]DailyPrice)}
}

func (c *PriceCache) Load(asset string, prices []DailyPrice) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.prices[strings.ToUpper(asset)] = prices
}

func (c *PriceCache) Append(asset string, prices []DailyPrice) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := strings.ToUpper(asset)
	existing := c.prices[key]
	seen := make(map[string]bool, len(existing))
	for _, p := range existing {
		seen[p.Date.Format("2006-01-02")] = true
	}
	for _, p := range prices {
		k := p.Date.Format("2006-01-02")
		if !seen[k] {
			existing = append(existing, p)
			seen[k] = true
		}
	}
	sort.Slice(existing, func(i, j int) bool { return existing[i].Date.Before(existing[j].Date) })
	c.prices[key] = existing
}

// GetPriceAt returns the daily price closest to ts. Returns (0, false) if no price within 48h.
func (c *PriceCache) GetPriceAt(asset string, ts time.Time) (float64, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ps := c.prices[strings.ToUpper(asset)]
	if len(ps) == 0 {
		return 0, false
	}

	target := ts.UTC().Truncate(24 * time.Hour)
	idx := sort.Search(len(ps), func(i int) bool {
		return !ps[i].Date.Before(target)
	})

	best := -1
	bestDelta := time.Duration(1<<63 - 1)
	for _, i := range []int{idx - 1, idx} {
		if i < 0 || i >= len(ps) {
			continue
		}
		delta := ps[i].Date.Sub(target)
		if delta < 0 {
			delta = -delta
		}
		if delta < bestDelta {
			bestDelta = delta
			best = i
		}
	}
	if best < 0 || bestDelta > 48*time.Hour {
		return 0, false
	}
	return ps[best].Price, true
}

func (c *PriceCache) GetLatestPrice(asset string) (float64, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ps := c.prices[strings.ToUpper(asset)]
	if len(ps) == 0 {
		return 0, false
	}
	return ps[len(ps)-1].Price, true
}
