package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(dbURL string) (*Repository, error) {
	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse db url: %w", err)
	}

	// Apply Pool Settings
	if maxConnStr := os.Getenv("DB_MAX_OPEN_CONNS"); maxConnStr != "" {
		if maxConn, err := strconv.Atoi(maxConnStr); err == nil {
			config.MaxConns = int32(maxConn)
		}
	}
	if minConnStr := os.Getenv("DB_MAX_IDLE_CONNS"); minConnStr != "" {
		if minConn, err := strconv.Atoi(minConnStr); err == nil {
			config.MinConns = int32(minConn)
		}
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	return &Repository{db: pool}, nil
}

func (r *Repository) Migrate(schemaPath string) error {
	content, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("failed to read schema file: %w", err)
	}

	// Execute the entire schema script
	_, err = r.db.Exec(context.Background(), string(content))
	if err != nil {
		return fmt.Errorf("failed to execute schema: %w", err)
	}
	return nil
}

func (r *Repository) Close() {
	r.db.Close()
}

// GetLastIndexedHeight gets the last sync height from checkpoints
func (r *Repository) GetLastIndexedHeight(ctx context.Context, serviceName string) (uint64, error) {
	var height uint64
	err := r.db.QueryRow(ctx, "SELECT last_height FROM indexing_checkpoints WHERE service_name = $1", serviceName).Scan(&height)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return height, nil
}

