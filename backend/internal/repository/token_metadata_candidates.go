package repository

import (
	"context"
	"fmt"

	"flowscan-clone/internal/models"
)

// ListContractsByKindInRange returns contracts from app.contracts whose first_seen_height
// falls within [fromHeight, toHeight]. This is useful for "new contract discovered" workflows.
func (r *Repository) ListContractsByKindInRange(ctx context.Context, kind string, fromHeight, toHeight uint64, limit int) ([]models.Contract, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, encode(address, 'hex') AS address, name,
		       COALESCE(kind,''), COALESCE(first_seen_height,0), COALESCE(last_seen_height,0)
		FROM app.contracts
		WHERE kind = $1 AND first_seen_height >= $2 AND first_seen_height <= $3
		ORDER BY first_seen_height ASC, id ASC
		LIMIT $4`, kind, int64(fromHeight), int64(toHeight), limit)
	if err != nil {
		return nil, fmt.Errorf("list contracts by kind/range: %w", err)
	}
	defer rows.Close()
	var out []models.Contract
	for rows.Next() {
		var c models.Contract
		if err := rows.Scan(&c.ID, &c.Address, &c.Name, &c.Kind, &c.FirstSeenHeight, &c.LastSeenHeight); err != nil {
			return nil, fmt.Errorf("scan contracts by kind/range: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) ListFTTokensMissingMetadata(ctx context.Context, limit int) ([]models.FTToken, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address,
		       COALESCE(contract_name,'') AS contract_name
		FROM app.ft_tokens
		WHERE COALESCE(name,'') = '' OR COALESCE(symbol,'') = '' OR decimals IS NULL OR decimals = 0
		ORDER BY updated_at ASC, contract_address ASC, contract_name ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list ft tokens missing metadata: %w", err)
	}
	defer rows.Close()
	var out []models.FTToken
	for rows.Next() {
		var t models.FTToken
		if err := rows.Scan(&t.ContractAddress, &t.ContractName); err != nil {
			return nil, fmt.Errorf("scan ft tokens missing metadata: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repository) ListNFTCollectionsMissingMetadata(ctx context.Context, limit int) ([]models.NFTCollection, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address,
		       COALESCE(contract_name,'') AS contract_name
		FROM app.nft_collections
		WHERE COALESCE(name,'') = ''
		ORDER BY updated_at ASC, contract_address ASC, contract_name ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list nft collections missing metadata: %w", err)
	}
	defer rows.Close()
	var out []models.NFTCollection
	for rows.Next() {
		var c models.NFTCollection
		if err := rows.Scan(&c.ContractAddress, &c.ContractName); err != nil {
			return nil, fmt.Errorf("scan nft collections missing metadata: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

