package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// --- Accounts catalog ---

func (r *Repository) UpsertAccounts(ctx context.Context, accounts []models.AccountCatalog) error {
	if len(accounts) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, a := range accounts {
		batch.Queue(`
			INSERT INTO app.accounts (address, first_seen_height, last_seen_height, created_at, updated_at)
			VALUES ($1, $2, $3, NOW(), NOW())
			ON CONFLICT (address) DO UPDATE SET
				first_seen_height = LEAST(app.accounts.first_seen_height, EXCLUDED.first_seen_height),
				last_seen_height = GREATEST(app.accounts.last_seen_height, EXCLUDED.last_seen_height),
				updated_at = NOW()`,
			a.Address, a.FirstSeenHeight, a.LastSeenHeight)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < len(accounts); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert accounts: %w", err)
		}
	}
	return nil
}

func (r *Repository) ListAccounts(ctx context.Context, limit, offset int) ([]models.AccountCatalog, error) {
	rows, err := r.db.Query(ctx, `
		SELECT address, COALESCE(first_seen_height, 0), COALESCE(last_seen_height, 0), created_at, updated_at
		FROM app.accounts
		ORDER BY last_seen_height DESC NULLS LAST, address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.AccountCatalog
	for rows.Next() {
		var a models.AccountCatalog
		if err := rows.Scan(&a.Address, &a.FirstSeenHeight, &a.LastSeenHeight, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// --- FT metadata/holdings ---

func (r *Repository) UpsertFTTokens(ctx context.Context, tokens []models.FTToken) error {
	if len(tokens) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, t := range tokens {
		batch.Queue(`
			INSERT INTO app.ft_tokens (contract_address, name, symbol, decimals, updated_at)
			VALUES ($1, $2, $3, $4, NOW())
			ON CONFLICT (contract_address) DO UPDATE SET
				name = COALESCE(EXCLUDED.name, app.ft_tokens.name),
				symbol = COALESCE(EXCLUDED.symbol, app.ft_tokens.symbol),
				decimals = COALESCE(EXCLUDED.decimals, app.ft_tokens.decimals),
				updated_at = NOW()`,
			t.ContractAddress, t.Name, t.Symbol, t.Decimals)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < len(tokens); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert ft tokens: %w", err)
		}
	}
	return nil
}

func (r *Repository) UpsertFTHoldingsDelta(ctx context.Context, address, contract string, delta string, height uint64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.ft_holdings (address, contract_address, balance, last_height, updated_at)
		VALUES ($1, $2, $3::numeric, $4, NOW())
		ON CONFLICT (address, contract_address) DO UPDATE SET
			balance = app.ft_holdings.balance + EXCLUDED.balance,
			last_height = GREATEST(app.ft_holdings.last_height, EXCLUDED.last_height),
			updated_at = NOW()`,
		address, contract, delta, height)
	return err
}

