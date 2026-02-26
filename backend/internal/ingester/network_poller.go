package ingester

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/onflow/cadence"

	"flowscan-clone/internal/config"
	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// NetworkPoller periodically fetches epoch + staking data from the Flow access node
// and stores them as status_snapshots for the frontend.
type NetworkPoller struct {
	flowClient            *flowclient.Client
	repo                  *repository.Repository
	interval              time.Duration
	lastMetadataEnrichAt  time.Time
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
	fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Fetch epoch info
	epoch, err := p.fetchEpochStatus(fetchCtx)
	if err != nil {
		log.Printf("[NetworkPoller] epoch_status error: %v", err)
	}

	// Fetch tokenomics (total staked + node count)
	if err := p.fetchTokenomics(fetchCtx); err != nil {
		log.Printf("[NetworkPoller] tokenomics error: %v", err)
	}

	// Fetch full node list and upsert into staking_nodes
	if err := p.fetchAndUpsertNodes(fetchCtx, epoch); err != nil {
		log.Printf("[NetworkPoller] node_list error: %v", err)
	}

	// Enrich node metadata with GeoIP (once per hour)
	if time.Since(p.lastMetadataEnrichAt) > 1*time.Hour {
		enrichCtx, enrichCancel := context.WithTimeout(ctx, 60*time.Second)
		defer enrichCancel()
		if err := p.enrichNodeMetadata(enrichCtx); err != nil {
			log.Printf("[NetworkPoller] node_metadata error: %v", err)
		} else {
			p.lastMetadataEnrichAt = time.Now()
		}
	}
}

// Cadence scripts use address from config.Addr() (supports testnet/mainnet).
func epochScript() string {
	return fmt.Sprintf(`
import FlowEpoch from 0x%s

access(all) fun main(): [AnyStruct] {
    let counter = FlowEpoch.currentEpochCounter
    let phase = FlowEpoch.currentEpochPhase.rawValue
    let metadata = FlowEpoch.getEpochMetadata(counter)
    let currentView = getCurrentBlock().view
    return [counter, phase, metadata?.startView, metadata?.endView, currentView]
}
`, config.Addr().FlowEpoch)
}

func stakingScript() string {
	return fmt.Sprintf(`
import FlowIDTableStaking from 0x%s

access(all) fun main(): [AnyStruct] {
    let staked = FlowIDTableStaking.getTotalStaked()
    let nodeIDs = FlowIDTableStaking.getNodeIDs()
    return [staked, UInt64(nodeIDs.length)]
}
`, config.Addr().FlowIDTableStaking)
}

// Cadence script to get full node info for ALL proposed nodes (not just staked).
// getNodeIDs() returns the full set visible to the staking table — matching FlowScan's count.
func nodeListScript() string {
	return fmt.Sprintf(`
import FlowIDTableStaking from 0x%s

access(all) fun main(): [AnyStruct] {
    let ids = FlowIDTableStaking.getNodeIDs()
    let nodes: [[AnyStruct]] = []
    for id in ids {
        let info = FlowIDTableStaking.NodeInfo(nodeID: id)
        nodes.append([
            info.id,
            info.role,
            info.networkingAddress,
            info.tokensStaked,
            info.tokensCommitted,
            info.tokensUnstaking,
            info.tokensUnstaked,
            info.tokensRewarded,
            info.delegatorIDCounter,
            info.initialWeight
        ])
    }
    return nodes
}
`, config.Addr().FlowIDTableStaking)
}

