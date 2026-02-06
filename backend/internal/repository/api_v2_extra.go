package repository

import (
	"context"
	"fmt"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

type NFTCollectionSummary struct {
	ContractAddress string
	Name            string
	Symbol          string
	Count           int64
	UpdatedAt       time.Time
}

type NFTOwnerCount struct {
	Owner string
	Count int64
}

type EVMTransactionRecord struct {
	BlockHeight uint64
	EVMHash     string
	FromAddress string
	ToAddress   string
	Timestamp   time.Time
}

func (r *Repository) GetFTHolding(ctx context.Context, address, contract string) (*models.FTHolding, error) {
	var h models.FTHolding
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address, encode(contract_address, 'hex') AS contract_address, balance::text, COALESCE(last_height,0), updated_at
		FROM app.ft_holdings
		WHERE address = $1 AND contract_address = $2`, hexToBytes(address), hexToBytes(contract)).Scan(&h.Address, &h.ContractAddress, &h.Balance, &h.LastHeight, &h.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (r *Repository) ListFTTokenContracts(ctx context.Context, limit, offset int) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT encode(token_contract_address, 'hex') AS token_contract_address
		FROM app.token_transfers
		WHERE is_nft = FALSE AND token_contract_address IS NOT NULL
		ORDER BY token_contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (r *Repository) ListNFTCollectionContracts(ctx context.Context, limit, offset int) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT encode(contract_address, 'hex') AS contract_address
		FROM app.nft_ownership
		WHERE contract_address IS NOT NULL
		ORDER BY contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (r *Repository) ListNFTCollectionSummaries(ctx context.Context, limit, offset int) ([]NFTCollectionSummary, error) {
	rows, err := r.db.Query(ctx, `
		WITH counts AS (
			SELECT contract_address, COUNT(*) AS cnt
			FROM app.nft_ownership
			GROUP BY contract_address
		)
		SELECT
			COALESCE(encode(COALESCE(c.contract_address, counts.contract_address), 'hex'), '') AS contract_address,
			COALESCE(c.name, '') AS name,
			COALESCE(c.symbol, '') AS symbol,
			COALESCE(counts.cnt, 0) AS cnt,
			COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_collections c
		FULL OUTER JOIN counts ON counts.contract_address = c.contract_address
		ORDER BY contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NFTCollectionSummary
	for rows.Next() {
		var row NFTCollectionSummary
		if err := rows.Scan(&row.ContractAddress, &row.Name, &row.Symbol, &row.Count, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) GetNFTCollectionSummary(ctx context.Context, contract string) (*NFTCollectionSummary, error) {
	var row NFTCollectionSummary
	err := r.db.QueryRow(ctx, `
		WITH counts AS (
			SELECT contract_address, COUNT(*) AS cnt
			FROM app.nft_ownership
			WHERE contract_address = $1
			GROUP BY contract_address
		)
		SELECT
			COALESCE(encode(COALESCE(c.contract_address, counts.contract_address), 'hex'), '') AS contract_address,
			COALESCE(c.name, '') AS name,
			COALESCE(c.symbol, '') AS symbol,
			COALESCE(counts.cnt, 0) AS cnt,
			COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_collections c
		FULL OUTER JOIN counts ON counts.contract_address = c.contract_address
		WHERE COALESCE(c.contract_address, counts.contract_address) = $1`, hexToBytes(contract)).Scan(&row.ContractAddress, &row.Name, &row.Symbol, &row.Count, &row.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Repository) ListNFTCollectionSummariesByOwner(ctx context.Context, owner string, limit, offset int) ([]NFTCollectionSummary, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(o.contract_address, 'hex') AS contract_address,
			   COALESCE(c.name,''), COALESCE(c.symbol,''), COUNT(*) AS cnt,
			   COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_ownership o
		LEFT JOIN app.nft_collections c ON c.contract_address = o.contract_address
		WHERE o.owner = $1
		GROUP BY o.contract_address, c.name, c.symbol, c.updated_at
		ORDER BY o.contract_address ASC
		LIMIT $2 OFFSET $3`, hexToBytes(owner), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NFTCollectionSummary
	for rows.Next() {
		var row NFTCollectionSummary
		if err := rows.Scan(&row.ContractAddress, &row.Name, &row.Symbol, &row.Count, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) ListNFTOwnershipByOwnerAndCollection(ctx context.Context, owner, collection string, limit, offset int) ([]models.NFTOwnership, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address, nft_id, COALESCE(encode(owner, 'hex'), '') AS owner, COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE owner = $1 AND contract_address = $2
		ORDER BY nft_id ASC
		LIMIT $3 OFFSET $4`, hexToBytes(owner), hexToBytes(collection), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.NFTOwnership
	for rows.Next() {
		var o models.NFTOwnership
		if err := rows.Scan(&o.ContractAddress, &o.NFTID, &o.Owner, &o.LastHeight, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

func (r *Repository) ListNFTOwnerCountsByCollection(ctx context.Context, collection string, limit, offset int) ([]NFTOwnerCount, int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM app.nft_ownership WHERE contract_address = $1`, hexToBytes(collection)).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE(encode(owner, 'hex'), '') AS owner, COUNT(*) AS cnt
		FROM app.nft_ownership
		WHERE contract_address = $1
		GROUP BY owner
		ORDER BY cnt DESC
		LIMIT $2 OFFSET $3`, hexToBytes(collection), limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []NFTOwnerCount
	for rows.Next() {
		var row NFTOwnerCount
		if err := rows.Scan(&row.Owner, &row.Count); err != nil {
			return nil, 0, err
		}
		out = append(out, row)
	}
	return out, total, nil
}

func (r *Repository) ListEVMTransactions(ctx context.Context, limit, offset int) ([]EVMTransactionRecord, error) {
	rows, err := r.db.Query(ctx, `
		SELECT block_height, COALESCE(encode(evm_hash, 'hex'), ''), COALESCE(encode(from_address, 'hex'), ''), COALESCE(encode(to_address, 'hex'), ''), timestamp
		FROM app.evm_transactions
		ORDER BY block_height DESC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EVMTransactionRecord
	for rows.Next() {
		var row EVMTransactionRecord
		if err := rows.Scan(&row.BlockHeight, &row.EVMHash, &row.FromAddress, &row.ToAddress, &row.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) GetEVMTransactionByHash(ctx context.Context, hash string) (*EVMTransactionRecord, error) {
	var row EVMTransactionRecord
	err := r.db.QueryRow(ctx, `
		SELECT block_height,
		       COALESCE(encode(evm_hash, 'hex'), ''),
		       COALESCE(encode(from_address, 'hex'), ''),
		       COALESCE(encode(to_address, 'hex'), ''),
		       timestamp
		FROM app.evm_transactions
		WHERE evm_hash = $1`, hexToBytes(hash)).Scan(&row.BlockHeight, &row.EVMHash, &row.FromAddress, &row.ToAddress, &row.Timestamp)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Repository) ErrNotImplemented(msg string) error {
	return fmt.Errorf("not implemented: %s", msg)
}
