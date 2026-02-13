package repository

import (
	"context"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

func (r *Repository) UpsertCOAAccounts(ctx context.Context, rows []models.COAAccount) error {
	if len(rows) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, row := range rows {
		batch.Queue(`
			INSERT INTO app.coa_accounts (coa_address, flow_address, transaction_id, block_height, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			ON CONFLICT (coa_address) DO UPDATE SET
				flow_address = EXCLUDED.flow_address,
				transaction_id = COALESCE(EXCLUDED.transaction_id, app.coa_accounts.transaction_id),
				block_height = COALESCE(EXCLUDED.block_height, app.coa_accounts.block_height),
				updated_at = NOW()`,
			hexToBytes(row.COAAddress), hexToBytes(row.FlowAddress), hexToBytes(row.TransactionID), row.BlockHeight,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	return br.Close()
}

func (r *Repository) GetFlowAddressByCOA(ctx context.Context, coa string) (*models.COAAccount, error) {
	var out models.COAAccount
	err := r.db.QueryRow(ctx, `
		SELECT encode(coa_address, 'hex') AS coa_address,
		       encode(flow_address, 'hex') AS flow_address,
		       COALESCE(encode(transaction_id, 'hex'), '') AS transaction_id,
		       COALESCE(block_height,0), created_at, updated_at
		FROM app.coa_accounts
		WHERE coa_address = $1`, hexToBytes(coa)).Scan(
		&out.COAAddress, &out.FlowAddress, &out.TransactionID, &out.BlockHeight, &out.CreatedAt, &out.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// CheckAddressesAreCOA checks which of the given addresses (hex) are COA addresses.
// Returns a map of address -> flow_address for those that are COAs.
func (r *Repository) CheckAddressesAreCOA(ctx context.Context, addresses []string) (map[string]string, error) {
	if len(addresses) == 0 {
		return map[string]string{}, nil
	}
	addrBytes := make([][]byte, 0, len(addresses))
	for _, a := range addresses {
		b := hexToBytes(a)
		if b != nil {
			addrBytes = append(addrBytes, b)
		}
	}
	if len(addrBytes) == 0 {
		return map[string]string{}, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(coa_address, 'hex'), encode(flow_address, 'hex')
		FROM app.coa_accounts
		WHERE coa_address = ANY($1)`, addrBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var coa, flow string
		if err := rows.Scan(&coa, &flow); err != nil {
			return nil, err
		}
		result[coa] = flow
	}
	return result, rows.Err()
}

func (r *Repository) GetCOAByFlowAddress(ctx context.Context, flowAddress string) (*models.COAAccount, error) {
	var out models.COAAccount
	err := r.db.QueryRow(ctx, `
		SELECT encode(coa_address, 'hex') AS coa_address,
		       encode(flow_address, 'hex') AS flow_address,
		       COALESCE(encode(transaction_id, 'hex'), '') AS transaction_id,
		       COALESCE(block_height,0), created_at, updated_at
		FROM app.coa_accounts
		WHERE flow_address = $1
		ORDER BY updated_at DESC
		LIMIT 1`, hexToBytes(flowAddress)).Scan(
		&out.COAAddress, &out.FlowAddress, &out.TransactionID, &out.BlockHeight, &out.CreatedAt, &out.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}
