package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/onflow/cadence"

	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/repository"
)

// NetworkPoller periodically fetches epoch + staking data from the Flow access node
// and stores them as status_snapshots for the frontend.
type NetworkPoller struct {
	flowClient *flowclient.Client
	repo       *repository.Repository
	interval   time.Duration
}

func NewNetworkPoller(flowClient *flowclient.Client, repo *repository.Repository, intervalSec int) *NetworkPoller {
	if intervalSec <= 0 {
		intervalSec = 30
	}
	return &NetworkPoller{
		flowClient: flowClient,
		repo:       repo,
		interval:   time.Duration(intervalSec) * time.Second,
	}
}

func (p *NetworkPoller) Start(ctx context.Context) {
	log.Println("[NetworkPoller] Starting (interval:", p.interval, ")")

	p.poll(ctx)

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[NetworkPoller] Stopping")
			return
		case <-ticker.C:
			p.poll(ctx)
		}
	}
}

func (p *NetworkPoller) poll(ctx context.Context) {
	fetchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	// Fetch epoch info
	if err := p.fetchEpochStatus(fetchCtx); err != nil {
		log.Printf("[NetworkPoller] epoch_status error: %v", err)
	}

	// Fetch tokenomics (total staked + node count)
	if err := p.fetchTokenomics(fetchCtx); err != nil {
		log.Printf("[NetworkPoller] tokenomics error: %v", err)
	}
}

// Cadence script to get epoch info
const epochScript = `
import FlowEpoch from 0x8624b52f9ddcd04a

access(all) fun main(): [AnyStruct] {
    let counter = FlowEpoch.currentEpochCounter
    let phase = FlowEpoch.currentEpochPhase.rawValue
    let metadata = FlowEpoch.getEpochMetadata(counter)
    return [counter, phase, metadata?.startView, metadata?.endView]
}
`

// Cadence script to get staking/tokenomics
const stakingScript = `
import FlowIDTableStaking from 0x8624b52f9ddcd04a

access(all) fun main(): [AnyStruct] {
    let staked = FlowIDTableStaking.getTotalStaked()
    let nodeIDs = FlowIDTableStaking.getStakedNodeIDs()
    return [staked, UInt64(nodeIDs.length)]
}
`

func (p *NetworkPoller) fetchEpochStatus(ctx context.Context) error {
	result, err := p.flowClient.ExecuteScriptAtLatestBlock(ctx, []byte(epochScript), nil)
	if err != nil {
		return fmt.Errorf("execute epoch script: %w", err)
	}

	arr, ok := result.(cadence.Array)
	if !ok || len(arr.Values) < 4 {
		return fmt.Errorf("unexpected epoch script result: %v", result)
	}

	counter := cadenceToUint64(arr.Values[0])
	phase := cadenceToUint64(arr.Values[1])
	startView := cadenceToUint64(arr.Values[2])
	endView := cadenceToUint64(arr.Values[3])

	// Get current view from latest block header
	latestHeight, err := p.flowClient.GetLatestBlockHeight(ctx)
	if err != nil {
		return fmt.Errorf("get latest block height: %w", err)
	}

	// Calculate progress
	var progress float64
	if endView > startView {
		// Use block height as a proxy for view (not exact, but close enough for display)
		progress = float64(latestHeight-startView) / float64(endView-startView) * 100
		progress = math.Max(0, math.Min(100, progress))
	}

	now := time.Now()
	payload := map[string]interface{}{
		"epoch":          counter,
		"epoch_progress": math.Round(progress*100) / 100,
		"phase":          phase,
		"start_view":     startView,
		"end_view":       endView,
		"current_view":   latestHeight,
		"updated_at":     now.Unix(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return p.repo.UpsertStatusSnapshot(ctx, "epoch_status", data, now)
}

func (p *NetworkPoller) fetchTokenomics(ctx context.Context) error {
	result, err := p.flowClient.ExecuteScriptAtLatestBlock(ctx, []byte(stakingScript), nil)
	if err != nil {
		return fmt.Errorf("execute staking script: %w", err)
	}

	arr, ok := result.(cadence.Array)
	if !ok || len(arr.Values) < 2 {
		return fmt.Errorf("unexpected staking script result: %v", result)
	}

	totalStaked := cadenceToFloat64(arr.Values[0])
	validatorCount := cadenceToUint64(arr.Values[1])

	now := time.Now()
	payload := map[string]interface{}{
		"total_staked":    totalStaked,
		"validator_count": validatorCount,
		"updated_at":      now.Unix(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return p.repo.UpsertStatusSnapshot(ctx, "tokenomics", data, now)
}

// cadenceToUint64 extracts a uint64 from various Cadence value types
func cadenceToUint64(v cadence.Value) uint64 {
	switch val := v.(type) {
	case cadence.UInt64:
		return uint64(val)
	case cadence.UInt8:
		return uint64(val)
	case cadence.UInt16:
		return uint64(val)
	case cadence.UInt32:
		return uint64(val)
	case cadence.Int:
		n, _ := strconv.ParseUint(val.String(), 10, 64)
		return n
	case cadence.Optional:
		if val.Value != nil {
			return cadenceToUint64(val.Value)
		}
		return 0
	default:
		// Try string parsing as fallback
		s := strings.TrimSpace(v.String())
		n, _ := strconv.ParseUint(s, 10, 64)
		return n
	}
}

// cadenceToFloat64 extracts a float64 from UFix64 or other numeric Cadence values
func cadenceToFloat64(v cadence.Value) float64 {
	switch val := v.(type) {
	case cadence.UFix64:
		f, _ := strconv.ParseFloat(val.String(), 64)
		return f
	case cadence.Fix64:
		f, _ := strconv.ParseFloat(val.String(), 64)
		return f
	case cadence.Optional:
		if val.Value != nil {
			return cadenceToFloat64(val.Value)
		}
		return 0
	default:
		s := strings.TrimSpace(v.String())
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
}
