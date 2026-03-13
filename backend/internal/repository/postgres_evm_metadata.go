package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// EVMContractRow represents a verified EVM contract to upsert.
type EVMContractRow struct {
	Address      []byte
	Name         string
	ABI          json.RawMessage
	SourceCode   string
	Compiler     string
	Language     string
	License      string
	Optimization bool
	ProxyType    string
	ImplAddress  []byte
	VerifiedAt   *time.Time
}

// EVMAddressLabelRow represents an EVM address label to upsert.
type EVMAddressLabelRow struct {
	Address     []byte
	Name        string
	Tags        []string
	IsContract  bool
	IsVerified  bool
	TokenName   string
	TokenSymbol string
}

// EVMContractMetadata is a read model for verified EVM contracts keyed by address hex.
type EVMContractMetadata struct {
	Address      string
	Name         string
	ABI          json.RawMessage
	SourceCode   string
	Compiler     string
	Language     string
	License      string
	Optimization bool
	ProxyType    string
	ImplAddress  string
	VerifiedAt   *time.Time
}

// EVMAddressLabelMetadata is a read model for Blockscout address labels keyed by address hex.
type EVMAddressLabelMetadata struct {
	Address     string
	Name        string
	Tags        []string
	IsContract  bool
	IsVerified  bool
	TokenName   string
	TokenSymbol string
	SyncedAt    *time.Time
}

// GetLatestEVMContractVerifiedAt returns the max verified_at from evm_contracts
// for incremental sync. Returns "" if no rows exist.
func (r *Repository) GetLatestEVMContractVerifiedAt(ctx context.Context) (string, error) {
	var result *time.Time
	err := r.db.QueryRow(ctx,
		`SELECT MAX(verified_at) FROM app.evm_contracts`,
	).Scan(&result)
	if err != nil || result == nil {
		return "", err
	}
	return result.Format(time.RFC3339Nano), nil
}

// GetEVMContractsByAddresses returns verified contract metadata keyed by address hex (no 0x prefix).
func (r *Repository) GetEVMContractsByAddresses(ctx context.Context, addresses []string) (map[string]EVMContractMetadata, error) {
	if len(addresses) == 0 {
		return map[string]EVMContractMetadata{}, nil
	}

	seen := make(map[string]struct{}, len(addresses))
	addrBytes := make([][]byte, 0, len(addresses))
	for _, addr := range addresses {
		if _, ok := seen[addr]; ok {
			continue
		}
		seen[addr] = struct{}{}
		if b := hexToBytes(addr); b != nil {
			addrBytes = append(addrBytes, b)
		}
	}
	if len(addrBytes) == 0 {
		return map[string]EVMContractMetadata{}, nil
	}

	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex'),
		       COALESCE(name, ''),
		       COALESCE(abi, 'null'::jsonb),
		       COALESCE(source_code, ''),
		       COALESCE(compiler, ''),
		       COALESCE(language, ''),
		       COALESCE(license, ''),
		       COALESCE(optimization, false),
		       COALESCE(proxy_type, ''),
		       COALESCE(encode(impl_address, 'hex'), ''),
		       verified_at
		FROM app.evm_contracts
		WHERE address = ANY($1)`, addrBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]EVMContractMetadata, len(addrBytes))
	for rows.Next() {
		var row EVMContractMetadata
		if err := rows.Scan(
			&row.Address,
			&row.Name,
			&row.ABI,
			&row.SourceCode,
			&row.Compiler,
			&row.Language,
			&row.License,
			&row.Optimization,
			&row.ProxyType,
			&row.ImplAddress,
			&row.VerifiedAt,
		); err != nil {
			return nil, err
		}
		out[row.Address] = row
	}
	return out, rows.Err()
}

// GetEVMAddressLabelsByAddresses returns Blockscout address metadata keyed by address hex (no 0x prefix).
func (r *Repository) GetEVMAddressLabelsByAddresses(ctx context.Context, addresses []string) (map[string]EVMAddressLabelMetadata, error) {
	if len(addresses) == 0 {
		return map[string]EVMAddressLabelMetadata{}, nil
	}

	seen := make(map[string]struct{}, len(addresses))
	addrBytes := make([][]byte, 0, len(addresses))
	for _, addr := range addresses {
		if _, ok := seen[addr]; ok {
			continue
		}
		seen[addr] = struct{}{}
		if b := hexToBytes(addr); b != nil {
			addrBytes = append(addrBytes, b)
		}
	}
	if len(addrBytes) == 0 {
		return map[string]EVMAddressLabelMetadata{}, nil
	}

	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex'),
		       COALESCE(name, ''),
		       COALESCE(tags, ARRAY[]::text[]),
		       COALESCE(is_contract, false),
		       COALESCE(is_verified, false),
		       COALESCE(token_name, ''),
		       COALESCE(token_symbol, ''),
		       synced_at
		FROM app.evm_address_labels
		WHERE address = ANY($1)`, addrBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]EVMAddressLabelMetadata, len(addrBytes))
	for rows.Next() {
		var row EVMAddressLabelMetadata
		if err := rows.Scan(
			&row.Address,
			&row.Name,
			&row.Tags,
			&row.IsContract,
			&row.IsVerified,
			&row.TokenName,
			&row.TokenSymbol,
			&row.SyncedAt,
		); err != nil {
			return nil, err
		}
		out[row.Address] = row
	}
	return out, rows.Err()
}