func (p *NetworkPoller) fetchEpochStatus(ctx context.Context) (uint64, error) {
	result, err := p.flowClient.ExecuteScriptAtLatestBlock(ctx, []byte(epochScript()), nil)
	if err != nil {
		return 0, fmt.Errorf("execute epoch script: %w", err)
	}

	arr, ok := result.(cadence.Array)
	if !ok || len(arr.Values) < 5 {
		return 0, fmt.Errorf("unexpected epoch script result: %v", result)
	}

	counter := npCadenceToUint64(arr.Values[0])
	phase := npCadenceToUint64(arr.Values[1])
	startView := npCadenceToUint64(arr.Values[2])
	endView := npCadenceToUint64(arr.Values[3])
	currentView := npCadenceToUint64(arr.Values[4])

	// Calculate progress using actual view numbers (not block height)
	var progress float64
	if endView > startView && currentView >= startView {
		progress = float64(currentView-startView) / float64(endView-startView) * 100
		progress = math.Max(0, math.Min(100, progress))
	}

	now := time.Now()
	payload := map[string]interface{}{
		"epoch":          counter,
		"epoch_progress": math.Round(progress*100) / 100,
		"phase":          phase,
		"start_view":     startView,
		"end_view":       endView,
		"current_view":   currentView,
		"updated_at":     now.Unix(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return counter, err
	}

	return counter, p.repo.UpsertStatusSnapshot(ctx, "epoch_status", data, now)
}

func (p *NetworkPoller) fetchTokenomics(ctx context.Context) error {
	result, err := p.flowClient.ExecuteScriptAtLatestBlock(ctx, []byte(stakingScript()), nil)
	if err != nil {
		return fmt.Errorf("execute staking script: %w", err)
	}

	arr, ok := result.(cadence.Array)
	if !ok || len(arr.Values) < 2 {
		return fmt.Errorf("unexpected staking script result: %v", result)
	}

	totalStaked := npCadenceToFloat64(arr.Values[0])
	validatorCount := npCadenceToUint64(arr.Values[1])

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

func (p *NetworkPoller) fetchAndUpsertNodes(ctx context.Context, epoch uint64) error {
	result, err := p.flowClient.ExecuteScriptAtLatestBlock(ctx, []byte(nodeListScript()), nil)
	if err != nil {
		return fmt.Errorf("execute node list script: %w", err)
	}

	outerArr, ok := result.(cadence.Array)
	if !ok {
		return fmt.Errorf("unexpected node list result type: %T", result)
	}

	nodes := make([]models.StakingNode, 0, len(outerArr.Values))
	for _, v := range outerArr.Values {
		nodeArr, ok := v.(cadence.Array)
		if !ok || len(nodeArr.Values) < 9 {
			continue
		}

		nodeID := npCadenceToString(nodeArr.Values[0])
		if nodeID == "" {
			continue
		}

		role := int(npCadenceToUint64(nodeArr.Values[1]))
		networkingAddr := npCadenceToString(nodeArr.Values[2])
		tokensStaked := npCadenceToString(nodeArr.Values[3])
		tokensCommitted := npCadenceToString(nodeArr.Values[4])
		tokensUnstaking := npCadenceToString(nodeArr.Values[5])
		tokensUnstaked := npCadenceToString(nodeArr.Values[6])
		tokensRewarded := npCadenceToString(nodeArr.Values[7])
		delegatorCount := int(npCadenceToUint64(nodeArr.Values[8]))

		nodes = append(nodes, models.StakingNode{
			NodeID:            nodeID,
			Epoch:             int64(epoch),
			Role:              role,
			NetworkingAddress: networkingAddr,
			TokensStaked:      tokensStaked,
			TokensCommitted:   tokensCommitted,
			TokensUnstaking:   tokensUnstaking,
			TokensUnstaked:    tokensUnstaked,
			TokensRewarded:    tokensRewarded,
			DelegatorCount:    delegatorCount,
		})
	}

	if len(nodes) == 0 {
		return fmt.Errorf("no nodes parsed from Cadence result")
	}

	log.Printf("[NetworkPoller] Upserting %d nodes for epoch %d", len(nodes), epoch)
	return p.repo.UpsertStakingNodes(ctx, nodes)
}

// npCadenceToUint64 extracts a uint64 from various Cadence value types
func npCadenceToUint64(v cadence.Value) uint64 {
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
			return npCadenceToUint64(val.Value)
		}
		return 0
	default:
		// Try string parsing as fallback
		s := strings.TrimSpace(v.String())
		n, _ := strconv.ParseUint(s, 10, 64)
		return n
	}
}

