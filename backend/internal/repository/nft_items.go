package repository

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// OwnerCollectionPair represents a distinct (owner, contract_address, contract_name) tuple
// from nft_ownership that needs NFT item metadata fetching.
type OwnerCollectionPair struct {
	Owner           string
	ContractAddress string
	ContractName    string
}

// UpsertNFTItems batch-upserts NFT item metadata and auto-generates search_tsv.
func (r *Repository) UpsertNFTItems(ctx context.Context, items []models.NFTItem) error {
	if len(items) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, item := range items {
		batch.Queue(`
			INSERT INTO app.nft_items (
				contract_address, contract_name, nft_id,
				name, description, thumbnail, external_url,
				serial_number, edition_name, edition_number, edition_max,
				rarity_score, rarity_description, traits,
				metadata_error, retries, refetch_after,
				updated_at, search_tsv
			) VALUES (
				$1, $2, $3,
				$4, $5, $6, $7,
				$8, $9, $10, $11,
				$12, $13, $14,
				NULL, 0, NULL,
				NOW(),
				to_tsvector('simple', coalesce($4,'') || ' ' || coalesce($5,'') || ' ' || $3)
			)
			ON CONFLICT (contract_address, contract_name, nft_id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				thumbnail = EXCLUDED.thumbnail,
				external_url = EXCLUDED.external_url,
				serial_number = EXCLUDED.serial_number,
				edition_name = EXCLUDED.edition_name,
				edition_number = EXCLUDED.edition_number,
				edition_max = EXCLUDED.edition_max,
				rarity_score = EXCLUDED.rarity_score,
				rarity_description = EXCLUDED.rarity_description,
				traits = EXCLUDED.traits,
				metadata_error = NULL,
				retries = 0,
				refetch_after = NULL,
				updated_at = NOW(),
				search_tsv = EXCLUDED.search_tsv`,
			hexToBytes(item.ContractAddress), item.ContractName, item.NFTID,
			nullIfEmpty(item.Name), nullIfEmpty(item.Description), nullIfEmpty(item.Thumbnail), nullIfEmpty(item.ExternalURL),
			item.SerialNumber, nullIfEmpty(item.EditionName), item.EditionNumber, item.EditionMax,
			nullIfEmpty(item.RarityScore), nullIfEmpty(item.RarityDescription), nullIfEmptyJSON([]byte(item.Traits)),
		)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for range items {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert nft_items: %w", err)
		}
	}
	return nil
}

// MarkNFTItemsError marks NFT items as failed with exponential backoff for refetch_after.
func (r *Repository) MarkNFTItemsError(ctx context.Context, contractAddr, contractName string, nftIDs []string, errMsg string, retries int) error {
	if len(nftIDs) == 0 {
		return nil
	}
	// Exponential backoff: 100s * 2^retries, capped at 7 days
	backoffSec := 100.0 * math.Pow(2, float64(retries))
	maxSec := 7 * 24 * 3600.0
	if backoffSec > maxSec {
		backoffSec = maxSec
	}
	refetchAfter := time.Now().Add(time.Duration(backoffSec) * time.Second)

	batch := &pgx.Batch{}
	for _, nftID := range nftIDs {
		batch.Queue(`
			INSERT INTO app.nft_items (contract_address, contract_name, nft_id, metadata_error, retries, refetch_after, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
			ON CONFLICT (contract_address, contract_name, nft_id) DO UPDATE SET
				metadata_error = EXCLUDED.metadata_error,
				retries = EXCLUDED.retries,
				refetch_after = EXCLUDED.refetch_after,
				updated_at = NOW()`,
			hexToBytes(contractAddr), contractName, nftID, errMsg, retries+1, refetchAfter)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for range nftIDs {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("mark nft_items error: %w", err)
		}
	}
	return nil
}