// UpsertEVMContracts bulk-upserts verified contract metadata.
func (r *Repository) UpsertEVMContracts(ctx context.Context, rows []EVMContractRow) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, row := range rows {
		_, err := tx.Exec(ctx, `
			INSERT INTO app.evm_contracts
				(address, name, abi, source_code, compiler, language, license, optimization, proxy_type, impl_address, verified_at, synced_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
			ON CONFLICT (address) DO UPDATE SET
				name = EXCLUDED.name,
				abi = EXCLUDED.abi,
				source_code = EXCLUDED.source_code,
				compiler = EXCLUDED.compiler,
				language = EXCLUDED.language,
				license = EXCLUDED.license,
				optimization = EXCLUDED.optimization,
				proxy_type = EXCLUDED.proxy_type,
				impl_address = EXCLUDED.impl_address,
				verified_at = EXCLUDED.verified_at,
				synced_at = NOW()`,
			row.Address, row.Name, row.ABI, row.SourceCode,
			row.Compiler, row.Language, row.License, row.Optimization,
			row.ProxyType, row.ImplAddress, row.VerifiedAt,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// GetUnlabeledEVMAddresses returns EVM addresses from evm_transactions that
// are not yet in evm_address_labels (or are stale > 7 days). Limited to `limit` rows.
func (r *Repository) GetUnlabeledEVMAddresses(ctx context.Context, limit int) ([][]byte, error) {
	rows, err := r.db.Query(ctx, `
		WITH addrs AS (
			SELECT DISTINCT addr FROM (
				SELECT from_address AS addr FROM app.evm_transactions WHERE from_address IS NOT NULL
				UNION
				SELECT to_address AS addr FROM app.evm_transactions WHERE to_address IS NOT NULL
			) sub
			WHERE addr != '\x0000000000000000000000000000000000000000'::bytea
		)
		SELECT a.addr
		FROM addrs a
		LEFT JOIN app.evm_address_labels l ON l.address = a.addr
		WHERE l.address IS NULL
		   OR l.synced_at < NOW() - INTERVAL '7 days'
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) ([]byte, error) {
		var addr []byte
		err := row.Scan(&addr)
		return addr, err
	})
}

// UpsertEVMAddressLabels bulk-upserts address label metadata.
func (r *Repository) UpsertEVMAddressLabels(ctx context.Context, rows []EVMAddressLabelRow) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, row := range rows {
		_, err := tx.Exec(ctx, `
			INSERT INTO app.evm_address_labels
				(address, name, tags, is_contract, is_verified, token_name, token_symbol, synced_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
			ON CONFLICT (address) DO UPDATE SET
				name = EXCLUDED.name,
				tags = EXCLUDED.tags,
				is_contract = EXCLUDED.is_contract,
				is_verified = EXCLUDED.is_verified,
				token_name = EXCLUDED.token_name,
				token_symbol = EXCLUDED.token_symbol,
				synced_at = NOW()`,
			row.Address, row.Name, row.Tags, row.IsContract,
			row.IsVerified, row.TokenName, row.TokenSymbol,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
