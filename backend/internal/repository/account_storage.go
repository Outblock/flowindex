package repository

import "context"

type AccountStorageSnapshot struct {
	Address           string
	StorageUsed       uint64
	StorageCapacity   uint64
	StorageAvailable  uint64
}

func (r *Repository) GetAccountStorageSnapshot(ctx context.Context, address string) (*AccountStorageSnapshot, error) {
	row := r.db.QueryRow(ctx, `
		SELECT address, storage_used, storage_capacity, storage_available
		FROM app.account_storage_snapshots
		WHERE address = $1`, address)
	var s AccountStorageSnapshot
	if err := row.Scan(&s.Address, &s.StorageUsed, &s.StorageCapacity, &s.StorageAvailable); err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *Repository) UpsertAccountStorageSnapshot(ctx context.Context, address string, used, capacity, available uint64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.account_storage_snapshots (address, storage_used, storage_capacity, storage_available, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (address) DO UPDATE SET
			storage_used = EXCLUDED.storage_used,
			storage_capacity = EXCLUDED.storage_capacity,
			storage_available = EXCLUDED.storage_available,
			updated_at = NOW()`,
		address, used, capacity, available)
	return err
}
