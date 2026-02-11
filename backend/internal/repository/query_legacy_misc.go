package repository

import (
	"context"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// --- Token History Methods ---

func (r *Repository) GetTokenTransfersByAddress(ctx context.Context, address string, limit int) ([]models.TokenTransfer, error) {
	query := `
		SELECT *
		FROM (
			SELECT 0::int,
			       encode(ft.transaction_id, 'hex') AS transaction_id,
			       ft.block_height,
			       COALESCE(encode(ft.token_contract_address, 'hex'), '') AS token_contract_address,
			       COALESCE(encode(ft.from_address, 'hex'), '') AS from_address,
			       COALESCE(encode(ft.to_address, 'hex'), '') AS to_address,
			       COALESCE(ft.amount::text, '') AS amount,
			       ''::text AS token_id,
			       ft.event_index,
			       FALSE AS is_nft,
			       ft.timestamp,
			       ft.timestamp AS created_at
			FROM app.ft_transfers ft
			WHERE ft.from_address = $1 OR ft.to_address = $1

			UNION ALL

			SELECT 0::int,
			       encode(nt.transaction_id, 'hex') AS transaction_id,
			       nt.block_height,
			       COALESCE(encode(nt.token_contract_address, 'hex'), '') AS token_contract_address,
			       COALESCE(encode(nt.from_address, 'hex'), '') AS from_address,
			       COALESCE(encode(nt.to_address, 'hex'), '') AS to_address,
			       '1'::text AS amount,
			       COALESCE(nt.token_id, '') AS token_id,
			       nt.event_index,
			       TRUE AS is_nft,
			       nt.timestamp,
			       nt.timestamp AS created_at
			FROM app.nft_transfers nt
			WHERE nt.from_address = $1 OR nt.to_address = $1
		) tt
		ORDER BY tt.block_height DESC, tt.transaction_id DESC, tt.event_index DESC
		LIMIT $2`

	rows, err := r.db.Query(ctx, query, hexToBytes(address), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.IsNFT, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetTokenTransfersByAddressCursor(ctx context.Context, address string, limit int, cursor *TokenTransferCursor) ([]models.TokenTransfer, error) {
	query := `
		SELECT *
		FROM (
			SELECT 0::int,
			       encode(ft.transaction_id, 'hex') AS transaction_id,
			       ft.block_height,
			       COALESCE(encode(ft.token_contract_address, 'hex'), '') AS token_contract_address,
			       COALESCE(encode(ft.from_address, 'hex'), '') AS from_address,
			       COALESCE(encode(ft.to_address, 'hex'), '') AS to_address,
			       COALESCE(ft.amount::text, '') AS amount,
			       ''::text AS token_id,
			       ft.event_index,
			       FALSE AS is_nft,
			       ft.timestamp,
			       ft.timestamp AS created_at
			FROM app.ft_transfers ft
			WHERE ft.from_address = $1 OR ft.to_address = $1

			UNION ALL

			SELECT 0::int,
			       encode(nt.transaction_id, 'hex') AS transaction_id,
			       nt.block_height,
			       COALESCE(encode(nt.token_contract_address, 'hex'), '') AS token_contract_address,
			       COALESCE(encode(nt.from_address, 'hex'), '') AS from_address,
			       COALESCE(encode(nt.to_address, 'hex'), '') AS to_address,
			       '1'::text AS amount,
			       COALESCE(nt.token_id, '') AS token_id,
			       nt.event_index,
			       TRUE AS is_nft,
			       nt.timestamp,
			       nt.timestamp AS created_at
			FROM app.nft_transfers nt
			WHERE nt.from_address = $1 OR nt.to_address = $1
		) tt
		WHERE ($2::bigint IS NULL OR (tt.block_height, tt.transaction_id, tt.event_index) < ($2, $3, $4))
		ORDER BY tt.block_height DESC, tt.transaction_id DESC, tt.event_index DESC
		LIMIT $5`

	var (
		bh interface{}
		tx interface{}
		ev interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		tx = hexToBytes(cursor.TxID)
		ev = cursor.EventIndex
	}

	rows, err := r.db.Query(ctx, query, hexToBytes(address), bh, tx, ev, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.IsNFT, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetNFTTransfersByAddress(ctx context.Context, address string) ([]models.NFTTransfer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT 0::int,
		       encode(transaction_id, 'hex') AS transaction_id,
		       block_height,
		       COALESCE(encode(token_contract_address, 'hex'), '') AS token_contract_address,
		       COALESCE(token_id, '') AS token_id,
		       COALESCE(encode(from_address, 'hex'), '') AS from_address,
		       COALESCE(encode(to_address, 'hex'), '') AS to_address,
		       event_index,
		       timestamp,
		       timestamp AS created_at
		FROM app.nft_transfers
		WHERE (from_address = $1 OR to_address = $1)
		ORDER BY block_height DESC, transaction_id DESC, event_index DESC`, hexToBytes(address))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.NFTTransfer
	for rows.Next() {
		var t models.NFTTransfer
		err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.NFTID, &t.FromAddress, &t.ToAddress, &t.EventIndex, &t.Timestamp, &t.CreatedAt)
		if err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetNFTTransfersByAddressCursor(ctx context.Context, address string, limit int, cursor *TokenTransferCursor) ([]models.NFTTransfer, error) {
	query := `
		SELECT 0::int,
		       encode(tt.transaction_id, 'hex') AS transaction_id,
		       tt.block_height,
		       COALESCE(encode(tt.token_contract_address, 'hex'), '') AS token_contract_address,
		       COALESCE(tt.token_id, '') AS token_id,
		       COALESCE(encode(tt.from_address, 'hex'), '') AS from_address,
		       COALESCE(encode(tt.to_address, 'hex'), '') AS to_address,
		       tt.event_index,
		       tt.timestamp,
		       tt.timestamp AS created_at
		FROM app.nft_transfers tt
		WHERE (tt.from_address = $1 OR tt.to_address = $1)
		  AND ($2::bigint IS NULL OR (tt.block_height, tt.transaction_id, tt.event_index) < ($2, $3, $4))
		ORDER BY tt.block_height DESC, tt.transaction_id DESC, tt.event_index DESC
		LIMIT $5`

	var (
		bh interface{}
		tx interface{}
		ev interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		tx = hexToBytes(cursor.TxID)
		ev = cursor.EventIndex
	}

	rows, err := r.db.Query(ctx, query, hexToBytes(address), bh, tx, ev, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.NFTTransfer
	for rows.Next() {
		var t models.NFTTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.NFTID, &t.FromAddress, &t.ToAddress, &t.EventIndex, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

// GetAddressStats retrieves pre-calculated stats for an address
func (r *Repository) GetAddressStats(ctx context.Context, address string) (*models.AddressStats, error) {
	var s models.AddressStats
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address, tx_count, total_gas_used, last_updated_block, created_at, updated_at
		FROM app.address_stats
		WHERE address = $1`, hexToBytes(address)).Scan(
		&s.Address, &s.TxCount, &s.TotalGasUsed, &s.LastUpdatedBlock, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// GetContractByAddress retrieves contract metadata
func (r *Repository) GetContractByAddress(ctx context.Context, address string) (*models.SmartContract, error) {
	var c models.SmartContract
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address, name, version, last_updated_height, created_at, updated_at
		FROM app.smart_contracts
		WHERE address = $1
		LIMIT 1`, hexToBytes(address)).Scan(
		&c.Address, &c.Name, &c.Version, &c.BlockHeight, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// RefreshDailyStats aggregates transaction counts by date into daily_stats table
func (r *Repository) RefreshDailyStats(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.daily_stats (date, tx_count, updated_at)
		SELECT 
			DATE(timestamp) as date, 
			COUNT(*) as tx_count,
			NOW() as updated_at
		FROM raw.transactions
		WHERE timestamp IS NOT NULL
		  AND timestamp >= NOW() - INTERVAL '30 days'
		GROUP BY DATE(timestamp)
		ON CONFLICT (date) DO UPDATE SET 
			tx_count = EXCLUDED.tx_count,
			updated_at = NOW();
	`)
	if err != nil {
		return fmt.Errorf("failed to refresh daily stats: %w", err)
	}
	return nil
}

// GetDailyStats retrieves the last 30 days of stats
func (r *Repository) GetDailyStats(ctx context.Context) ([]models.DailyStat, error) {
	rows, err := r.db.Query(ctx, `
		SELECT date::text, tx_count, active_accounts, new_contracts
		FROM app.daily_stats
		WHERE date >= CURRENT_DATE - INTERVAL '29 days'
		ORDER BY date ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []models.DailyStat
	for rows.Next() {
		var s models.DailyStat
		if err := rows.Scan(&s.Date, &s.TxCount, &s.ActiveAccounts, &s.NewContracts); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, nil
}

func (r *Repository) GetTotalTransactions(ctx context.Context) (int64, error) {
	estimate, err := r.estimatePartitionCount(ctx, "raw", "transactions_p%")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM raw.transactions").Scan(&count)
	return count, err
}

func (r *Repository) GetTotalEvents(ctx context.Context) (int64, error) {
	estimate, err := r.estimatePartitionCount(ctx, "raw", "events_p%")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM raw.events").Scan(&count)
	return count, err
}

func (r *Repository) GetTotalAddresses(ctx context.Context) (int64, error) {
	statsEstimate, _ := r.estimateTableCount(ctx, "app", "address_stats")
	accountsEstimate, _ := r.estimateTableCount(ctx, "app", "accounts")
	if statsEstimate > 0 || accountsEstimate > 0 {
		if accountsEstimate > statsEstimate {
			return accountsEstimate, nil
		}
		return statsEstimate, nil
	}

	var count int64
	err := r.db.QueryRow(ctx, `
		SELECT GREATEST(
			(SELECT COUNT(*) FROM app.address_stats),
			(SELECT COUNT(*) FROM app.accounts)
		)`,
	).Scan(&count)
	return count, err
}

func (r *Repository) GetTotalContracts(ctx context.Context) (int64, error) {
	estimate, err := r.estimateTableCount(ctx, "app", "smart_contracts")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM app.smart_contracts").Scan(&count)
	return count, err
}

func (r *Repository) GetTotalEVMTransactions(ctx context.Context) (int64, error) {
	estimate, err := r.estimatePartitionCount(ctx, "app", "evm_transactions_p%")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM app.evm_transactions").Scan(&count)
	return count, err
}

// GetBlockRange returns min height, max height, and total count of blocks
func (r *Repository) GetBlockRange(ctx context.Context) (uint64, uint64, int64, error) {
	var minH, maxH uint64
	// Use coalesce(..., 0) to handle empty table for min/max.
	err := r.db.QueryRow(ctx, `
		SELECT 
			COALESCE(MIN(height), 0), 
			COALESCE(MAX(height), 0)
		FROM raw.blocks
	`).Scan(&minH, &maxH)
	if err != nil {
		return 0, 0, 0, err
	}

	count, err := r.estimatePartitionCount(ctx, "raw", "blocks_p%")
	if err != nil {
		count = 0
	}
	return minH, maxH, count, nil
}

func (r *Repository) estimatePartitionCount(ctx context.Context, schema, relPattern string) (int64, error) {
	var estimate int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(c.reltuples), 0)::bigint
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1
		  AND c.relkind = 'r'
		  AND c.relname LIKE $2
	`, schema, relPattern).Scan(&estimate)
	if err != nil {
		return 0, err
	}
	return estimate, nil
}

func (r *Repository) estimateTableCount(ctx context.Context, schema, table string) (int64, error) {
	var estimate int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(c.reltuples, 0)::bigint
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1
		  AND c.relkind = 'r'
		  AND c.relname = $2
	`, schema, table).Scan(&estimate)
	if err != nil {
		return 0, err
	}
	return estimate, nil
}

func (r *Repository) GetAllCheckpoints(ctx context.Context) (map[string]uint64, error) {
	rows, err := r.db.Query(ctx, "SELECT service_name, last_height FROM app.indexing_checkpoints")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make(map[string]uint64)
	for rows.Next() {
		var name string
		var height uint64
		if err := rows.Scan(&name, &height); err != nil {
			return nil, err
		}
		results[name] = height
	}
	return results, nil
}

// GetAddressByPublicKey finds the address associated with a public key
func (r *Repository) GetAddressByPublicKey(ctx context.Context, publicKey string) (string, error) {
	publicKey = strings.TrimSpace(publicKey)
	publicKey = strings.TrimPrefix(strings.ToLower(publicKey), "0x")
	if publicKey == "" {
		return "", nil
	}

	var address string
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address
		FROM app.account_keys
		WHERE public_key = $1 AND revoked = FALSE
		ORDER BY last_updated_height DESC
		LIMIT 1`, hexToBytes(publicKey)).Scan(&address)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return address, err
}