// SaveBatch atomicially saves a batch of blocks and all related data
// SaveBatch saves a batch of blocks and related data atomically
func (r *Repository) SaveBatch(ctx context.Context, blocks []*models.Block, txs []models.Transaction, events []models.Event, addressActivity []models.AddressTransaction, tokenTransfers []models.TokenTransfer, accountKeys []models.AccountKey, serviceName string, checkpointHeight uint64) error {
	if len(blocks) == 0 {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// 1. Insert Blocks
	for _, b := range blocks {
		_, err := tx.Exec(ctx, `
			INSERT INTO blocks (height, id, parent_id, timestamp, collection_count, tx_count, event_count, state_root_hash, collection_guarantees, block_seals, signatures, parent_voter_signature, block_status, execution_result_id, total_gas_used, is_sealed, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
			ON CONFLICT (height) DO UPDATE SET
				id = EXCLUDED.id,
				tx_count = EXCLUDED.tx_count,
				event_count = EXCLUDED.event_count,
				state_root_hash = EXCLUDED.state_root_hash,
				collection_guarantees = EXCLUDED.collection_guarantees,
				block_seals = EXCLUDED.block_seals,
				signatures = EXCLUDED.signatures,
				parent_voter_signature = EXCLUDED.parent_voter_signature,
				block_status = EXCLUDED.block_status,
				execution_result_id = EXCLUDED.execution_result_id,
				is_sealed = EXCLUDED.is_sealed`,
			b.Height, b.ID, b.ParentID, b.Timestamp, b.CollectionCount, b.TxCount, b.EventCount, b.StateRootHash, b.CollectionGuarantees, b.BlockSeals, b.Signatures, b.ParentVoterSignature, b.BlockStatus, b.ExecutionResultID, b.TotalGasUsed, b.IsSealed, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("failed to insert block %d: %w", b.Height, err)
		}
	}

	// 2. Insert Transactions
	for _, t := range txs {
		eventsJSON, _ := json.Marshal(t.Events)
		_, err := tx.Exec(ctx, `
			INSERT INTO transactions (id, block_height, transaction_index, proposer_address, proposer_key_index, proposer_sequence_number, payer_address, authorizers, script, arguments, reference_block_id, status, error_message, proposal_key, payload_signatures, envelope_signatures, computation_usage, status_code, execution_status, is_evm, events, gas_limit, gas_used, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
			ON CONFLICT (id) DO NOTHING`,
			t.ID, t.BlockHeight, t.TransactionIndex, t.ProposerAddress, t.ProposerKeyIndex, t.ProposerSequenceNumber, t.PayerAddress, t.Authorizers, t.Script, t.Arguments, t.ReferenceBlockID, t.Status, t.ErrorMessage, t.ProposalKey, t.PayloadSignatures, t.EnvelopeSignatures, t.ComputationUsage, t.StatusCode, t.ExecutionStatus, t.IsEVM, eventsJSON, t.GasLimit, t.GasUsed, t.CreatedAt,
		)
		if err != nil {
			return fmt.Errorf("failed to insert tx %s: %w", t.ID, err)
		}

		// 2a. Insert EVM Transaction details if applicable
		if t.IsEVM {
			evmVal := t.EVMValue
			if evmVal == "" {
				evmVal = "0"
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO evm_transactions (transaction_id, evm_hash, from_address, to_address, value, created_at)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (transaction_id) DO NOTHING`,
				t.ID, t.EVMHash, t.EVMFrom, t.EVMTo, evmVal, t.CreatedAt,
			)
			if err != nil {
				return fmt.Errorf("failed to insert evm tx %s: %w", t.ID, err)
			}
		}
	}

	// 3. Insert Events
	for _, e := range events {
		_, err := tx.Exec(ctx, `
			INSERT INTO events (
				transaction_id, transaction_index, type, event_index, 
				contract_address, contract_name, event_name, 
				payload, values, block_height, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (transaction_id, event_index) DO NOTHING`,
			e.TransactionID, e.TransactionIndex, e.Type, e.EventIndex,
			e.ContractAddress, e.ContractName, e.EventName,
			e.Payload, e.Values, e.BlockHeight, e.CreatedAt,
		)
		if err != nil {
			return fmt.Errorf("failed to insert event: %w", err)
		}
	}

	// 4. Insert Account Keys (Public Key Mapping)
	for _, ak := range accountKeys {
		_, err := tx.Exec(ctx, `
			INSERT INTO account_keys (public_key, address, transaction_id, block_height, key_index, signing_algorithm, hashing_algorithm, weight, revoked, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (public_key, address) DO UPDATE SET
				transaction_id = EXCLUDED.transaction_id,
				block_height = EXCLUDED.block_height,
				key_index = EXCLUDED.key_index,
				signing_algorithm = EXCLUDED.signing_algorithm,
				hashing_algorithm = EXCLUDED.hashing_algorithm,
				weight = EXCLUDED.weight,
				revoked = EXCLUDED.revoked`,
			ak.PublicKey, ak.Address, ak.TransactionID, ak.BlockHeight, ak.KeyIndex, ak.SigningAlgorithm, ak.HashingAlgorithm, ak.Weight, ak.Revoked, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("failed to insert account key: %w", err)
		}
	}

	// 4. Insert Address Activity
	for _, aa := range addressActivity {
		_, err := tx.Exec(ctx, `
			INSERT INTO address_transactions (address, transaction_id, block_height, role)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (address, transaction_id, role) DO NOTHING`,
			aa.Address, aa.TransactionID, aa.BlockHeight, aa.Role,
		)
		if err != nil {
			return fmt.Errorf("failed to insert addr tx: %w", err)
		}
	}

	// 5. Update Address Stats
	// Sort unique addresses to prevent deadlocks
	uniqueAddresses := make(map[string]bool)
	for _, aa := range addressActivity {
		uniqueAddresses[aa.Address] = true
	}

	sortedAddresses := make([]string, 0, len(uniqueAddresses))
	for addr := range uniqueAddresses {
		sortedAddresses = append(sortedAddresses, addr)
	}
	sort.Strings(sortedAddresses)

	for _, addr := range sortedAddresses {
		// Find any activity for this address to get the block height
		var blockHeight uint64
		for _, aa := range addressActivity {
			if aa.Address == addr {
				blockHeight = aa.BlockHeight
				break
			}
		}

		_, err := tx.Exec(ctx, `
			INSERT INTO address_stats (address, tx_count, total_gas_used, last_updated_block, updated_at)
			VALUES ($1, 1, 0, $2, $3)
			ON CONFLICT (address) DO UPDATE SET 
				tx_count = address_stats.tx_count + 1,
				last_updated_block = GREATEST(address_stats.last_updated_block, EXCLUDED.last_updated_block),
				updated_at = EXCLUDED.updated_at`,
			addr, blockHeight, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("failed to update address stats for %s: %w", addr, err)
		}
	}

	// 6. Track Smart Contracts
	for _, e := range events {
		if strings.Contains(e.Type, "AccountContractAdded") || strings.Contains(e.Type, "AccountContractUpdated") {
			var payload map[string]interface{}
			if err := json.Unmarshal(e.Payload, &payload); err == nil {
				address, _ := payload["address"].(string)
				name, _ := payload["name"].(string)
				if address != "" && name != "" {
					_, err := tx.Exec(ctx, `
						INSERT INTO smart_contracts (address, name, transaction_id, block_height, updated_at)
						VALUES ($1, $2, $3, $4, $5)
						ON CONFLICT (address, name) DO UPDATE SET
							transaction_id = EXCLUDED.transaction_id,
							block_height = EXCLUDED.block_height,
							version = smart_contracts.version + 1,
							updated_at = EXCLUDED.updated_at`,
						address, name, e.TransactionID, e.BlockHeight, time.Now(),
					)
					if err != nil {
						return fmt.Errorf("failed to track contract %s: %w", name, err)
					}
				}
			}
		}
	}

	// 7. Update Checkpoint
	_, err = tx.Exec(ctx, `
		INSERT INTO indexing_checkpoints (service_name, last_height, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (service_name) DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = EXCLUDED.updated_at`,
		serviceName, checkpointHeight, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("failed to update checkpoint: %w", err)
	}

	return tx.Commit(ctx)
}

// SaveBlockOnly inserts a block without affecting the checkpoint or other tables.
// Used for pre-insertion in batches to satisfy FK constraints.
func (r *Repository) SaveBlockOnly(ctx context.Context, block models.Block) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO blocks (height, id, parent_id, timestamp, collection_count, total_gas_used, is_sealed, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (height) DO NOTHING`,
		block.Height, block.ID, block.ParentID, block.Timestamp, block.CollectionCount, block.TotalGasUsed, block.IsSealed, time.Now(),
	)
	if err != nil {
		// Log ALL errors for debugging
		fmt.Printf("DB Error (Block %d): %v\n", block.Height, err)
		return err
	}
	return nil
}

// --- Read Methods ---

func (r *Repository) ListBlocks(ctx context.Context, limit, offset int) ([]models.Block, error) {
	rows, err := r.db.Query(ctx, `
		SELECT height, id, parent_id, timestamp, collection_count, tx_count, event_count, state_root_hash, total_gas_used, is_sealed
		FROM blocks 
		ORDER BY height DESC 
		LIMIT $1 OFFSET $2`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []models.Block
	for rows.Next() {
		var b models.Block
		err := rows.Scan(
			&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TxCount,
			&b.EventCount, &b.StateRootHash, &b.TotalGasUsed, &b.IsSealed,
		)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetRecentBlocks(ctx context.Context, limit int) ([]models.Block, error) {
	query := `
		SELECT b.height, b.id, b.parent_id, b.timestamp, b.collection_count, b.total_gas_used, b.is_sealed, b.created_at,
			   COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.block_height = b.height), 0) as tx_count
		FROM blocks b 
		ORDER BY b.height DESC 
		LIMIT $1`

	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []models.Block
	for rows.Next() {
		var b models.Block
		if err := rows.Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt, &b.TxCount); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetBlockByID(ctx context.Context, id string) (*models.Block, error) {
	var b models.Block
	err := r.db.QueryRow(ctx, "SELECT height, id, parent_id, timestamp, collection_count, total_gas_used, is_sealed, created_at FROM blocks WHERE id = $1", id).
		Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt)
	if err != nil {
		return nil, err
	}

	// Get transactions for this block
	txRows, err := r.db.Query(ctx, `
		SELECT id, block_height, proposer_address, payer_address, authorizers, script, arguments, status, error_message, is_evm, gas_limit, gas_used, created_at 
		FROM transactions 
		WHERE block_height = $1 
		ORDER BY created_at ASC`, b.Height)
	if err != nil {
		// If no transactions, just return block without them
		b.TxCount = 0
		return &b, nil
	}
	defer txRows.Close()

	var transactions []models.Transaction
	for txRows.Next() {
		var t models.Transaction
		if err := txRows.Scan(&t.ID, &t.BlockHeight, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.CreatedAt); err != nil {
			return nil, err
		}
		transactions = append(transactions, t)
	}

	b.Transactions = transactions
	b.TxCount = len(transactions)
	return &b, nil
}

func (r *Repository) GetBlockByHeight(ctx context.Context, height uint64) (*models.Block, error) {
	var b models.Block
	err := r.db.QueryRow(ctx, "SELECT height, id, parent_id, timestamp, collection_count, total_gas_used, is_sealed, created_at FROM blocks WHERE height = $1", height).
		Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt)
	if err != nil {
		return nil, err
	}

	// Get transactions for this block
	txRows, err := r.db.Query(ctx, `
		SELECT id, block_height, proposer_address, payer_address, authorizers, script, arguments, status, error_message, is_evm, gas_limit, gas_used, created_at 
		FROM transactions 
		WHERE block_height = $1 
		ORDER BY created_at ASC`, height)
	if err != nil {
		// If no transactions, just return block without them
		b.TxCount = 0
		return &b, nil
	}
	defer txRows.Close()

	var transactions []models.Transaction
	for txRows.Next() {
		var t models.Transaction
		if err := txRows.Scan(&t.ID, &t.BlockHeight, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.CreatedAt); err != nil {
			return nil, err
		}
		transactions = append(transactions, t)
	}

	b.Transactions = transactions
	b.TxCount = len(transactions)
	return &b, nil
}

func (r *Repository) GetTransactionByID(ctx context.Context, id string) (*models.Transaction, error) {
	var t models.Transaction

	// Normalize ID: remove 0x if present for consistent DB matching if it's an EVM hash search
	normalizedID := strings.TrimPrefix(id, "0x")

	// Search by transactions.id OR evm_transactions.evm_hash
	query := `
		SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, t.proposer_key_index, t.proposer_sequence_number, 
		       t.payer_address, t.authorizers, t.script, t.arguments, t.status, t.error_message, t.is_evm, t.gas_limit, t.gas_used, t.created_at,
		       COALESCE(et.evm_hash, ''), COALESCE(et.from_address, ''), COALESCE(et.to_address, ''), COALESCE(et.value, '')
		FROM transactions t
		LEFT JOIN evm_transactions et ON t.id = et.transaction_id
		WHERE t.id = $1 OR et.evm_hash = $1 OR et.evm_hash = $2`

	err := r.db.QueryRow(ctx, query, id, normalizedID).
		Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.ProposerKeyIndex, &t.ProposerSequenceNumber,
			&t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.CreatedAt,
			&t.EVMHash, &t.EVMFrom, &t.EVMTo, &t.EVMValue)

	if err != nil {
		return nil, err
	}

	// Fetch events for this transaction separately to ensure they are always present
	events, err := r.GetEventsByTransactionID(ctx, t.ID)
	if err == nil {
		t.Events = events
	}

	return &t, nil
}

func (r *Repository) GetEventsByTransactionID(ctx context.Context, txID string) ([]models.Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT transaction_id, block_height, transaction_index, type, event_index, payload, created_at
		FROM events
		WHERE transaction_id = $1
		ORDER BY event_index ASC`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.TransactionID, &e.BlockHeight, &e.TransactionIndex, &e.Type, &e.EventIndex, &e.Payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

func (r *Repository) GetTransactionsByAddress(ctx context.Context, address string, limit int) ([]models.Transaction, error) {
	query := `
		SELECT t.id, t.block_height, t.proposer_address, t.payer_address, t.authorizers, t.script, t.status, t.created_at
		FROM address_transactions at
		JOIN transactions t ON at.transaction_id = t.id
		WHERE at.address = $1
		ORDER BY at.block_height DESC
		LIMIT $2`

	rows, err := r.db.Query(ctx, query, address, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Status, &t.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

func (r *Repository) GetRecentTransactions(ctx context.Context, limit int) ([]models.Transaction, error) {
	query := `
		SELECT t.id, t.block_height, t.proposer_address, t.payer_address, t.authorizers, t.script, t.status, t.error_message, t.events, t.created_at
		FROM transactions t
		ORDER BY t.block_height DESC
		LIMIT $1`

	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Status, &t.ErrorMessage, &t.Events, &t.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

// --- Token History Methods ---

func (r *Repository) GetTokenTransfersByAddress(ctx context.Context, address string, limit int) ([]models.TokenTransfer, error) {
	query := `
		SELECT tt.id, tt.transaction_id, tt.block_height, tt.token_contract_address, tt.from_address, tt.to_address, tt.amount, tt.created_at
		FROM token_transfers tt
		WHERE tt.from_address = $1 OR tt.to_address = $1
		ORDER BY tt.block_height DESC
		LIMIT $2`

	rows, err := r.db.Query(ctx, query, address, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.FromAddress, &t.ToAddress, &t.Amount, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetNFTTransfersByAddress(ctx context.Context, address string) ([]models.NFTTransfer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, transaction_id, block_height, token_contract_address, nft_id, from_address, to_address, created_at
		FROM token_transfers
		WHERE (from_address = $1 OR to_address = $1) AND is_nft = TRUE
		ORDER BY block_height DESC`, address)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.NFTTransfer
	for rows.Next() {
		var t models.NFTTransfer
		err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.NFTID, &t.FromAddress, &t.ToAddress, &t.CreatedAt)
		if err != nil {
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
		SELECT address, tx_count, token_transfer_count, nft_transfer_count, total_gas_used, last_updated_block, created_at, updated_at
		FROM address_stats
		WHERE address = $1`, address).Scan(
		&s.Address, &s.TxCount, &s.TokenTransferCount, &s.NFTTransferCount, &s.TotalGasUsed, &s.LastUpdatedBlock, &s.CreatedAt, &s.UpdatedAt,
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
		SELECT id, address, name, version, transaction_id, block_height, is_evm, created_at, updated_at
		FROM smart_contracts
		WHERE address = $1
		LIMIT 1`, address).Scan(
		&c.ID, &c.Address, &c.Name, &c.Version, &c.TransactionID, &c.BlockHeight, &c.IsEVM, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// RefreshDailyStats aggregates transaction counts by date into daily_stats table
func (r *Repository) RefreshDailyStats(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO daily_stats (date, tx_count)
		SELECT 
			DATE(created_at) as date, 
			COUNT(*) as tx_count
		FROM transactions 
		GROUP BY DATE(created_at)
		ON CONFLICT (date) DO UPDATE SET 
			tx_count = EXCLUDED.tx_count;
	`)
	if err != nil {
		return fmt.Errorf("failed to refresh daily stats: %w", err)
	}
	return nil
}

// GetDailyStats retrieves the last 14 days of stats
func (r *Repository) GetDailyStats(ctx context.Context) ([]models.DailyStat, error) {
	rows, err := r.db.Query(ctx, `
		SELECT date, tx_count, active_accounts, new_contracts
		FROM daily_stats
		ORDER BY date DESC
		LIMIT 14`)
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

type DailyStat struct {
	Date    string `json:"date"`
	TxCount int64  `json:"tx_count"`
}

func (r *Repository) GetDailyStats(ctx context.Context) ([]DailyStat, error) {
	query := `
		SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as count
		FROM transactions
		WHERE created_at > NOW() - INTERVAL '14 days'
		GROUP BY date
		ORDER BY date ASC`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []DailyStat
	for rows.Next() {
		var s DailyStat
		if err := rows.Scan(&s.Date, &s.TxCount); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, nil
}

func (r *Repository) GetTotalTransactions(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM transactions").Scan(&count)
	return count, err
}

// GetAddressByPublicKey finds the address associated with a public key
func (r *Repository) GetAddressByPublicKey(ctx context.Context, publicKey string) (string, error) {
	var address string
	err := r.db.QueryRow(ctx, "SELECT address FROM account_keys WHERE public_key = $1 LIMIT 1", publicKey).Scan(&address)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return address, err
}
