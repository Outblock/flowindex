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
	ContractName    string
	Name            string
	Symbol          string
	Description     string
	ExternalURL     string
	SquareImage     string
	BannerImage     string
	Socials         []byte
	Count           int64
	HolderCount     int64
	TransferCount   int64
	EVMAddress      string
	UpdatedAt       time.Time
}

type NFTOwnerCount struct {
	Owner string
	Count int64
}

func (r *Repository) CountFTHoldingsByToken(ctx context.Context, contract, contractName string) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM app.ft_holdings
		WHERE contract_address = $1
		  AND ($2 = '' OR contract_name = $2)
		  AND balance > 0`, hexToBytes(contract), contractName).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) CountFTHoldingsByAddress(ctx context.Context, address string) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM app.ft_holdings
		WHERE address = $1
		  AND balance > 0`, hexToBytes(address)).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) CountFTTokens(ctx context.Context) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM app.ft_tokens`).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) CountFTTokenContracts(ctx context.Context) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM app.ft_tokens`).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) CountNFTCollectionSummaries(ctx context.Context) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `
		WITH counts AS (
			SELECT contract_address, contract_name
			FROM app.nft_ownership
			GROUP BY contract_address, contract_name
		),
		unioned AS (
			SELECT contract_address, contract_name FROM app.nft_collections
			UNION
			SELECT contract_address, contract_name FROM counts
		)
		SELECT COUNT(*) FROM unioned`).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) HasAnyFTHoldings(ctx context.Context) (bool, error) {
	// Cheap existence check to decide whether to fall back to legacy "contracts-by-address"
	// heuristics (used when the derived holdings table is not populated yet).
	var one int
	err := r.db.QueryRow(ctx, `SELECT 1 FROM app.ft_holdings WHERE balance > 0 LIMIT 1`).Scan(&one)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (r *Repository) CountNFTCollectionSummariesByOwner(ctx context.Context, owner string) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT (contract_address, contract_name))
		FROM app.nft_ownership
		WHERE owner = $1`, hexToBytes(owner)).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) CountNFTOwnersByCollection(ctx context.Context, collection, contractName string) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT owner)
		FROM app.nft_ownership
		WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2)`,
		hexToBytes(collection), contractName).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

type EVMTransactionRecord struct {
	BlockHeight uint64
	EVMHash     string
	FromAddress string
	ToAddress   string
	Nonce       uint64
	GasLimit    uint64
	GasUsed     uint64
	GasPrice    string
	GasFeeCap   string
	GasTipCap   string
	Value       string
	TxType      int
	ChainID     string
	Position    int
	EventIndex  int
	StatusCode  int
	Status      string
	Timestamp   time.Time
}