// ListOwnerCollectionsNeedingMetadata returns distinct (owner, contract_address, contract_name)
// pairs from nft_ownership that either have no nft_items row or have NULL name and are eligible for refetch.
func (r *Repository) ListOwnerCollectionsNeedingMetadata(ctx context.Context, limit int) ([]OwnerCollectionPair, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT ON (o.owner, o.contract_address, o.contract_name)
			encode(o.owner, 'hex'), encode(o.contract_address, 'hex'), o.contract_name
		FROM app.nft_ownership o
		WHERE o.owner IS NOT NULL
		  AND EXISTS (
			SELECT 1 FROM app.nft_ownership o2
			WHERE o2.owner = o.owner
			  AND o2.contract_address = o.contract_address
			  AND o2.contract_name = o.contract_name
			  AND NOT EXISTS (
				SELECT 1 FROM app.nft_items i
				WHERE i.contract_address = o2.contract_address
				  AND i.contract_name = o2.contract_name
				  AND i.nft_id = o2.nft_id
				  AND (i.name IS NOT NULL OR (i.refetch_after IS NOT NULL AND i.refetch_after > NOW()))
			)
		  )
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OwnerCollectionPair
	for rows.Next() {
		var p OwnerCollectionPair
		if err := rows.Scan(&p.Owner, &p.ContractAddress, &p.ContractName); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ListNFTIDsForOwnerCollection returns NFT IDs owned by this owner in this collection
// that still need metadata (no nft_items row, or name IS NULL and refetch eligible).
func (r *Repository) ListNFTIDsForOwnerCollection(ctx context.Context, owner, contractAddr, contractName string) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT o.nft_id
		FROM app.nft_ownership o
		LEFT JOIN app.nft_items i
		  ON i.contract_address = o.contract_address
		  AND i.contract_name = o.contract_name
		  AND i.nft_id = o.nft_id
		WHERE o.owner = $1
		  AND o.contract_address = $2
		  AND o.contract_name = $3
		  AND (i.nft_id IS NULL OR (i.name IS NULL AND (i.refetch_after IS NULL OR i.refetch_after <= NOW())))
		ORDER BY o.nft_id
		LIMIT 500`,
		hexToBytes(owner), hexToBytes(contractAddr), contractName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetCollectionPublicPath returns the cached public_path for an NFT collection.
func (r *Repository) GetCollectionPublicPath(ctx context.Context, contractAddr, contractName string) (string, error) {
	var path *string
	err := r.db.QueryRow(ctx, `
		SELECT public_path FROM app.nft_collections
		WHERE contract_address = $1 AND contract_name = $2`,
		hexToBytes(contractAddr), contractName).Scan(&path)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if path == nil {
		return "", nil
	}
	return *path, nil
}

// UpdateCollectionPublicPath caches the public_path for an NFT collection.
func (r *Repository) UpdateCollectionPublicPath(ctx context.Context, contractAddr, contractName, path string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE app.nft_collections SET public_path = $3, updated_at = NOW()
		WHERE contract_address = $1 AND contract_name = $2`,
		hexToBytes(contractAddr), contractName, path)
	return err
}

