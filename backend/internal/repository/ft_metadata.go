package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type FTMetadataRow struct {
	ContractAddress string
	Name            string
	Symbol          string
	Decimals        int
}

// UpsertFTMetadata upserts into app.ft_metadata (address-keyed denormalized table).
// Note: this table does not include contract_name; if multiple FT contracts share the same address,
// the "last writer wins".
func (r *Repository) UpsertFTMetadata(ctx context.Context, rows []FTMetadataRow) error {
	if len(rows) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, row := range rows {
		batch.Queue(`
			INSERT INTO app.ft_metadata (contract_address, token_name, token_symbol, decimals)
			VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,0))
			ON CONFLICT (contract_address) DO UPDATE SET
				token_name = COALESCE(EXCLUDED.token_name, app.ft_metadata.token_name),
				token_symbol = COALESCE(EXCLUDED.token_symbol, app.ft_metadata.token_symbol),
				decimals = COALESCE(EXCLUDED.decimals, app.ft_metadata.decimals)`,
			hexToBytes(row.ContractAddress), row.Name, row.Symbol, row.Decimals,
		)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < len(rows); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert ft_metadata: %w", err)
		}
	}
	return nil
}

