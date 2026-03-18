package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BlockscoutDB is a read-only connection pool to the Blockscout (Flow EVM) database.
type BlockscoutDB struct {
	db *pgxpool.Pool
}

func NewBlockscoutDB(dbURL string) (*BlockscoutDB, error) {
	if dbURL == "" {
		return nil, nil
	}

	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse blockscout db url: %w", err)
	}

	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	if config.ConnConfig.RuntimeParams == nil {
		config.ConnConfig.RuntimeParams = map[string]string{}
	}
	config.ConnConfig.RuntimeParams["statement_timeout"] = "30000"
	config.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to blockscout database: %w", err)
	}

	return &BlockscoutDB{db: pool}, nil
}

func (b *BlockscoutDB) Close() {
	if b != nil && b.db != nil {
		b.db.Close()
	}
}

// EVMTokenTransferRow represents a single token transfer from Blockscout's token_transfers table.
type EVMTokenTransferRow struct {
	TxHash          string
	BlockNumber     uint64
	LogIndex        int
	FromAddress     string
	ToAddress       string
	Amount          string // decimal string for ERC-20, empty for ERC-721
	TokenID         string // for ERC-721/1155, empty for ERC-20
	TokenType       string // "ERC-20", "ERC-721", "ERC-1155"
	ContractAddress string
	TokenName       string
	TokenSymbol     string
	TokenDecimals   int
	TokenLogo       string
	Timestamp       time.Time
}

// EVMNativeTransferRow represents a native FLOW value transfer from Blockscout's transactions table.
type EVMNativeTransferRow struct {
	TxHash      string
	BlockNumber uint64
	FromAddress string
	ToAddress   string
	Value       string // wei as decimal string
	Timestamp   time.Time
	Status      int
}

// ListEVMTransfersByAddress returns combined ERC-20, ERC-721 token transfers AND native value
// transfers for a given EVM address, ordered by block_number DESC.
func (b *BlockscoutDB) ListEVMTransfersByAddress(ctx context.Context, address string, limit, offset int) ([]EVMTokenTransferRow, []EVMNativeTransferRow, int64, int64, error) {
	if b == nil || b.db == nil {
		return nil, nil, 0, 0, fmt.Errorf("blockscout database not configured")
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}

	addrBytes := hexToBytes(address)
	if len(addrBytes) == 0 {
		return nil, nil, 0, 0, fmt.Errorf("invalid address")
	}

	// Count token transfers
	var tokenTotal int64
	err := b.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM token_transfers tt
		WHERE tt.from_address_hash = $1 OR tt.to_address_hash = $1
	`, addrBytes).Scan(&tokenTotal)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("count token transfers: %w", err)
	}

	// Count native value transfers
	var nativeTotal int64
	err = b.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM transactions tx
		WHERE (tx.from_address_hash = $1 OR tx.to_address_hash = $1)
		  AND tx.value > 0
		  AND tx.status = 1
	`, addrBytes).Scan(&nativeTotal)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("count native transfers: %w", err)
	}

	// Query token transfers (ERC-20/721/1155) with token metadata
	tokenRows, err := b.db.Query(ctx, `
		SELECT
			'0x' || encode(tt.transaction_hash, 'hex') AS tx_hash,
			tt.block_number,
			tt.log_index,
			'0x' || encode(tt.from_address_hash, 'hex') AS from_addr,
			'0x' || encode(tt.to_address_hash, 'hex') AS to_addr,
			COALESCE(tt.amount::text, '') AS amount,
			COALESCE(tt.token_ids::text, '') AS token_id,
			COALESCE(t.type, 'ERC-20') AS token_type,
			'0x' || encode(tt.token_contract_address_hash, 'hex') AS contract_addr,
			COALESCE(t.name, '') AS token_name,
			COALESCE(t.symbol, '') AS token_symbol,
			COALESCE(t.decimals, 18) AS token_decimals,
			COALESCE(t.icon_url, '') AS token_logo,
			COALESCE(b.timestamp, NOW()) AS block_timestamp
		FROM token_transfers tt
		LEFT JOIN tokens t ON t.contract_address_hash = tt.token_contract_address_hash
		LEFT JOIN blocks b ON b.number = tt.block_number
		WHERE tt.from_address_hash = $1 OR tt.to_address_hash = $1
		ORDER BY tt.block_number DESC, tt.log_index DESC
		LIMIT $2 OFFSET $3
	`, addrBytes, limit, offset)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("query token transfers: %w", err)
	}
	defer tokenRows.Close()

	var tokens []EVMTokenTransferRow
	for tokenRows.Next() {
		var r EVMTokenTransferRow
		if err := tokenRows.Scan(
			&r.TxHash, &r.BlockNumber, &r.LogIndex,
			&r.FromAddress, &r.ToAddress,
			&r.Amount, &r.TokenID,
			&r.TokenType, &r.ContractAddress,
			&r.TokenName, &r.TokenSymbol, &r.TokenDecimals,
			&r.TokenLogo,
			&r.Timestamp,
		); err != nil {
			return nil, nil, 0, 0, fmt.Errorf("scan token transfer: %w", err)
		}
		tokens = append(tokens, r)
	}

	// Query native value transfers (FLOW sent via tx.value)
	nativeRows, err := b.db.Query(ctx, `
		SELECT
			'0x' || encode(tx.hash, 'hex') AS tx_hash,
			tx.block_number,
			'0x' || encode(tx.from_address_hash, 'hex') AS from_addr,
			COALESCE('0x' || encode(tx.to_address_hash, 'hex'), '') AS to_addr,
			tx.value::text AS value_wei,
			COALESCE(tx.block_timestamp, NOW()) AS block_timestamp,
			COALESCE(tx.status, 0) AS status
		FROM transactions tx
		WHERE (tx.from_address_hash = $1 OR tx.to_address_hash = $1)
		  AND tx.value > 0
		  AND tx.status = 1
		ORDER BY tx.block_number DESC, tx.index DESC
		LIMIT $2 OFFSET $3
	`, addrBytes, limit, offset)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("query native transfers: %w", err)
	}
	defer nativeRows.Close()

	var natives []EVMNativeTransferRow
	for nativeRows.Next() {
		var r EVMNativeTransferRow
		if err := nativeRows.Scan(
			&r.TxHash, &r.BlockNumber,
			&r.FromAddress, &r.ToAddress,
			&r.Value, &r.Timestamp, &r.Status,
		); err != nil {
			return nil, nil, 0, 0, fmt.Errorf("scan native transfer: %w", err)
		}
		natives = append(natives, r)
	}

	return tokens, natives, tokenTotal, nativeTotal, nil
}