func (r *Repository) ListFTHoldingsByAddress(ctx context.Context, address string, limit, offset int) ([]models.FTHolding, error) {
	rows, err := r.db.Query(ctx, `
		SELECT address, contract_address, balance::text, COALESCE(last_height,0), updated_at
		FROM app.ft_holdings
		WHERE address = $1
		ORDER BY contract_address ASC
		LIMIT $2 OFFSET $3`, address, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTHolding
	for rows.Next() {
		var h models.FTHolding
		if err := rows.Scan(&h.Address, &h.ContractAddress, &h.Balance, &h.LastHeight, &h.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, nil
}

func (r *Repository) ListFTHoldingsByToken(ctx context.Context, contract string, limit, offset int) ([]models.FTHolding, error) {
	rows, err := r.db.Query(ctx, `
		SELECT address, contract_address, balance::text, COALESCE(last_height,0), updated_at
		FROM app.ft_holdings
		WHERE contract_address = $1
		ORDER BY balance DESC
		LIMIT $2 OFFSET $3`, contract, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTHolding
	for rows.Next() {
		var h models.FTHolding
		if err := rows.Scan(&h.Address, &h.ContractAddress, &h.Balance, &h.LastHeight, &h.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, nil
}

func (r *Repository) ListFTTokens(ctx context.Context, limit, offset int) ([]models.FTToken, error) {
	rows, err := r.db.Query(ctx, `
		SELECT contract_address, COALESCE(name,''), COALESCE(symbol,''), COALESCE(decimals,0), updated_at
		FROM app.ft_tokens
		ORDER BY contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTToken
	for rows.Next() {
		var t models.FTToken
		if err := rows.Scan(&t.ContractAddress, &t.Name, &t.Symbol, &t.Decimals, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (r *Repository) GetFTToken(ctx context.Context, contract string) (*models.FTToken, error) {
	var t models.FTToken
	err := r.db.QueryRow(ctx, `
		SELECT contract_address, COALESCE(name,''), COALESCE(symbol,''), COALESCE(decimals,0), updated_at
		FROM app.ft_tokens
		WHERE contract_address = $1`, contract).Scan(&t.ContractAddress, &t.Name, &t.Symbol, &t.Decimals, &t.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// --- NFT collections/ownership ---

func (r *Repository) UpsertNFTCollections(ctx context.Context, collections []models.NFTCollection) error {
	if len(collections) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, c := range collections {
		batch.Queue(`
			INSERT INTO app.nft_collections (contract_address, name, symbol, updated_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT (contract_address) DO UPDATE SET
				name = COALESCE(EXCLUDED.name, app.nft_collections.name),
				symbol = COALESCE(EXCLUDED.symbol, app.nft_collections.symbol),
				updated_at = NOW()`,
			c.ContractAddress, c.Name, c.Symbol)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < len(collections); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert nft collections: %w", err)
		}
	}
	return nil
}

func (r *Repository) UpsertNFTOwnership(ctx context.Context, ownership models.NFTOwnership) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.nft_ownership (contract_address, nft_id, owner, last_height, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (contract_address, nft_id) DO UPDATE SET
			owner = EXCLUDED.owner,
			last_height = GREATEST(app.nft_ownership.last_height, EXCLUDED.last_height),
			updated_at = NOW()`,
		ownership.ContractAddress, ownership.NFTID, nullIfEmpty(ownership.Owner), ownership.LastHeight)
	return err
}

func (r *Repository) ListNFTOwnershipByAddress(ctx context.Context, address string, limit, offset int) ([]models.NFTOwnership, error) {
	rows, err := r.db.Query(ctx, `
		SELECT contract_address, nft_id, COALESCE(owner,''), COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE owner = $1
		ORDER BY contract_address ASC, nft_id ASC
		LIMIT $2 OFFSET $3`, address, limit, offset)
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

func (r *Repository) ListNFTOwnershipByCollection(ctx context.Context, collection string, limit, offset int) ([]models.NFTOwnership, error) {
	rows, err := r.db.Query(ctx, `
		SELECT contract_address, nft_id, COALESCE(owner,''), COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE contract_address = $1
		ORDER BY nft_id ASC
		LIMIT $2 OFFSET $3`, collection, limit, offset)
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

func (r *Repository) GetNFTOwnership(ctx context.Context, collection, nftID string) (*models.NFTOwnership, error) {
	var o models.NFTOwnership
	err := r.db.QueryRow(ctx, `
		SELECT contract_address, nft_id, COALESCE(owner,''), COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE contract_address = $1 AND nft_id = $2`, collection, nftID).Scan(&o.ContractAddress, &o.NFTID, &o.Owner, &o.LastHeight, &o.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *Repository) ListNFTCollections(ctx context.Context, limit, offset int) ([]models.NFTCollection, error) {
	rows, err := r.db.Query(ctx, `
		SELECT contract_address, COALESCE(name,''), COALESCE(symbol,''), updated_at
		FROM app.nft_collections
		ORDER BY contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.NFTCollection
	for rows.Next() {
		var c models.NFTCollection
		if err := rows.Scan(&c.ContractAddress, &c.Name, &c.Symbol, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (r *Repository) GetNFTCollection(ctx context.Context, contract string) (*models.NFTCollection, error) {
	var c models.NFTCollection
	err := r.db.QueryRow(ctx, `
		SELECT contract_address, COALESCE(name,''), COALESCE(symbol,''), updated_at
		FROM app.nft_collections
		WHERE contract_address = $1`, contract).Scan(&c.ContractAddress, &c.Name, &c.Symbol, &c.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// Contracts
func (r *Repository) ListContracts(ctx context.Context, address string, limit, offset int) ([]models.SmartContract, error) {
	clauses := []string{}
	args := []interface{}{}
	arg := 1
	if address != "" {
		clauses = append(clauses, fmt.Sprintf("address = $%d", arg))
		args = append(args, address)
		arg++
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, `
		SELECT address, name, COALESCE(code,''), COALESCE(version,1), COALESCE(last_updated_height,0), created_at, updated_at
		FROM app.smart_contracts
		`+where+`
		ORDER BY address ASC, name ASC
		LIMIT $`+fmt.Sprint(arg)+` OFFSET $`+fmt.Sprint(arg+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.SmartContract
	for rows.Next() {
		var c models.SmartContract
		if err := rows.Scan(&c.Address, &c.Name, &c.Code, &c.Version, &c.BlockHeight, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (r *Repository) GetContractByIdentifier(ctx context.Context, identifier string) ([]models.SmartContract, error) {
	identifier = strings.ToLower(strings.TrimSpace(identifier))
	if identifier == "" {
		return nil, nil
	}
	parts := strings.Split(identifier, ".")
	address := ""
	name := ""
	if len(parts) >= 3 && strings.HasPrefix(parts[0], "a") {
		address = parts[1]
		name = parts[2]
	} else if len(parts) == 2 {
		address = parts[0]
		name = parts[1]
	}
	if address == "" {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT address, name, COALESCE(code,''), COALESCE(version,1), COALESCE(last_updated_height,0), created_at, updated_at
		FROM app.smart_contracts
		WHERE address = $1 AND ($2 = '' OR name = $2)`, address, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.SmartContract
	for rows.Next() {
		var c models.SmartContract
		if err := rows.Scan(&c.Address, &c.Name, &c.Code, &c.Version, &c.BlockHeight, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// --- Tx contracts/tags ---

func (r *Repository) UpsertTxContracts(ctx context.Context, rows []models.TxContract) error {
	if len(rows) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, row := range rows {
		batch.Queue(`
			INSERT INTO app.tx_contracts (transaction_id, contract_identifier, source)
			VALUES ($1, $2, $3)
			ON CONFLICT (transaction_id, contract_identifier) DO UPDATE SET
				source = EXCLUDED.source`,
			row.TransactionID, row.ContractIdentifier, row.Source)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < len(rows); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert tx contracts: %w", err)
		}
	}
	return nil
}

func (r *Repository) UpsertTxTags(ctx context.Context, rows []models.TxTag) error {
	if len(rows) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, row := range rows {
		batch.Queue(`
			INSERT INTO app.tx_tags (transaction_id, tag)
			VALUES ($1, $2)
			ON CONFLICT (transaction_id, tag) DO NOTHING`,
			row.TransactionID, row.Tag)
	}
	br := r.db.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < len(rows); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert tx tags: %w", err)
		}
	}
	return nil
}

func (r *Repository) GetTxContractsByTransactionIDs(ctx context.Context, txIDs []string) (map[string][]string, error) {
	if len(txIDs) == 0 {
		return map[string][]string{}, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT transaction_id, contract_identifier
		FROM app.tx_contracts
		WHERE transaction_id = ANY($1)`, txIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]string)
	for rows.Next() {
		var txID, contract string
		if err := rows.Scan(&txID, &contract); err != nil {
			return nil, err
		}
		out[txID] = append(out[txID], contract)
	}
	return out, nil
}

func (r *Repository) GetTxTagsByTransactionIDs(ctx context.Context, txIDs []string) (map[string][]string, error) {
	if len(txIDs) == 0 {
		return map[string][]string{}, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT transaction_id, tag
		FROM app.tx_tags
		WHERE transaction_id = ANY($1)`, txIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]string)
	for rows.Next() {
		var txID, tag string
		if err := rows.Scan(&txID, &tag); err != nil {
			return nil, err
		}
		out[txID] = append(out[txID], tag)
	}
	return out, nil
}

// --- Status snapshots ---

func (r *Repository) UpsertStatusSnapshot(ctx context.Context, kind string, payload []byte, asOf time.Time) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.status_snapshots (kind, payload, as_of)
		VALUES ($1, $2::jsonb, $3)
		ON CONFLICT (kind) DO UPDATE SET
			payload = EXCLUDED.payload,
			as_of = EXCLUDED.as_of`,
		kind, string(payload), asOf)
	return err
}

func (r *Repository) GetStatusSnapshot(ctx context.Context, kind string) (*models.StatusSnapshot, error) {
	var snap models.StatusSnapshot
	err := r.db.QueryRow(ctx, `
		SELECT kind, payload::text, as_of
		FROM app.status_snapshots
		WHERE kind = $1`, kind).Scan(&snap.Kind, &snap.Payload, &snap.AsOf)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &snap, nil
}

// --- Utility ---

func nullIfEmpty(v string) interface{} {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}
