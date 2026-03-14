package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// LookupCadenceTxByEVMHash finds the parent Cadence transaction ID for a given EVM hash.
// Returns the hex-encoded transaction_id or empty string if not found.
func (r *Repository) LookupCadenceTxByEVMHash(ctx context.Context, evmHash string) (string, error) {
	var txID string
	err := r.db.QueryRow(ctx,
		`SELECT encode(transaction_id, 'hex') FROM app.evm_tx_hashes WHERE evm_hash = $1 LIMIT 1`,
		hexToBytes(evmHash),
	).Scan(&txID)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return txID, nil
}

// LookupEVMHashByCadenceTx finds the EVM hash(es) for a given Cadence transaction ID.
// Returns the first hex-encoded evm_hash or empty string if not found.
func (r *Repository) LookupEVMHashByCadenceTx(ctx context.Context, cadenceTxID string) (string, error) {
	var evmHash string
	err := r.db.QueryRow(ctx,
		`SELECT encode(evm_hash, 'hex') FROM app.evm_tx_hashes WHERE transaction_id = $1 LIMIT 1`,
		hexToBytes(cadenceTxID),
	).Scan(&evmHash)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return evmHash, nil
}

// GetAddressContractCount returns the number of smart contracts deployed at an address.
func (r *Repository) GetAddressContractCount(ctx context.Context, address string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM app.smart_contracts WHERE address = $1`,
		hexToBytes(address),
	).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetAddressHasActiveKeys checks if the address has at least one non-revoked key.
func (r *Repository) GetAddressHasActiveKeys(ctx context.Context, address string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM app.account_keys WHERE address = $1 AND revoked = false)`,
		hexToBytes(address),
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
