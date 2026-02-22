package repository

import (
	"context"
	"fmt"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// UpsertStakingEvents batch inserts staking events with ON CONFLICT DO NOTHING.
func (r *Repository) UpsertStakingEvents(ctx context.Context, events []models.StakingEvent) error {
	if len(events) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, e := range events {
		batch.Queue(`
			INSERT INTO app.staking_events (
				block_height, transaction_id, event_index,
				event_type, node_id, delegator_id, amount, timestamp
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (block_height, transaction_id, event_index) DO NOTHING`,
			e.BlockHeight, hexToBytes(e.TransactionID), e.EventIndex,
			e.EventType, e.NodeID, e.DelegatorID, numericOrZero(e.Amount), e.Timestamp,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(events); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("failed to insert staking event batch: %w", err)
		}
	}
	return nil
}

// UpsertStakingNodes batch upserts staking nodes.
func (r *Repository) UpsertStakingNodes(ctx context.Context, nodes []models.StakingNode) error {
	if len(nodes) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, n := range nodes {
		batch.Queue(`
			INSERT INTO app.staking_nodes (
				node_id, epoch, address, role, networking_address,
				tokens_staked, tokens_committed, tokens_unstaking,
				tokens_unstaked, tokens_rewarded, delegator_count,
				first_seen_height, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (node_id, epoch) DO UPDATE SET
				address = EXCLUDED.address,
				role = EXCLUDED.role,
				networking_address = COALESCE(NULLIF(EXCLUDED.networking_address, ''), app.staking_nodes.networking_address),
				tokens_staked = CASE WHEN EXCLUDED.tokens_staked > 0 THEN EXCLUDED.tokens_staked ELSE app.staking_nodes.tokens_staked END,
				tokens_committed = CASE WHEN EXCLUDED.tokens_committed > 0 THEN EXCLUDED.tokens_committed ELSE app.staking_nodes.tokens_committed END,
				tokens_unstaking = CASE WHEN EXCLUDED.tokens_unstaking > 0 THEN EXCLUDED.tokens_unstaking ELSE app.staking_nodes.tokens_unstaking END,
				tokens_unstaked = CASE WHEN EXCLUDED.tokens_unstaked > 0 THEN EXCLUDED.tokens_unstaked ELSE app.staking_nodes.tokens_unstaked END,
				tokens_rewarded = CASE WHEN EXCLUDED.tokens_rewarded > 0 THEN EXCLUDED.tokens_rewarded ELSE app.staking_nodes.tokens_rewarded END,
				delegator_count = CASE WHEN EXCLUDED.delegator_count > 0 THEN EXCLUDED.delegator_count ELSE app.staking_nodes.delegator_count END,
				updated_at = EXCLUDED.updated_at`,
			n.NodeID, n.Epoch, hexToBytes(n.Address), n.Role, n.NetworkingAddress,
			numericOrZero(n.TokensStaked), numericOrZero(n.TokensCommitted), numericOrZero(n.TokensUnstaking),
			numericOrZero(n.TokensUnstaked), numericOrZero(n.TokensRewarded), n.DelegatorCount,
			n.FirstSeenHeight, time.Now(),
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(nodes); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("failed to upsert staking node batch: %w", err)
		}
	}
	return nil
}

// UpsertEpochStats upserts a single epoch stats record.
func (r *Repository) UpsertEpochStats(ctx context.Context, stats models.EpochStats) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.epoch_stats (
			epoch, start_height, end_height, start_time, end_time,
			total_nodes, total_staked, total_rewarded,
			payout_total, payout_from_fees, payout_minted, payout_fees_burned,
			payout_height, payout_time, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (epoch) DO UPDATE SET
			start_height = COALESCE(EXCLUDED.start_height, app.epoch_stats.start_height),
			end_height = COALESCE(EXCLUDED.end_height, app.epoch_stats.end_height),
			start_time = COALESCE(EXCLUDED.start_time, app.epoch_stats.start_time),
			end_time = COALESCE(EXCLUDED.end_time, app.epoch_stats.end_time),
			total_nodes = CASE WHEN EXCLUDED.total_nodes > 0 THEN EXCLUDED.total_nodes ELSE app.epoch_stats.total_nodes END,
			total_staked = CASE WHEN EXCLUDED.total_staked > 0 THEN EXCLUDED.total_staked ELSE app.epoch_stats.total_staked END,
			total_rewarded = CASE WHEN EXCLUDED.total_rewarded > 0 THEN EXCLUDED.total_rewarded ELSE app.epoch_stats.total_rewarded END,
			payout_total = CASE WHEN EXCLUDED.payout_total > 0 THEN EXCLUDED.payout_total ELSE app.epoch_stats.payout_total END,
			payout_from_fees = CASE WHEN EXCLUDED.payout_from_fees > 0 THEN EXCLUDED.payout_from_fees ELSE app.epoch_stats.payout_from_fees END,
			payout_minted = CASE WHEN EXCLUDED.payout_minted > 0 THEN EXCLUDED.payout_minted ELSE app.epoch_stats.payout_minted END,
			payout_fees_burned = CASE WHEN EXCLUDED.payout_fees_burned > 0 THEN EXCLUDED.payout_fees_burned ELSE app.epoch_stats.payout_fees_burned END,
			payout_height = CASE WHEN EXCLUDED.payout_height > 0 THEN EXCLUDED.payout_height ELSE app.epoch_stats.payout_height END,
			payout_time = CASE WHEN EXCLUDED.payout_height > 0 THEN EXCLUDED.payout_time ELSE app.epoch_stats.payout_time END,
			updated_at = EXCLUDED.updated_at`,
		stats.Epoch, stats.StartHeight, stats.EndHeight, stats.StartTime, stats.EndTime,
		stats.TotalNodes, numericOrZero(stats.TotalStaked), numericOrZero(stats.TotalRewarded),
		numericOrZero(stats.PayoutTotal), numericOrZero(stats.PayoutFromFees),
		numericOrZero(stats.PayoutMinted), numericOrZero(stats.PayoutFeesBurned),
		stats.PayoutHeight, stats.PayoutTime, time.Now(),
	)
	return err
}

// ListStakingNodes returns staking nodes for a given epoch, ordered by tokens_staked desc.
func (r *Repository) ListStakingNodes(ctx context.Context, epoch int64, limit, offset int) ([]models.StakingNode, error) {
	query := `
		SELECT node_id, epoch, COALESCE(encode(address, 'hex'), '') AS address, role,
			COALESCE(networking_address, '') AS networking_address,
			COALESCE(tokens_staked, 0), COALESCE(tokens_committed, 0),
			COALESCE(tokens_unstaking, 0), COALESCE(tokens_unstaked, 0),
			COALESCE(tokens_rewarded, 0), COALESCE(delegator_count, 0),
			COALESCE(first_seen_height, 0), updated_at
		FROM app.staking_nodes
		WHERE epoch = $1
		ORDER BY tokens_staked DESC
		LIMIT $2 OFFSET $3`

	rows, err := r.db.Query(ctx, query, epoch, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list staking nodes: %w", err)
	}
	defer rows.Close()

	return scanStakingNodes(rows)
}

// ListStakingNodesLatestEpoch returns staking nodes for the latest epoch.
func (r *Repository) ListStakingNodesLatestEpoch(ctx context.Context, limit, offset int) ([]models.StakingNode, error) {
	query := `
		SELECT node_id, epoch, COALESCE(encode(address, 'hex'), '') AS address, role,
			COALESCE(networking_address, '') AS networking_address,
			COALESCE(tokens_staked, 0), COALESCE(tokens_committed, 0),
			COALESCE(tokens_unstaking, 0), COALESCE(tokens_unstaked, 0),
			COALESCE(tokens_rewarded, 0), COALESCE(delegator_count, 0),
			COALESCE(first_seen_height, 0), updated_at
		FROM app.staking_nodes
		WHERE epoch = (SELECT MAX(epoch) FROM app.staking_nodes)
		ORDER BY tokens_staked DESC
		LIMIT $1 OFFSET $2`

	rows, err := r.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list staking nodes latest epoch: %w", err)
	}
	defer rows.Close()

	return scanStakingNodes(rows)
}

// GetStakingNode returns the latest epoch entry for a node.
func (r *Repository) GetStakingNode(ctx context.Context, nodeID string) (*models.StakingNode, error) {
	query := `
		SELECT node_id, epoch, COALESCE(encode(address, 'hex'), '') AS address, role,
			COALESCE(networking_address, '') AS networking_address,
			COALESCE(tokens_staked, 0), COALESCE(tokens_committed, 0),
			COALESCE(tokens_unstaking, 0), COALESCE(tokens_unstaked, 0),
			COALESCE(tokens_rewarded, 0), COALESCE(delegator_count, 0),
			COALESCE(first_seen_height, 0), updated_at
		FROM app.staking_nodes
		WHERE node_id = $1
		ORDER BY epoch DESC
		LIMIT 1`

	var n models.StakingNode
	err := r.db.QueryRow(ctx, query, nodeID).Scan(
		&n.NodeID, &n.Epoch, &n.Address, &n.Role,
		&n.NetworkingAddress,
		&n.TokensStaked, &n.TokensCommitted,
		&n.TokensUnstaking, &n.TokensUnstaked,
		&n.TokensRewarded, &n.DelegatorCount,
		&n.FirstSeenHeight, &n.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// ListStakingEventsByNode returns staking events for a given node, newest first.
func (r *Repository) ListStakingEventsByNode(ctx context.Context, nodeID string, limit, offset int) ([]models.StakingEvent, error) {
	query := `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id,
			event_index, event_type, COALESCE(node_id, ''),
			COALESCE(delegator_id, 0), COALESCE(amount, 0)::TEXT, timestamp
		FROM app.staking_events
		WHERE node_id = $1
		ORDER BY block_height DESC, event_index DESC
		LIMIT $2 OFFSET $3`

	rows, err := r.db.Query(ctx, query, nodeID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list staking events by node: %w", err)
	}
	defer rows.Close()

	var events []models.StakingEvent
	for rows.Next() {
		var e models.StakingEvent
		if err := rows.Scan(
			&e.BlockHeight, &e.TransactionID,
			&e.EventIndex, &e.EventType, &e.NodeID,
			&e.DelegatorID, &e.Amount, &e.Timestamp,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// GetLatestEpochStats returns the most recent epoch stats.
func (r *Repository) GetLatestEpochStats(ctx context.Context) (*models.EpochStats, error) {
	query := `
		SELECT epoch, COALESCE(start_height, 0), COALESCE(end_height, 0),
			COALESCE(start_time, '1970-01-01'::TIMESTAMPTZ), COALESCE(end_time, '1970-01-01'::TIMESTAMPTZ),
			COALESCE(total_nodes, 0), COALESCE(total_staked, 0)::TEXT,
			COALESCE(total_rewarded, 0)::TEXT, updated_at
		FROM app.epoch_stats
		ORDER BY epoch DESC
		LIMIT 1`

	var s models.EpochStats
	err := r.db.QueryRow(ctx, query).Scan(
		&s.Epoch, &s.StartHeight, &s.EndHeight,
		&s.StartTime, &s.EndTime,
		&s.TotalNodes, &s.TotalStaked,
		&s.TotalRewarded, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// ListEpochStats returns epoch stats ordered by epoch descending.
func (r *Repository) ListEpochStats(ctx context.Context, limit, offset int) ([]models.EpochStats, error) {
	query := `
		SELECT epoch, COALESCE(start_height, 0), COALESCE(end_height, 0),
			COALESCE(start_time, '1970-01-01'::TIMESTAMPTZ), COALESCE(end_time, '1970-01-01'::TIMESTAMPTZ),
			COALESCE(total_nodes, 0), COALESCE(total_staked, 0)::TEXT,
			COALESCE(total_rewarded, 0)::TEXT, updated_at
		FROM app.epoch_stats
		ORDER BY epoch DESC
		LIMIT $1 OFFSET $2`

	rows, err := r.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list epoch stats: %w", err)
	}
	defer rows.Close()

	var stats []models.EpochStats
	for rows.Next() {
		var s models.EpochStats
		if err := rows.Scan(
			&s.Epoch, &s.StartHeight, &s.EndHeight,
			&s.StartTime, &s.EndTime,
			&s.TotalNodes, &s.TotalStaked,
			&s.TotalRewarded, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

// ListEpochPayouts returns epoch payout data ordered by epoch descending.
func (r *Repository) ListEpochPayouts(ctx context.Context, limit, offset int) ([]models.EpochStats, error) {
	query := `
		SELECT epoch,
			COALESCE(payout_total, 0)::TEXT, COALESCE(payout_from_fees, 0)::TEXT,
			COALESCE(payout_minted, 0)::TEXT, COALESCE(payout_fees_burned, 0)::TEXT,
			COALESCE(payout_height, 0), COALESCE(payout_time, '1970-01-01'::TIMESTAMPTZ)
		FROM app.epoch_stats
		WHERE payout_height IS NOT NULL AND payout_height > 0
		ORDER BY epoch DESC
		LIMIT $1 OFFSET $2`

	rows, err := r.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list epoch payouts: %w", err)
	}
	defer rows.Close()

	var stats []models.EpochStats
	for rows.Next() {
		var s models.EpochStats
		if err := rows.Scan(
			&s.Epoch,
			&s.PayoutTotal, &s.PayoutFromFees,
			&s.PayoutMinted, &s.PayoutFeesBurned,
			&s.PayoutHeight, &s.PayoutTime,
		); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

// ListStakingDelegators returns delegators, optionally filtered by node_id.
func (r *Repository) ListStakingDelegators(ctx context.Context, nodeID string, limit, offset int) ([]models.StakingDelegator, error) {
	var query string
	var args []interface{}

	if nodeID != "" {
		query = `
			SELECT delegator_id, node_id, COALESCE(encode(address, 'hex'), '') AS address,
				COALESCE(tokens_committed, 0)::TEXT, COALESCE(tokens_staked, 0)::TEXT,
				COALESCE(tokens_unstaking, 0)::TEXT, COALESCE(tokens_rewarded, 0)::TEXT,
				COALESCE(tokens_unstaked, 0)::TEXT, COALESCE(block_height, 0), updated_at
			FROM app.staking_delegators
			WHERE node_id = $1
			ORDER BY tokens_staked DESC
			LIMIT $2 OFFSET $3`
		args = []interface{}{nodeID, limit, offset}
	} else {
		query = `
			SELECT delegator_id, node_id, COALESCE(encode(address, 'hex'), '') AS address,
				COALESCE(tokens_committed, 0)::TEXT, COALESCE(tokens_staked, 0)::TEXT,
				COALESCE(tokens_unstaking, 0)::TEXT, COALESCE(tokens_rewarded, 0)::TEXT,
				COALESCE(tokens_unstaked, 0)::TEXT, COALESCE(block_height, 0), updated_at
			FROM app.staking_delegators
			ORDER BY tokens_staked DESC
			LIMIT $1 OFFSET $2`
		args = []interface{}{limit, offset}
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list staking delegators: %w", err)
	}
	defer rows.Close()

	var delegators []models.StakingDelegator
	for rows.Next() {
		var d models.StakingDelegator
		if err := rows.Scan(
			&d.DelegatorID, &d.NodeID, &d.Address,
			&d.TokensCommitted, &d.TokensStaked,
			&d.TokensUnstaking, &d.TokensRewarded,
			&d.TokensUnstaked, &d.BlockHeight, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		delegators = append(delegators, d)
	}
	return delegators, rows.Err()
}

// ListStakingEventsByType returns staking events with an exact event_type match.
func (r *Repository) ListStakingEventsByType(ctx context.Context, eventType string, limit, offset int) ([]models.StakingEvent, error) {
	query := `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id,
			event_index, event_type, COALESCE(node_id, ''),
			COALESCE(delegator_id, 0), COALESCE(amount, 0)::TEXT, timestamp
		FROM app.staking_events
		WHERE event_type = $1
		ORDER BY block_height DESC, event_index DESC
		LIMIT $2 OFFSET $3`

	rows, err := r.db.Query(ctx, query, eventType, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list staking events by type: %w", err)
	}
	defer rows.Close()

	var events []models.StakingEvent
	for rows.Next() {
		var e models.StakingEvent
		if err := rows.Scan(
			&e.BlockHeight, &e.TransactionID,
			&e.EventIndex, &e.EventType, &e.NodeID,
			&e.DelegatorID, &e.Amount, &e.Timestamp,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// ListStakingEventsByTypeLike returns staking events where event_type matches a LIKE pattern.
func (r *Repository) ListStakingEventsByTypeLike(ctx context.Context, pattern string, limit, offset int) ([]models.StakingEvent, error) {
	query := `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id,
			event_index, event_type, COALESCE(node_id, ''),
			COALESCE(delegator_id, 0), COALESCE(amount, 0)::TEXT, timestamp
		FROM app.staking_events
		WHERE event_type LIKE $1
		ORDER BY block_height DESC, event_index DESC
		LIMIT $2 OFFSET $3`

	rows, err := r.db.Query(ctx, query, pattern, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list staking events by type like: %w", err)
	}
	defer rows.Close()

	var events []models.StakingEvent
	for rows.Next() {
		var e models.StakingEvent
		if err := rows.Scan(
			&e.BlockHeight, &e.TransactionID,
			&e.EventIndex, &e.EventType, &e.NodeID,
			&e.DelegatorID, &e.Amount, &e.Timestamp,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// GetLatestTokenomicsSnapshot returns the most recent tokenomics snapshot.
func (r *Repository) GetLatestTokenomicsSnapshot(ctx context.Context) (map[string]interface{}, error) {
	var totalSupply, circulatingSupply, totalStaked, stakingAPY *float64
	var validatorCount, delegatorCount *int
	var asOf time.Time

	err := r.db.QueryRow(ctx, `
		SELECT total_supply, circulating_supply, total_staked, staking_apy,
			validator_count, delegator_count, as_of
		FROM app.tokenomics_snapshots
		ORDER BY as_of DESC
		LIMIT 1`).Scan(
		&totalSupply, &circulatingSupply, &totalStaked, &stakingAPY,
		&validatorCount, &delegatorCount, &asOf,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get tokenomics snapshot: %w", err)
	}

	result := map[string]interface{}{
		"as_of": asOf.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if totalSupply != nil {
		result["total_supply"] = *totalSupply
	}
	if circulatingSupply != nil {
		result["circulating_supply"] = *circulatingSupply
	}
	if totalStaked != nil {
		result["total_staked"] = *totalStaked
	}
	if stakingAPY != nil {
		result["staking_apy"] = *stakingAPY
	}
	if validatorCount != nil {
		result["validator_count"] = *validatorCount
	}
	if delegatorCount != nil {
		result["delegator_count"] = *delegatorCount
	}

	return result, nil
}

// UpsertNodeMetadataBatch batch upserts node metadata (GeoIP data).
func (r *Repository) UpsertNodeMetadataBatch(ctx context.Context, metas []models.NodeMetadata) error {
	if len(metas) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, m := range metas {
		batch.Queue(`
			INSERT INTO app.node_metadata (
				node_id, ip_address, hostname, country, country_code,
				region, city, latitude, longitude, isp, org, as_number, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (node_id) DO UPDATE SET
				ip_address   = EXCLUDED.ip_address,
				hostname     = EXCLUDED.hostname,
				country      = EXCLUDED.country,
				country_code = EXCLUDED.country_code,
				region       = EXCLUDED.region,
				city         = EXCLUDED.city,
				latitude     = EXCLUDED.latitude,
				longitude    = EXCLUDED.longitude,
				isp          = EXCLUDED.isp,
				org          = EXCLUDED.org,
				as_number    = EXCLUDED.as_number,
				updated_at   = EXCLUDED.updated_at`,
			m.NodeID, m.IPAddress, m.Hostname, m.Country, m.CountryCode,
			m.Region, m.City, m.Latitude, m.Longitude, m.ISP, m.Org, m.ASNumber, time.Now(),
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(metas); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("failed to upsert node metadata batch: %w", err)
		}
	}
	return nil
}

// ListNodeMetadata returns all node metadata rows keyed by node_id.
func (r *Repository) ListNodeMetadata(ctx context.Context) (map[string]models.NodeMetadata, error) {
	rows, err := r.db.Query(ctx, `
		SELECT node_id, COALESCE(ip_address, ''), COALESCE(hostname, ''),
			COALESCE(country, ''), COALESCE(country_code, ''), COALESCE(region, ''),
			COALESCE(city, ''), COALESCE(latitude, 0), COALESCE(longitude, 0),
			COALESCE(isp, ''), COALESCE(org, ''), COALESCE(as_number, ''), updated_at
		FROM app.node_metadata`)
	if err != nil {
		return nil, fmt.Errorf("list node metadata: %w", err)
	}
	defer rows.Close()

	result := make(map[string]models.NodeMetadata)
	for rows.Next() {
		var m models.NodeMetadata
		if err := rows.Scan(
			&m.NodeID, &m.IPAddress, &m.Hostname,
			&m.Country, &m.CountryCode, &m.Region,
			&m.City, &m.Latitude, &m.Longitude,
			&m.ISP, &m.Org, &m.ASNumber, &m.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result[m.NodeID] = m
	}
	return result, rows.Err()
}

// ListNodeMetadataUpdatedSince returns node_ids that have been updated since the given time.
func (r *Repository) ListNodeMetadataUpdatedSince(ctx context.Context, since time.Time) (map[string]bool, error) {
	rows, err := r.db.Query(ctx, `SELECT node_id FROM app.node_metadata WHERE updated_at > $1`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = true
	}
	return result, rows.Err()
}

func scanStakingNodes(rows pgx.Rows) ([]models.StakingNode, error) {
	var nodes []models.StakingNode
	for rows.Next() {
		var n models.StakingNode
		if err := rows.Scan(
			&n.NodeID, &n.Epoch, &n.Address, &n.Role,
			&n.NetworkingAddress,
			&n.TokensStaked, &n.TokensCommitted,
			&n.TokensUnstaking, &n.TokensUnstaked,
			&n.TokensRewarded, &n.DelegatorCount,
			&n.FirstSeenHeight, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}