// npCadenceToFloat64 extracts a float64 from UFix64 or other numeric Cadence values
func npCadenceToFloat64(v cadence.Value) float64 {
	switch val := v.(type) {
	case cadence.UFix64:
		f, _ := strconv.ParseFloat(val.String(), 64)
		return f
	case cadence.Fix64:
		f, _ := strconv.ParseFloat(val.String(), 64)
		return f
	case cadence.Optional:
		if val.Value != nil {
			return npCadenceToFloat64(val.Value)
		}
		return 0
	default:
		s := strings.TrimSpace(v.String())
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
}

// enrichNodeMetadata resolves networking_address hostnames to IPs, then
// batch-queries ip-api.com for GeoIP data and upserts into app.node_metadata.
func (p *NetworkPoller) enrichNodeMetadata(ctx context.Context) error {
	// Get latest-epoch nodes
	nodes, err := p.repo.ListStakingNodesLatestEpoch(ctx, 2000, 0)
	if err != nil {
		return fmt.Errorf("list nodes for metadata: %w", err)
	}

	// Skip nodes already updated in the last 24h
	recentlyUpdated, err := p.repo.ListNodeMetadataUpdatedSince(ctx, time.Now().Add(-24*time.Hour))
	if err != nil {
		log.Printf("[NetworkPoller] warning: could not list recent metadata: %v", err)
		recentlyUpdated = make(map[string]bool)
	}

	// Collect unique hostnames, DNS resolve to IPs
	type nodeHost struct {
		nodeID   string
		hostname string
		ip       string
	}
	var toResolve []nodeHost
	seen := make(map[string]bool)

	for _, n := range nodes {
		if n.NetworkingAddress == "" || recentlyUpdated[n.NodeID] {
			continue
		}
		host, _, err := net.SplitHostPort(n.NetworkingAddress)
		if err != nil {
			host = n.NetworkingAddress
		}
		if host == "" || seen[n.NodeID] {
			continue
		}
		seen[n.NodeID] = true

		// DNS resolve
		ips, err := net.LookupHost(host)
		if err != nil || len(ips) == 0 {
			continue
		}
		toResolve = append(toResolve, nodeHost{nodeID: n.NodeID, hostname: host, ip: ips[0]})
	}

	if len(toResolve) == 0 {
		log.Printf("[NetworkPoller] No new nodes to enrich with GeoIP")
		return nil
	}

	log.Printf("[NetworkPoller] Enriching GeoIP for %d nodes", len(toResolve))

	// Batch query ip-api.com in chunks of 100
	const chunkSize = 100
	var allMetas []models.NodeMetadata

	// Build IP-to-nodeHost index (multiple nodes can share an IP)
	ipToNodes := make(map[string][]nodeHost)
	for _, nh := range toResolve {
		ipToNodes[nh.ip] = append(ipToNodes[nh.ip], nh)
	}

	// Collect unique IPs
	uniqueIPs := make([]string, 0, len(ipToNodes))
	for ip := range ipToNodes {
		uniqueIPs = append(uniqueIPs, ip)
	}

	for i := 0; i < len(uniqueIPs); i += chunkSize {
		end := i + chunkSize
		if end > len(uniqueIPs) {
			end = len(uniqueIPs)
		}
		chunk := uniqueIPs[i:end]

		results, err := batchGeoIPLookup(ctx, chunk)
		if err != nil {
			log.Printf("[NetworkPoller] GeoIP batch error (chunk %d): %v", i/chunkSize, err)
			continue
		}

		for _, r := range results {
			if r.Status != "success" {
				continue
			}
			for _, nh := range ipToNodes[r.Query] {
				allMetas = append(allMetas, models.NodeMetadata{
					NodeID:      nh.nodeID,
					IPAddress:   r.Query,
					Hostname:    nh.hostname,
					Country:     r.Country,
					CountryCode: r.CountryCode,
					Region:      r.RegionName,
					City:        r.City,
					Latitude:    r.Lat,
					Longitude:   r.Lon,
					ISP:         r.ISP,
					Org:         r.Org,
					ASNumber:    r.AS,
				})
			}
		}

		// Rate limit: ip-api.com free tier = 45 req/min; be polite
		if end < len(uniqueIPs) {
			time.Sleep(1500 * time.Millisecond)
		}
	}

	if len(allMetas) > 0 {
		if err := p.repo.UpsertNodeMetadataBatch(ctx, allMetas); err != nil {
			return fmt.Errorf("upsert node metadata: %w", err)
		}
		log.Printf("[NetworkPoller] Upserted GeoIP metadata for %d nodes", len(allMetas))
	}

	return nil
}

// geoIPResult represents a single result from the ip-api.com batch endpoint.
type geoIPResult struct {
	Status      string  `json:"status"`
	Query       string  `json:"query"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	AS          string  `json:"as"`
}

// batchGeoIPLookup calls POST http://ip-api.com/batch with up to 100 IPs.
func batchGeoIPLookup(ctx context.Context, ips []string) ([]geoIPResult, error) {
	type batchReq struct {
		Query  string `json:"query"`
		Fields string `json:"fields"`
	}

	reqBody := make([]batchReq, len(ips))
	for i, ip := range ips {
		reqBody[i] = batchReq{
			Query:  ip,
			Fields: "status,query,country,countryCode,regionName,city,lat,lon,isp,org,as",
		}
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "http://ip-api.com/batch", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ip-api.com request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ip-api.com returned %d: %s", resp.StatusCode, string(respBody))
	}

	var results []geoIPResult
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("decode ip-api.com response: %w", err)
	}

	return results, nil
}

// npCadenceToString extracts a string from a Cadence value
func npCadenceToString(v cadence.Value) string {
	switch val := v.(type) {
	case cadence.String:
		return string(val)
	case cadence.Optional:
		if val.Value != nil {
			return npCadenceToString(val.Value)
		}
		return ""
	default:
		s := v.String()
		// UFix64 values come through as e.g. "123.456" which is fine for tokens
		// String values may be quoted — strip quotes
		if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
			return s[1 : len(s)-1]
		}
		return s
	}
}
