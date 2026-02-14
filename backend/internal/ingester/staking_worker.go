package ingester

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// StakingWorker processes staking-related events from raw.events and writes
// to app.staking_events, app.staking_nodes, and app.epoch_stats.
type StakingWorker struct {
	repo           *repository.Repository
	stakingAddress string // mainnet: 8624b52f9ddcd04a
}

func NewStakingWorker(repo *repository.Repository) *StakingWorker {
	addr := strings.TrimSpace(os.Getenv("FLOW_STAKING_ADDRESS"))
	if addr == "" {
		addr = "8624b52f9ddcd04a"
	}
	addr = strings.TrimPrefix(strings.ToLower(addr), "0x")
	return &StakingWorker{repo: repo, stakingAddress: addr}
}

func (w *StakingWorker) Name() string {
	return "staking_worker"
}

// stakingEventPrefix returns the prefix for FlowIDTableStaking events.
func (w *StakingWorker) stakingEventPrefix() string {
	return "A." + w.stakingAddress + ".FlowIDTableStaking."
}

// epochEventPrefix returns the prefix for FlowEpoch events.
func (w *StakingWorker) epochEventPrefix() string {
	return "A." + w.stakingAddress + ".FlowEpoch."
}

func (w *StakingWorker) isStakingEvent(eventType string) bool {
	return strings.Contains(eventType, ".FlowIDTableStaking.") ||
		strings.Contains(eventType, ".FlowEpoch.")
}

func (w *StakingWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// 1. Fetch raw events
	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("failed to fetch raw events: %w", err)
	}

	var stakingEvents []models.StakingEvent
	nodesMap := make(map[string]*models.StakingNode) // keyed by nodeID
	var epochStats []models.EpochStats

	// Track height range for partitions
	var minH, maxH uint64

	// 2. Parse events
	for _, evt := range events {
		if !w.isStakingEvent(evt.Type) {
			continue
		}

		fields, ok := parseCadenceEventFields(evt.Payload)
		if !ok {
			continue
		}

		// Track block height range
		if minH == 0 || evt.BlockHeight < minH {
			minH = evt.BlockHeight
		}
		if evt.BlockHeight > maxH {
			maxH = evt.BlockHeight
		}

		nodeID := extractString(fields["nodeID"])
		amount := extractString(fields["amount"])
		delegatorID := 0
		if did := extractString(fields["delegatorID"]); did != "" {
			if n, err := strconv.Atoi(did); err == nil {
				delegatorID = n
			}
		}

		// Extract the short event name: e.g. "TokensStaked" from "A.xxx.FlowIDTableStaking.TokensStaked"
		eventName := w.extractEventName(evt.Type)

		// Build staking event record
		se := models.StakingEvent{
			BlockHeight:   evt.BlockHeight,
			TransactionID: evt.TransactionID,
			EventIndex:    evt.EventIndex,
			EventType:     eventName,
			NodeID:        nodeID,
			DelegatorID:   delegatorID,
			Amount:        amount,
			Timestamp:     evt.Timestamp,
		}
		stakingEvents = append(stakingEvents, se)

		// Process node-related events
		if nodeID != "" {
			w.processNodeEvent(eventName, nodeID, amount, delegatorID, evt, fields, nodesMap)
		}

		// Process epoch events
		if strings.Contains(evt.Type, ".FlowEpoch.") {
			if es := w.processEpochEvent(eventName, evt, fields); es != nil {
				epochStats = append(epochStats, *es)
			}
		}
	}

	if len(stakingEvents) == 0 {
		return nil
	}

	// 3. Ensure partitions
	if err := w.repo.EnsureStakingPartitions(ctx, minH, maxH); err != nil {
		return fmt.Errorf("failed to ensure staking partitions: %w", err)
	}

	// 4. Write staking events
	if err := w.repo.UpsertStakingEvents(ctx, stakingEvents); err != nil {
		return fmt.Errorf("failed to upsert staking events: %w", err)
	}

	// 5. Write staking nodes
	if len(nodesMap) > 0 {
		nodes := make([]models.StakingNode, 0, len(nodesMap))
		for _, n := range nodesMap {
			nodes = append(nodes, *n)
		}
		if err := w.repo.UpsertStakingNodes(ctx, nodes); err != nil {
			return fmt.Errorf("failed to upsert staking nodes: %w", err)
		}
	}

	// 6. Write epoch stats
	for _, es := range epochStats {
		if err := w.repo.UpsertEpochStats(ctx, es); err != nil {
			return fmt.Errorf("failed to upsert epoch stats: %w", err)
		}
	}

	return nil
}

