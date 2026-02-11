package ingester

import (
	"context"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// DefiWorker processes DEX swap events from raw.events and writes
// to app.defi_events and app.defi_pairs.
type DefiWorker struct {
	repo *repository.Repository
}

func NewDefiWorker(repo *repository.Repository) *DefiWorker {
	return &DefiWorker{repo: repo}
}

func (w *DefiWorker) Name() string {
	return "defi_worker"
}

// Known DEX contract patterns on Flow mainnet.
var knownDEXPatterns = []struct {
	// Substring that must appear in the event type
	Pattern   string
	DexKey    string
	EventName string // short event name we map to
}{
	// IncrementFi SwapPair
	{Pattern: ".SwapPair.Swap", DexKey: "incrementfi", EventName: "Swap"},
	{Pattern: ".SwapPair.AddLiquidity", DexKey: "incrementfi", EventName: "AddLiquidity"},
	{Pattern: ".SwapPair.RemoveLiquidity", DexKey: "incrementfi", EventName: "RemoveLiquidity"},
	// BloctoSwap
	{Pattern: ".BloctoSwapPair.Swap", DexKey: "bloctoswap", EventName: "Swap"},
	// Metapier
	{Pattern: ".MetaPierSwapPair.Swap", DexKey: "metapier", EventName: "Swap"},
}

func (w *DefiWorker) matchDEX(eventType string) (dexKey, eventName string, ok bool) {
	for _, p := range knownDEXPatterns {
		if strings.Contains(eventType, p.Pattern) {
			return p.DexKey, p.EventName, true
		}
	}
	return "", "", false
}

func (w *DefiWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("failed to fetch raw events: %w", err)
	}

	var defiEvents []models.DefiEvent
	pairsMap := make(map[string]*models.DefiPair)

	var minH, maxH uint64

	for _, evt := range events {
		dexKey, eventName, ok := w.matchDEX(evt.Type)
		if !ok {
			continue
		}

		fields, fieldOK := parseCadenceEventFields(evt.Payload)
		if !fieldOK {
			continue
		}

		if minH == 0 || evt.BlockHeight < minH {
			minH = evt.BlockHeight
		}
		if evt.BlockHeight > maxH {
			maxH = evt.BlockHeight
		}

		// Derive pair ID from event type (e.g. A.addr.SwapPair contract address)
		pairID := w.derivePairID(evt.Type)

		asset0In := extractString(fields["amount0In"])
		if asset0In == "" {
			asset0In = extractString(fields["amountIn"])
		}
		asset0Out := extractString(fields["amount0Out"])
		asset1In := extractString(fields["amount1In"])
		asset1Out := extractString(fields["amount1Out"])
		if asset1Out == "" {
			asset1Out = extractString(fields["amountOut"])
		}

		maker := extractAddressFromFields(fields, "address", "sender", "from")

		de := models.DefiEvent{
			BlockHeight:   evt.BlockHeight,
			TransactionID: evt.TransactionID,
			EventIndex:    evt.EventIndex,
			PairID:        pairID,
			EventType:     eventName,
			Maker:         maker,
			Asset0In:      asset0In,
			Asset0Out:     asset0Out,
			Asset1In:      asset1In,
			Asset1Out:     asset1Out,
			PriceNative:   extractString(fields["price"]),
			Timestamp:     evt.Timestamp,
		}
		defiEvents = append(defiEvents, de)

		// Track pair info
		if _, exists := pairsMap[pairID]; !exists {
			pairsMap[pairID] = &models.DefiPair{
				ID:     pairID,
				DexKey: dexKey,
				// Asset IDs derived from contract type; symbols left empty (filled by metadata worker later)
				Asset0ID:     extractString(fields["token0Key"]),
				Asset1ID:     extractString(fields["token1Key"]),
				Asset0Symbol: extractString(fields["token0Symbol"]),
				Asset1Symbol: extractString(fields["token1Symbol"]),
			}
		}

		// Update reserves if available
		if pair := pairsMap[pairID]; pair != nil {
			if r0 := extractString(fields["reserve0"]); r0 != "" {
				pair.ReservesAsset0 = r0
			}
			if r1 := extractString(fields["reserve1"]); r1 != "" {
				pair.ReservesAsset1 = r1
			}
		}
	}

	if len(defiEvents) == 0 {
		return nil
	}

	// Ensure partitions
	if err := w.repo.EnsureDefiPartitions(ctx, minH, maxH); err != nil {
		return fmt.Errorf("failed to ensure defi partitions: %w", err)
	}

	// Write pairs
	if len(pairsMap) > 0 {
		pairs := make([]models.DefiPair, 0, len(pairsMap))
		for _, p := range pairsMap {
			pairs = append(pairs, *p)
		}
		if err := w.repo.UpsertDefiPairs(ctx, pairs); err != nil {
			return fmt.Errorf("failed to upsert defi pairs: %w", err)
		}
	}

	// Write events
	if err := w.repo.UpsertDefiEvents(ctx, defiEvents); err != nil {
		return fmt.Errorf("failed to upsert defi events: %w", err)
	}

	return nil
}

// derivePairID extracts a pair identifier from the full event type string.
// e.g. "A.b063c16cac85dbd1.SwapPair.Swap" -> "A.b063c16cac85dbd1.SwapPair"
func (w *DefiWorker) derivePairID(eventType string) string {
	parts := strings.Split(eventType, ".")
	if len(parts) >= 4 {
		// Return the first 3 parts: A.<address>.<ContractName>
		return strings.Join(parts[:3], ".")
	}
	return eventType
}
