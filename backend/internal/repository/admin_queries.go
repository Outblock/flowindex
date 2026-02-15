package repository

import (
	"context"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"
)

// AdminListFTTokens returns all FT tokens with optional search.
func (r *Repository) AdminListFTTokens(ctx context.Context, search string, limit, offset int, verified ...string) ([]models.FTToken, error) {
	query := `
		SELECT encode(contract_address, 'hex'), contract_name,
		       COALESCE(name, ''), COALESCE(symbol, ''), COALESCE(decimals, 0),
		       COALESCE(description, ''), COALESCE(external_url, ''), COALESCE(logo, ''),
		       COALESCE(is_verified, false),
		       updated_at
		FROM app.ft_tokens`
	args := []interface{}{}
	argN := 1
	clauses := []string{}

	if search != "" {
		clauses = append(clauses, fmt.Sprintf(`(name ILIKE $%d OR symbol ILIKE $%d OR contract_name ILIKE $%d)`, argN, argN, argN))
		args = append(args, "%"+search+"%")
		argN++
	}
	if len(verified) > 0 && verified[0] != "" {
		clauses = append(clauses, fmt.Sprintf(`COALESCE(is_verified, false) = $%d`, argN))
		args = append(args, verified[0] == "true")
		argN++
	}
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	query += ` ORDER BY updated_at DESC`
	query += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.FTToken
	for rows.Next() {
		var t models.FTToken
		if err := rows.Scan(&t.ContractAddress, &t.ContractName,
			&t.Name, &t.Symbol, &t.Decimals,
			&t.Description, &t.ExternalURL, &t.Logo,
			&t.IsVerified,
			&t.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

// AdminUpdateFTToken updates specific fields of a FT token.
func (r *Repository) AdminUpdateFTToken(ctx context.Context, address, name string, updates map[string]interface{}) error {
	allowed := map[string]string{
		"name":         "name",
		"symbol":       "symbol",
		"logo":         "logo",
		"description":  "description",
		"external_url": "external_url",
		"decimals":     "decimals",
		"is_verified":  "is_verified",
	}

	setClauses := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argN := 1

	for key, val := range updates {
		col, ok := allowed[key]
		if !ok {
			continue
		}
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", col, argN))
		args = append(args, val)
		argN++
	}

	args = append(args, hexToBytes(address), name)
	query := fmt.Sprintf(`UPDATE app.ft_tokens SET %s WHERE contract_address = $%d AND contract_name = $%d`,
		strings.Join(setClauses, ", "), argN, argN+1)

	_, err := r.db.Exec(ctx, query, args...)
	return err
}

// AdminListNFTCollections returns all NFT collections with optional search.
func (r *Repository) AdminListNFTCollections(ctx context.Context, search string, limit, offset int, verified ...string) ([]models.NFTCollection, error) {
	query := `
		SELECT encode(contract_address, 'hex'), contract_name,
		       COALESCE(name, ''), COALESCE(symbol, ''), COALESCE(description, ''),
		       COALESCE(external_url, ''), COALESCE(square_image, ''), COALESCE(banner_image, ''),
		       COALESCE(is_verified, false),
		       updated_at
		FROM app.nft_collections`
	args := []interface{}{}
	argN := 1
	clauses := []string{}

	if search != "" {
		clauses = append(clauses, fmt.Sprintf(`(name ILIKE $%d OR symbol ILIKE $%d OR contract_name ILIKE $%d)`, argN, argN, argN))
		args = append(args, "%"+search+"%")
		argN++
	}
	if len(verified) > 0 && verified[0] != "" {
		clauses = append(clauses, fmt.Sprintf(`COALESCE(is_verified, false) = $%d`, argN))
		args = append(args, verified[0] == "true")
		argN++
	}
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	query += ` ORDER BY updated_at DESC`
	query += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.NFTCollection
	for rows.Next() {
		var c models.NFTCollection
		if err := rows.Scan(&c.ContractAddress, &c.ContractName,
			&c.Name, &c.Symbol, &c.Description,
			&c.ExternalURL, &c.SquareImage, &c.BannerImage,
			&c.IsVerified,
			&c.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// AdminUpdateNFTCollection updates specific fields of an NFT collection.
func (r *Repository) AdminUpdateNFTCollection(ctx context.Context, address, name string, updates map[string]interface{}) error {
	allowed := map[string]string{
		"name":         "name",
		"symbol":       "symbol",
		"square_image": "square_image",
		"banner_image": "banner_image",
		"description":  "description",
		"external_url": "external_url",
		"is_verified":  "is_verified",
	}

	setClauses := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argN := 1

	for key, val := range updates {
		col, ok := allowed[key]
		if !ok {
			continue
		}
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", col, argN))
		args = append(args, val)
		argN++
	}

	args = append(args, hexToBytes(address), name)
	query := fmt.Sprintf(`UPDATE app.nft_collections SET %s WHERE contract_address = $%d AND contract_name = $%d`,
		strings.Join(setClauses, ", "), argN, argN+1)

	_, err := r.db.Exec(ctx, query, args...)
	return err
}