func (r *Repository) GetFTHolding(ctx context.Context, address, contract, contractName string) (*models.FTHolding, error) {
	var h models.FTHolding
	if contractName == "" {
		err := r.db.QueryRow(ctx, `
			SELECT encode(address, 'hex') AS address, encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name,
			       balance::text, COALESCE(last_height,0), updated_at
			FROM app.ft_holdings
			WHERE address = $1 AND contract_address = $2`, hexToBytes(address), hexToBytes(contract)).
			Scan(&h.Address, &h.ContractAddress, &h.ContractName, &h.Balance, &h.LastHeight, &h.UpdatedAt)
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &h, nil
	}
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address, encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name,
		       balance::text, COALESCE(last_height,0), updated_at
		FROM app.ft_holdings
		WHERE address = $1 AND contract_address = $2 AND contract_name = $3`, hexToBytes(address), hexToBytes(contract), contractName).
		Scan(&h.Address, &h.ContractAddress, &h.ContractName, &h.Balance, &h.LastHeight, &h.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (r *Repository) ListFTTokenContracts(ctx context.Context, limit, offset int) ([]TokenContract, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex'), COALESCE(contract_name, '')
		FROM app.ft_tokens
		ORDER BY contract_address ASC, contract_name ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TokenContract
	for rows.Next() {
		var row TokenContract
		if err := rows.Scan(&row.Address, &row.Name); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) ListNFTCollectionContracts(ctx context.Context, limit, offset int) ([]TokenContract, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT
			encode(contract_address, 'hex') AS contract_address,
			COALESCE(contract_name, '') AS contract_name
		FROM app.nft_ownership
		WHERE contract_address IS NOT NULL
		ORDER BY contract_address ASC, contract_name ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TokenContract
	for rows.Next() {
		var row TokenContract
		if err := rows.Scan(&row.Address, &row.Name); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) ListNFTCollectionSummaries(ctx context.Context, limit, offset int) ([]NFTCollectionSummary, error) {
	rows, err := r.db.Query(ctx, `
		WITH counts AS (
			SELECT contract_address, contract_name, COUNT(*) AS cnt, COUNT(DISTINCT owner) AS holder_cnt
			FROM app.nft_ownership
			WHERE owner IS NOT NULL
			GROUP BY contract_address, contract_name
		)
		SELECT
			COALESCE(encode(COALESCE(c.contract_address, counts.contract_address), 'hex'), '') AS contract_address,
			COALESCE(COALESCE(c.contract_name, counts.contract_name), '') AS contract_name,
			COALESCE(c.name, '') AS name,
			COALESCE(c.symbol, '') AS symbol,
			COALESCE(c.description, '') AS description,
			COALESCE(c.external_url, '') AS external_url,
			COALESCE(c.square_image::text, '') AS square_image,
			COALESCE(c.banner_image::text, '') AS banner_image,
			COALESCE(c.socials::text, '') AS socials,
			COALESCE(counts.cnt, 0) AS cnt,
			COALESCE(counts.holder_cnt, 0) AS holder_cnt,
			COALESCE(c.evm_address, '') AS evm_address,
			COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_collections c
		FULL OUTER JOIN counts ON counts.contract_address = c.contract_address AND counts.contract_name = c.contract_name
		ORDER BY COALESCE(counts.holder_cnt, 0) DESC, contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NFTCollectionSummary
	for rows.Next() {
		var row NFTCollectionSummary
		if err := rows.Scan(&row.ContractAddress, &row.ContractName, &row.Name, &row.Symbol, &row.Description, &row.ExternalURL, &row.SquareImage, &row.BannerImage, &row.Socials, &row.Count, &row.HolderCount, &row.EVMAddress, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

// ListTrendingNFTCollections returns NFT collections ordered by recent transfer activity.
func (r *Repository) ListTrendingNFTCollections(ctx context.Context, limit, offset int) ([]NFTCollectionSummary, error) {
	rows, err := r.db.Query(ctx, `
		WITH counts AS (
			SELECT contract_address, contract_name, COUNT(*) AS cnt, COUNT(DISTINCT owner) AS holder_cnt
			FROM app.nft_ownership
			WHERE owner IS NOT NULL
			GROUP BY contract_address, contract_name
		),
		max_h AS (
			SELECT COALESCE(MAX(block_height), 0) AS h FROM app.nft_transfers
		),
		recent_activity AS (
			SELECT token_contract_address, contract_name, COUNT(*) AS tx_count
			FROM app.nft_transfers, max_h
			WHERE block_height >= max_h.h - 1000000
			GROUP BY token_contract_address, contract_name
		)
		SELECT
			COALESCE(encode(COALESCE(c.contract_address, counts.contract_address), 'hex'), '') AS contract_address,
			COALESCE(COALESCE(c.contract_name, counts.contract_name), '') AS contract_name,
			COALESCE(c.name, '') AS name,
			COALESCE(c.symbol, '') AS symbol,
			COALESCE(c.description, '') AS description,
			COALESCE(c.external_url, '') AS external_url,
			COALESCE(c.square_image::text, '') AS square_image,
			COALESCE(c.banner_image::text, '') AS banner_image,
			COALESCE(c.socials::text, '') AS socials,
			COALESCE(counts.cnt, 0) AS cnt,
			COALESCE(counts.holder_cnt, 0) AS holder_cnt,
			COALESCE(ra.tx_count, 0) AS transfer_count,
			COALESCE(c.evm_address, '') AS evm_address,
			COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_collections c
		FULL OUTER JOIN counts ON counts.contract_address = c.contract_address AND counts.contract_name = c.contract_name
		LEFT JOIN recent_activity ra ON ra.token_contract_address = COALESCE(c.contract_address, counts.contract_address) AND ra.contract_name = COALESCE(c.contract_name, counts.contract_name)
		ORDER BY COALESCE(ra.tx_count, 0) DESC, contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NFTCollectionSummary
	for rows.Next() {
		var row NFTCollectionSummary
		if err := rows.Scan(&row.ContractAddress, &row.ContractName, &row.Name, &row.Symbol, &row.Description, &row.ExternalURL, &row.SquareImage, &row.BannerImage, &row.Socials, &row.Count, &row.HolderCount, &row.TransferCount, &row.EVMAddress, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) GetNFTCollectionSummary(ctx context.Context, contract, contractName string) (*NFTCollectionSummary, error) {
	var row NFTCollectionSummary
	if contractName == "" {
		err := r.db.QueryRow(ctx, `
			WITH counts AS (
				SELECT contract_address, contract_name, COUNT(*) AS cnt
				FROM app.nft_ownership
				WHERE contract_address = $1
				GROUP BY contract_address, contract_name
			)
			SELECT
				COALESCE(encode(COALESCE(c.contract_address, counts.contract_address), 'hex'), '') AS contract_address,
				COALESCE(COALESCE(c.contract_name, counts.contract_name), '') AS contract_name,
				COALESCE(c.name, '') AS name,
				COALESCE(c.symbol, '') AS symbol,
				COALESCE(c.description, '') AS description,
				COALESCE(c.external_url, '') AS external_url,
				COALESCE(c.square_image::text, '') AS square_image,
				COALESCE(c.banner_image::text, '') AS banner_image,
				COALESCE(c.socials::text, '') AS socials,
				COALESCE(counts.cnt, 0) AS cnt,
				COALESCE(c.updated_at, NOW()) AS updated_at
			FROM app.nft_collections c
			FULL OUTER JOIN counts ON counts.contract_address = c.contract_address AND counts.contract_name = c.contract_name
			WHERE COALESCE(c.contract_address, counts.contract_address) = $1
			ORDER BY COALESCE(c.contract_name, counts.contract_name) ASC
			LIMIT 1`, hexToBytes(contract)).
			Scan(&row.ContractAddress, &row.ContractName, &row.Name, &row.Symbol, &row.Description, &row.ExternalURL, &row.SquareImage, &row.BannerImage, &row.Socials, &row.Count, &row.UpdatedAt)
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &row, nil
	}
	err := r.db.QueryRow(ctx, `
		WITH counts AS (
			SELECT contract_address, contract_name, COUNT(*) AS cnt
			FROM app.nft_ownership
			WHERE contract_address = $1 AND contract_name = $2
			GROUP BY contract_address, contract_name
		)
		SELECT
			COALESCE(encode(COALESCE(c.contract_address, counts.contract_address), 'hex'), '') AS contract_address,
			COALESCE(COALESCE(c.contract_name, counts.contract_name), '') AS contract_name,
			COALESCE(c.name, '') AS name,
			COALESCE(c.symbol, '') AS symbol,
			COALESCE(c.description, '') AS description,
			COALESCE(c.external_url, '') AS external_url,
			COALESCE(c.square_image::text, '') AS square_image,
			COALESCE(c.banner_image::text, '') AS banner_image,
			COALESCE(c.socials::text, '') AS socials,
			COALESCE(counts.cnt, 0) AS cnt,
			COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_collections c
		FULL OUTER JOIN counts ON counts.contract_address = c.contract_address AND counts.contract_name = c.contract_name
		WHERE COALESCE(c.contract_address, counts.contract_address) = $1 AND COALESCE(c.contract_name, counts.contract_name) = $2`,
		hexToBytes(contract), contractName).
		Scan(&row.ContractAddress, &row.ContractName, &row.Name, &row.Symbol, &row.Description, &row.ExternalURL, &row.SquareImage, &row.BannerImage, &row.Socials, &row.Count, &row.UpdatedAt)
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
			   COALESCE(o.contract_name,''), COALESCE(c.name,''), COALESCE(c.symbol,''),
			   COALESCE(c.description,''), COALESCE(c.external_url,''),
			   COALESCE(c.square_image::text, '') AS square_image,
			   COALESCE(c.banner_image::text, '') AS banner_image,
			   COALESCE(c.socials::text, '') AS socials,
			   COUNT(*) AS cnt,
			   COALESCE(c.updated_at, NOW()) AS updated_at
		FROM app.nft_ownership o
		LEFT JOIN app.nft_collections c ON c.contract_address = o.contract_address AND c.contract_name = o.contract_name
		WHERE o.owner = $1
		GROUP BY o.contract_address, o.contract_name, c.name, c.symbol, c.description, c.external_url, c.square_image, c.banner_image, c.socials, c.updated_at
		ORDER BY o.contract_address ASC, o.contract_name ASC
		LIMIT $2 OFFSET $3`, hexToBytes(owner), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NFTCollectionSummary
	for rows.Next() {
		var row NFTCollectionSummary
		if err := rows.Scan(&row.ContractAddress, &row.ContractName, &row.Name, &row.Symbol, &row.Description, &row.ExternalURL, &row.SquareImage, &row.BannerImage, &row.Socials, &row.Count, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) ListNFTOwnershipByOwnerAndCollection(ctx context.Context, owner, collection, contractName string, limit, offset int) ([]models.NFTOwnership, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name, nft_id,
		       COALESCE(encode(owner, 'hex'), '') AS owner, COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE owner = $1 AND contract_address = $2 AND ($3 = '' OR contract_name = $3)
		ORDER BY contract_name ASC, nft_id ASC
		LIMIT $4 OFFSET $5`, hexToBytes(owner), hexToBytes(collection), contractName, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.NFTOwnership
	for rows.Next() {
		var o models.NFTOwnership
		if err := rows.Scan(&o.ContractAddress, &o.ContractName, &o.NFTID, &o.Owner, &o.LastHeight, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

func (r *Repository) ListNFTOwnerCountsByCollection(ctx context.Context, collection, contractName string, limit, offset int) ([]NFTOwnerCount, bool, error) {
	// Fetch limit+1 rows to determine hasMore without a separate COUNT(*) query.
	fetchLimit := limit + 1
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE(encode(owner, 'hex'), '') AS owner, COUNT(*) AS cnt
		FROM app.nft_ownership
		WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2)
		GROUP BY owner
		ORDER BY cnt DESC
		LIMIT $3 OFFSET $4`, hexToBytes(collection), contractName, fetchLimit, offset)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []NFTOwnerCount
	for rows.Next() {
		var row NFTOwnerCount
		if err := rows.Scan(&row.Owner, &row.Count); err != nil {
			return nil, false, err
		}
		out = append(out, row)
	}

	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	return out, hasMore, nil
}

// CountNFTsByCollection returns the total number of NFTs in a collection (for percentage calculations).
func (r *Repository) CountNFTsByCollection(ctx context.Context, collection, contractName string) (int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM app.nft_ownership WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2)`, hexToBytes(collection), contractName).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) ListEVMTransactions(ctx context.Context, limit, offset int) ([]EVMTransactionRecord, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			block_height,
			COALESCE(encode(evm_hash, 'hex'), ''),
			COALESCE(encode(from_address, 'hex'), ''),
			COALESCE(encode(to_address, 'hex'), ''),
			COALESCE(nonce, 0),
			COALESCE(gas_limit, 0),
			COALESCE(gas_used, 0),
			COALESCE(gas_price::text, ''),
			COALESCE(gas_fee_cap::text, ''),
			COALESCE(gas_tip_cap::text, ''),
			COALESCE(value::text, ''),
			COALESCE(tx_type, 0),
			COALESCE(chain_id::text, ''),
			COALESCE(transaction_index, 0),
			COALESCE(event_index, 0),
			COALESCE(status_code, 0),
			COALESCE(status, ''),
			timestamp
		FROM app.evm_transactions
		ORDER BY block_height DESC, transaction_index DESC, event_index DESC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EVMTransactionRecord
	for rows.Next() {
		var row EVMTransactionRecord
		if err := rows.Scan(
			&row.BlockHeight,
			&row.EVMHash,
			&row.FromAddress,
			&row.ToAddress,
			&row.Nonce,
			&row.GasLimit,
			&row.GasUsed,
			&row.GasPrice,
			&row.GasFeeCap,
			&row.GasTipCap,
			&row.Value,
			&row.TxType,
			&row.ChainID,
			&row.Position,
			&row.EventIndex,
			&row.StatusCode,
			&row.Status,
			&row.Timestamp,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) GetEVMTransactionByHash(ctx context.Context, hash string) (*EVMTransactionRecord, error) {
	var row EVMTransactionRecord
	err := r.db.QueryRow(ctx, `
		SELECT
			block_height,
			COALESCE(encode(evm_hash, 'hex'), ''),
			COALESCE(encode(from_address, 'hex'), ''),
			COALESCE(encode(to_address, 'hex'), ''),
			COALESCE(nonce, 0),
			COALESCE(gas_limit, 0),
			COALESCE(gas_used, 0),
			COALESCE(gas_price::text, ''),
			COALESCE(gas_fee_cap::text, ''),
			COALESCE(gas_tip_cap::text, ''),
			COALESCE(value::text, ''),
			COALESCE(tx_type, 0),
			COALESCE(chain_id::text, ''),
			COALESCE(transaction_index, 0),
			COALESCE(event_index, 0),
			COALESCE(status_code, 0),
			COALESCE(status, ''),
			timestamp
		FROM app.evm_transactions
		WHERE evm_hash = $1
		ORDER BY block_height DESC, transaction_index DESC, event_index DESC
		LIMIT 1`, hexToBytes(hash)).Scan(
		&row.BlockHeight,
		&row.EVMHash,
		&row.FromAddress,
		&row.ToAddress,
		&row.Nonce,
		&row.GasLimit,
		&row.GasUsed,
		&row.GasPrice,
		&row.GasFeeCap,
		&row.GasTipCap,
		&row.Value,
		&row.TxType,
		&row.ChainID,
		&row.Position,
		&row.EventIndex,
		&row.StatusCode,
		&row.Status,
		&row.Timestamp,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Repository) GetEVMTransactionsByCadenceTx(ctx context.Context, txID string, blockHeight uint64) ([]EVMTransactionRecord, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			block_height,
			COALESCE(encode(evm_hash, 'hex'), ''),
			COALESCE(encode(from_address, 'hex'), ''),
			COALESCE(encode(to_address, 'hex'), ''),
			COALESCE(nonce, 0),
			COALESCE(gas_limit, 0),
			COALESCE(gas_used, 0),
			COALESCE(gas_price::text, ''),
			COALESCE(gas_fee_cap::text, ''),
			COALESCE(gas_tip_cap::text, ''),
			COALESCE(value::text, ''),
			COALESCE(tx_type, 0),
			COALESCE(chain_id::text, ''),
			COALESCE(transaction_index, 0),
			COALESCE(event_index, 0),
			COALESCE(status_code, 0),
			COALESCE(status, ''),
			timestamp
		FROM app.evm_transactions
		WHERE transaction_id = $1 AND block_height = $2
		ORDER BY event_index`, hexToBytes(txID), blockHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EVMTransactionRecord
	for rows.Next() {
		var row EVMTransactionRecord
		if err := rows.Scan(
			&row.BlockHeight,
			&row.EVMHash,
			&row.FromAddress,
			&row.ToAddress,
			&row.Nonce,
			&row.GasLimit,
			&row.GasUsed,
			&row.GasPrice,
			&row.GasFeeCap,
			&row.GasTipCap,
			&row.Value,
			&row.TxType,
			&row.ChainID,
			&row.Position,
			&row.EventIndex,
			&row.StatusCode,
			&row.Status,
			&row.Timestamp,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (r *Repository) ErrNotImplemented(msg string) error {
	return fmt.Errorf("not implemented: %s", msg)
}