// ListNFTItems returns paginated NFT items for a collection.
func (r *Repository) ListNFTItems(ctx context.Context, contractAddr, contractName string, limit, offset int) ([]models.NFTItem, bool, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex'), COALESCE(contract_name, ''), nft_id,
			COALESCE(name, ''), COALESCE(description, ''), COALESCE(thumbnail, ''), COALESCE(external_url, ''),
			serial_number, COALESCE(edition_name, ''), edition_number, edition_max,
			COALESCE(rarity_score, ''), COALESCE(rarity_description, ''), traits,
			updated_at
		FROM app.nft_items
		WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2)
		  AND name IS NOT NULL
		ORDER BY nft_id ASC
		LIMIT $3 OFFSET $4`,
		hexToBytes(contractAddr), contractName, limit+1, offset)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []models.NFTItem
	for rows.Next() {
		var item models.NFTItem
		if err := rows.Scan(
			&item.ContractAddress, &item.ContractName, &item.NFTID,
			&item.Name, &item.Description, &item.Thumbnail, &item.ExternalURL,
			&item.SerialNumber, &item.EditionName, &item.EditionNumber, &item.EditionMax,
			&item.RarityScore, &item.RarityDescription, &item.Traits,
			&item.UpdatedAt,
		); err != nil {
			return nil, false, err
		}
		out = append(out, item)
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	return out, hasMore, nil
}

// GetNFTItem returns a single NFT item by collection + nft_id.
func (r *Repository) GetNFTItem(ctx context.Context, contractAddr, contractName, nftID string) (*models.NFTItem, error) {
	var item models.NFTItem
	err := r.db.QueryRow(ctx, `
		SELECT encode(contract_address, 'hex'), COALESCE(contract_name, ''), nft_id,
			COALESCE(name, ''), COALESCE(description, ''), COALESCE(thumbnail, ''), COALESCE(external_url, ''),
			serial_number, COALESCE(edition_name, ''), edition_number, edition_max,
			COALESCE(rarity_score, ''), COALESCE(rarity_description, ''), traits,
			updated_at
		FROM app.nft_items
		WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2) AND nft_id = $3`,
		hexToBytes(contractAddr), contractName, nftID).
		Scan(
			&item.ContractAddress, &item.ContractName, &item.NFTID,
			&item.Name, &item.Description, &item.Thumbnail, &item.ExternalURL,
			&item.SerialNumber, &item.EditionName, &item.EditionNumber, &item.EditionMax,
			&item.RarityScore, &item.RarityDescription, &item.Traits,
			&item.UpdatedAt,
		)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// SearchNFTItems performs full-text search on NFT items.
// Optional contractAddr/contractName filter scopes to a specific collection.
func (r *Repository) SearchNFTItems(ctx context.Context, query, contractAddr, contractName string, limit, offset int) ([]models.NFTItem, bool, error) {
	if strings.TrimSpace(query) == "" {
		return nil, false, nil
	}
	var args []interface{}
	args = append(args, query) // $1

	where := "search_tsv @@ plainto_tsquery('simple', $1) AND name IS NOT NULL"
	argIdx := 2
	if contractAddr != "" {
		where += fmt.Sprintf(" AND contract_address = $%d", argIdx)
		args = append(args, hexToBytes(contractAddr))
		argIdx++
		if contractName != "" {
			where += fmt.Sprintf(" AND contract_name = $%d", argIdx)
			args = append(args, contractName)
			argIdx++
		}
	}

	args = append(args, limit+1, offset)
	sql := fmt.Sprintf(`
		SELECT encode(contract_address, 'hex'), COALESCE(contract_name, ''), nft_id,
			COALESCE(name, ''), COALESCE(description, ''), COALESCE(thumbnail, ''), COALESCE(external_url, ''),
			serial_number, COALESCE(edition_name, ''), edition_number, edition_max,
			COALESCE(rarity_score, ''), COALESCE(rarity_description, ''), traits,
			updated_at
		FROM app.nft_items
		WHERE %s
		ORDER BY ts_rank(search_tsv, plainto_tsquery('simple', $1)) DESC, nft_id ASC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []models.NFTItem
	for rows.Next() {
		var item models.NFTItem
		if err := rows.Scan(
			&item.ContractAddress, &item.ContractName, &item.NFTID,
			&item.Name, &item.Description, &item.Thumbnail, &item.ExternalURL,
			&item.SerialNumber, &item.EditionName, &item.EditionNumber, &item.EditionMax,
			&item.RarityScore, &item.RarityDescription, &item.Traits,
			&item.UpdatedAt,
		); err != nil {
			return nil, false, err
		}
		out = append(out, item)
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	return out, hasMore, nil
}

// --- Reconciliation methods ---

// OwnerCollectionCount represents a (owner, collection) pair with its DB-side NFT count.
type OwnerCollectionCount struct {
	Owner           string
	ContractAddress string
	ContractName    string
	Count           int
}

// ListTopOwnerCollections returns the largest (owner, collection) pairs by NFT count.
func (r *Repository) ListTopOwnerCollections(ctx context.Context, limit int) ([]OwnerCollectionCount, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(owner, 'hex'), encode(contract_address, 'hex'), COALESCE(contract_name, ''), COUNT(*) AS cnt
		FROM app.nft_ownership
		WHERE owner IS NOT NULL
		GROUP BY owner, contract_address, contract_name
		ORDER BY cnt DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OwnerCollectionCount
	for rows.Next() {
		var o OwnerCollectionCount
		if err := rows.Scan(&o.Owner, &o.ContractAddress, &o.ContractName, &o.Count); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

// ListNFTIDsByOwnerCollection returns all NFT IDs we think this owner has in this collection.
func (r *Repository) ListNFTIDsByOwnerCollection(ctx context.Context, owner, contractAddr, contractName string) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT nft_id FROM app.nft_ownership
		WHERE owner = $1 AND contract_address = $2 AND contract_name = $3
		ORDER BY nft_id`,
		hexToBytes(owner), hexToBytes(contractAddr), contractName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// DeleteNFTOwnershipBatch removes stale ownership records in batch.
func (r *Repository) DeleteNFTOwnershipBatch(ctx context.Context, contractAddr, contractName string, nftIDs []string) (int64, error) {
	if len(nftIDs) == 0 {
		return 0, nil
	}
	tag, err := r.db.Exec(ctx, `
		DELETE FROM app.nft_ownership
		WHERE contract_address = $1 AND contract_name = $2 AND nft_id = ANY($3)`,
		hexToBytes(contractAddr), contractName, nftIDs)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