func (w *StakingWorker) extractEventName(eventType string) string {
	parts := strings.Split(eventType, ".")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return eventType
}

func (w *StakingWorker) processNodeEvent(
	eventName, nodeID, amount string,
	delegatorID int,
	evt models.Event,
	fields map[string]interface{},
	nodesMap map[string]*models.StakingNode,
) {
	node, ok := nodesMap[nodeID]
	if !ok {
		node = &models.StakingNode{
			NodeID:  nodeID,
			Epoch:   0, // Will be set by epoch events or default
			Address: "",
		}
		nodesMap[nodeID] = node
	}

	// Always update first_seen_height
	if node.FirstSeenHeight == 0 || evt.BlockHeight < node.FirstSeenHeight {
		node.FirstSeenHeight = evt.BlockHeight
	}

	switch eventName {
	case "NewNodeCreated":
		// Fields: nodeID, role, networkingAddress, networkingKey, stakingKey
		roleStr := extractString(fields["role"])
		if role, err := strconv.Atoi(roleStr); err == nil {
			node.Role = role
		}
		node.NetworkingAddress = extractString(fields["networkingAddress"])
		// Extract staker address if available
		if addr := extractAddress(fields["address"]); addr != "" {
			node.Address = addr
		}

	case "TokensStaked":
		node.TokensStaked = amount

	case "TokensCommitted":
		node.TokensCommitted = amount

	case "TokensUnstaking":
		node.TokensUnstaking = amount

	case "TokensUnstaked":
		node.TokensUnstaked = amount

	case "RewardsPaid":
		// Only for node rewards (not delegator)
		if delegatorID == 0 {
			node.TokensRewarded = amount
		}

	case "NewDelegatorCreated":
		node.DelegatorCount++

	case "DelegatorRewardsPaid":
		// Delegator-specific; we track on the node's delegator_count but
		// the amount goes to the delegator, not the node.
	}
}

func (w *StakingWorker) processEpochEvent(
	eventName string,
	evt models.Event,
	fields map[string]interface{},
) *models.EpochStats {
	switch eventName {
	case "EpochSetup":
		epochStr := extractString(fields["counter"])
		if epochStr == "" {
			return nil
		}
		epoch, err := strconv.ParseInt(epochStr, 10, 64)
		if err != nil {
			return nil
		}

		// Extract node IDs to count total nodes
		totalNodes := 0
		if nodeIDs, ok := fields["nodeInfo"]; ok {
			if arr, ok := nodeIDs.([]interface{}); ok {
				totalNodes = len(arr)
			}
		}

		// Use the event's block height as epoch start height.
		// Note: firstView is a consensus view number, NOT a block height.
		startHeight := evt.BlockHeight

		return &models.EpochStats{
			Epoch:       epoch,
			StartHeight: startHeight,
			TotalNodes:  totalNodes,
			StartTime:   evt.Timestamp,
		}

	case "EpochCommit":
		epochStr := extractString(fields["counter"])
		if epochStr == "" {
			return nil
		}
		epoch, err := strconv.ParseInt(epochStr, 10, 64)
		if err != nil {
			return nil
		}

		return &models.EpochStats{
			Epoch:   epoch,
			EndTime: evt.Timestamp,
		}
	}

	return nil
}
