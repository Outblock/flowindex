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
			hexToBytes(a.Address), a.FirstSeenHeight, a.LastSeenHeight)
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

type AccountListRow struct {
	Address          string
	FirstSeenHeight  uint64
	LastSeenHeight   uint64
	CreatedAt        time.Time
	UpdatedAt        time.Time
	StorageUsed      uint64
	StorageCapacity  uint64
	StorageAvailable uint64
}

func (r *Repository) GetAccountCatalog(ctx context.Context, address string) (*models.AccountCatalog, error) {
	var a models.AccountCatalog
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address,
		       COALESCE(first_seen_height, 0),
		       COALESCE(last_seen_height, 0),
		       created_at, updated_at
		FROM app.accounts
		WHERE address = $1`, hexToBytes(address)).Scan(
		&a.Address, &a.FirstSeenHeight, &a.LastSeenHeight, &a.CreatedAt, &a.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repository) ListAccountsForAPI(ctx context.Context, cursorHeight *uint64, limit, offset int) ([]AccountListRow, error) {
	var cursor interface{}
	if cursorHeight != nil {
		cursor = int64(*cursorHeight)
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(a.address, 'hex') AS address,
		       COALESCE(a.first_seen_height, 0),
		       COALESCE(a.last_seen_height, 0),
		       a.created_at, a.updated_at,
		       COALESCE(s.storage_used, 0),
		       COALESCE(s.storage_capacity, 0),
		       COALESCE(s.storage_available, 0)
		FROM app.accounts a
		LEFT JOIN app.account_storage_snapshots s ON s.address = a.address
		WHERE a.address <> $4
		  AND ($1::bigint IS NULL OR COALESCE(a.last_seen_height, 0) <= $1)
		ORDER BY COALESCE(a.last_seen_height, 0) DESC NULLS LAST, a.address ASC
		LIMIT $2 OFFSET $3`, cursor, limit, offset, hexToBytes(systemFlowAddressHex))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccountListRow
	for rows.Next() {
		var a AccountListRow
		if err := rows.Scan(&a.Address, &a.FirstSeenHeight, &a.LastSeenHeight, &a.CreatedAt, &a.UpdatedAt, &a.StorageUsed, &a.StorageCapacity, &a.StorageAvailable); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) ListAccounts(ctx context.Context, limit, offset int) ([]models.AccountCatalog, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex') AS address, COALESCE(first_seen_height, 0), COALESCE(last_seen_height, 0), created_at, updated_at
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
			INSERT INTO app.ft_tokens (contract_address, contract_name, name, symbol, decimals,
				description, external_url, logo, vault_path, receiver_path, balance_path, socials, evm_address, updated_at)
			VALUES ($1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,0),
				NULLIF($6,''), NULLIF($7,''), $8, NULLIF($9,''), NULLIF($10,''), NULLIF($11,''), $12, NULLIF($13,''), NOW())
			ON CONFLICT (contract_address, contract_name) DO UPDATE SET
				name = COALESCE(EXCLUDED.name, app.ft_tokens.name),
				symbol = COALESCE(EXCLUDED.symbol, app.ft_tokens.symbol),
				decimals = COALESCE(EXCLUDED.decimals, app.ft_tokens.decimals),
				description = COALESCE(EXCLUDED.description, app.ft_tokens.description),
				external_url = COALESCE(EXCLUDED.external_url, app.ft_tokens.external_url),
				logo = COALESCE(EXCLUDED.logo, app.ft_tokens.logo),
				vault_path = COALESCE(EXCLUDED.vault_path, app.ft_tokens.vault_path),
				receiver_path = COALESCE(EXCLUDED.receiver_path, app.ft_tokens.receiver_path),
				balance_path = COALESCE(EXCLUDED.balance_path, app.ft_tokens.balance_path),
				socials = COALESCE(EXCLUDED.socials, app.ft_tokens.socials),
				evm_address = COALESCE(EXCLUDED.evm_address, app.ft_tokens.evm_address),
				updated_at = NOW()`,
			hexToBytes(t.ContractAddress), t.ContractName, t.Name, t.Symbol, t.Decimals,
			t.Description, t.ExternalURL, nullIfEmpty(t.Logo), t.VaultPath, t.ReceiverPath, t.BalancePath, nullIfEmptyJSON(t.Socials), t.EVMAddress)
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

func (r *Repository) UpsertFTHoldingsDelta(ctx context.Context, address, contract, contractName string, delta string, height uint64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.ft_holdings (address, contract_address, contract_name, balance, last_height, updated_at)
		-- If we start indexing mid-history, some accounts will only have outgoing transfers within the indexed range.
		-- In that case the true balance is "unknown >= 0"; clamp to 0 to avoid confusing negative balances in the UI.
		VALUES ($1, $2, $3, GREATEST($4::numeric, 0), $5, NOW())
		ON CONFLICT (address, contract_address, contract_name) DO UPDATE SET
			balance = GREATEST(app.ft_holdings.balance + EXCLUDED.balance, 0),
			last_height = GREATEST(app.ft_holdings.last_height, EXCLUDED.last_height),
			updated_at = NOW()`,
		hexToBytes(address), hexToBytes(contract), contractName, delta, height)
	return err
}

func (r *Repository) UpsertDailyBalanceDelta(ctx context.Context, address, contract, contractName, date, delta string, height uint64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.daily_balance_deltas (address, contract_address, contract_name, date, delta, tx_count, last_height)
		VALUES ($1, $2, $3, $4::date, $5::numeric, 1, $6)
		ON CONFLICT (address, contract_address, contract_name, date) DO UPDATE SET
			delta = app.daily_balance_deltas.delta + EXCLUDED.delta,
			tx_count = app.daily_balance_deltas.tx_count + 1,
			last_height = GREATEST(app.daily_balance_deltas.last_height, EXCLUDED.last_height)`,
		hexToBytes(address), hexToBytes(contract), contractName, date, delta, height)
	return err
}

type BalanceHistoryPoint struct {
	Date    string `json:"date"`
	Balance string `json:"balance"`
}

func (r *Repository) GetBalanceHistory(ctx context.Context, address, contract, contractName, currentBalance, fromDate, toDate string) ([]BalanceHistoryPoint, error) {
	rows, err := r.db.Query(ctx, `
		WITH dates AS (
			SELECT d::date AS date FROM generate_series($1::date, $2::date, '1 day') d
		), deltas AS (
			SELECT date, delta
			FROM app.daily_balance_deltas
			WHERE address=$3 AND contract_address=$4 AND contract_name=$5
			  AND date >= $1::date AND date <= $2::date
		), filled AS (
			SELECT dates.date, COALESCE(deltas.delta, 0) AS delta
			FROM dates LEFT JOIN deltas USING(date)
		)
		SELECT date::text,
			($6::numeric - COALESCE(SUM(delta) OVER (ORDER BY date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))::text AS balance
		FROM filled ORDER BY date ASC`,
		fromDate, toDate, hexToBytes(address), hexToBytes(contract), contractName, currentBalance)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []BalanceHistoryPoint
	for rows.Next() {
		var p BalanceHistoryPoint
		if err := rows.Scan(&p.Date, &p.Balance); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

func (r *Repository) ListFTHoldingsByAddress(ctx context.Context, address string, limit, offset int) ([]models.FTHolding, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex') AS address, encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name,
		       balance::text, COALESCE(last_height,0), updated_at
		FROM app.ft_holdings
		WHERE address = $1
		  AND balance > 0
		ORDER BY contract_address ASC, contract_name ASC
		LIMIT $2 OFFSET $3`, hexToBytes(address), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTHolding
	for rows.Next() {
		var h models.FTHolding
		if err := rows.Scan(&h.Address, &h.ContractAddress, &h.ContractName, &h.Balance, &h.LastHeight, &h.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, nil
}

func (r *Repository) ListFTHoldingsByToken(ctx context.Context, contract, contractName string, limit, offset int) ([]models.FTHolding, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex') AS address, encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name,
		       balance::text, COALESCE(last_height,0), updated_at
		FROM app.ft_holdings
		WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2)
		  AND balance > 0
		ORDER BY balance DESC, contract_name ASC
		LIMIT $3 OFFSET $4`, hexToBytes(contract), contractName, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTHolding
	for rows.Next() {
		var h models.FTHolding
		if err := rows.Scan(&h.Address, &h.ContractAddress, &h.ContractName, &h.Balance, &h.LastHeight, &h.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, nil
}

func (r *Repository) ListFTTokens(ctx context.Context, limit, offset int) ([]models.FTToken, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+ftTokenSelectCols+`, COALESCE(h.holder_count, 0)
		FROM app.ft_tokens ft
		LEFT JOIN (
			SELECT contract_address, contract_name, COUNT(*) AS holder_count
			FROM app.ft_holdings WHERE balance > 0
			GROUP BY contract_address, contract_name
		) h ON h.contract_address = ft.contract_address AND h.contract_name = ft.contract_name
		ORDER BY COALESCE(h.holder_count, 0) DESC, ft.contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTToken
	for rows.Next() {
		t, err := scanFTTokenWithHolders(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

const ftTokenSelectCols = `encode(ft.contract_address, 'hex') AS contract_address, COALESCE(ft.contract_name,''), COALESCE(ft.name,''), COALESCE(ft.symbol,''), COALESCE(ft.decimals,0),
		       COALESCE(ft.description,''), COALESCE(ft.external_url,''), COALESCE(ft.logo::text, ''), COALESCE(ft.vault_path,''), COALESCE(ft.receiver_path,''), COALESCE(ft.balance_path,''), COALESCE(ft.socials::text, ''), COALESCE(ft.evm_address, ''), ft.updated_at`

func scanFTToken(scan func(dest ...interface{}) error) (models.FTToken, error) {
	var t models.FTToken
	err := scan(&t.ContractAddress, &t.ContractName, &t.Name, &t.Symbol, &t.Decimals,
		&t.Description, &t.ExternalURL, &t.Logo, &t.VaultPath, &t.ReceiverPath, &t.BalancePath, &t.Socials, &t.EVMAddress, &t.UpdatedAt)
	return t, err
}

func scanFTTokenWithHolders(scan func(dest ...interface{}) error) (models.FTToken, error) {
	var t models.FTToken
	err := scan(&t.ContractAddress, &t.ContractName, &t.Name, &t.Symbol, &t.Decimals,
		&t.Description, &t.ExternalURL, &t.Logo, &t.VaultPath, &t.ReceiverPath, &t.BalancePath, &t.Socials, &t.EVMAddress, &t.UpdatedAt, &t.HolderCount)
	return t, err
}

func scanFTTokenTrending(scan func(dest ...interface{}) error) (models.FTToken, error) {
	var t models.FTToken
	err := scan(&t.ContractAddress, &t.ContractName, &t.Name, &t.Symbol, &t.Decimals,
		&t.Description, &t.ExternalURL, &t.Logo, &t.VaultPath, &t.ReceiverPath, &t.BalancePath, &t.Socials, &t.EVMAddress, &t.UpdatedAt, &t.HolderCount, &t.TransferCount)
	return t, err
}

// ListTrendingFTTokens returns FT tokens ordered by recent transfer activity.
// It counts transfers in the most recent 1M blocks (~2 days on Flow).
func (r *Repository) ListTrendingFTTokens(ctx context.Context, limit, offset int) ([]models.FTToken, error) {
	rows, err := r.db.Query(ctx, `
		WITH max_h AS (
			SELECT COALESCE(MAX(block_height), 0) AS h FROM app.ft_transfers
		),
		recent_activity AS (
			SELECT token_contract_address, contract_name, COUNT(*) AS tx_count
			FROM app.ft_transfers, max_h
			WHERE block_height >= max_h.h - 1000000
			GROUP BY token_contract_address, contract_name
		),
		holders AS (
			SELECT contract_address, contract_name, COUNT(*) AS holder_count
			FROM app.ft_holdings WHERE balance > 0
			GROUP BY contract_address, contract_name
		)
		SELECT `+ftTokenSelectCols+`, COALESCE(h.holder_count, 0), COALESCE(ra.tx_count, 0)
		FROM app.ft_tokens ft
		LEFT JOIN holders h ON h.contract_address = ft.contract_address AND h.contract_name = ft.contract_name
		LEFT JOIN recent_activity ra ON ra.token_contract_address = ft.contract_address AND ra.contract_name = ft.contract_name
		ORDER BY COALESCE(ra.tx_count, 0) DESC, ft.contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.FTToken
	for rows.Next() {
		t, err := scanFTTokenTrending(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (r *Repository) GetFTToken(ctx context.Context, contract, contractName string) (*models.FTToken, error) {
	if contractName == "" {
		t, err := scanFTToken(r.db.QueryRow(ctx, `
			SELECT `+ftTokenSelectCols+`
			FROM app.ft_tokens ft
			WHERE ft.contract_address = $1`, hexToBytes(contract)).Scan)
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &t, nil
	}
	t, err := scanFTToken(r.db.QueryRow(ctx, `
		SELECT `+ftTokenSelectCols+`
		FROM app.ft_tokens ft
		WHERE ft.contract_address = $1 AND ft.contract_name = $2`, hexToBytes(contract), contractName).Scan)
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
			INSERT INTO app.nft_collections (contract_address, contract_name, name, symbol, description, external_url, square_image, banner_image, socials, evm_address, updated_at)
			VALUES ($1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''), $9, NULLIF($10,''), NOW())
			ON CONFLICT (contract_address, contract_name) DO UPDATE SET
				name = COALESCE(EXCLUDED.name, app.nft_collections.name),
				symbol = COALESCE(EXCLUDED.symbol, app.nft_collections.symbol),
				description = COALESCE(EXCLUDED.description, app.nft_collections.description),
				external_url = COALESCE(EXCLUDED.external_url, app.nft_collections.external_url),
				square_image = COALESCE(EXCLUDED.square_image, app.nft_collections.square_image),
				banner_image = COALESCE(EXCLUDED.banner_image, app.nft_collections.banner_image),
				socials = COALESCE(EXCLUDED.socials, app.nft_collections.socials),
				evm_address = COALESCE(EXCLUDED.evm_address, app.nft_collections.evm_address),
				updated_at = NOW()`,
			hexToBytes(c.ContractAddress), c.ContractName, c.Name, c.Symbol, c.Description, c.ExternalURL,
			c.SquareImage, c.BannerImage, nullIfEmptyJSON(c.Socials), c.EVMAddress)
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

func nullIfEmptyJSON(b []byte) []byte {
	if len(b) == 0 {
		return nil
	}
	s := strings.TrimSpace(string(b))
	if s == "" || s == "null" {
		return nil
	}
	return b
}

func (r *Repository) UpsertNFTOwnership(ctx context.Context, ownership models.NFTOwnership) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.nft_ownership (contract_address, contract_name, nft_id, owner, last_height, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (contract_address, contract_name, nft_id) DO UPDATE SET
			owner = EXCLUDED.owner,
			last_height = EXCLUDED.last_height,
			updated_at = NOW()
		WHERE EXCLUDED.last_height >= app.nft_ownership.last_height`,
		hexToBytes(ownership.ContractAddress), ownership.ContractName, ownership.NFTID, nullIfEmptyBytes(hexToBytes(ownership.Owner)), ownership.LastHeight)
	return err
}

func (r *Repository) ListNFTOwnershipByAddress(ctx context.Context, address string, limit, offset int) ([]models.NFTOwnership, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name, nft_id,
		       COALESCE(encode(owner, 'hex'), '') AS owner, COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE owner = $1
		ORDER BY contract_address ASC, contract_name ASC, nft_id ASC
		LIMIT $2 OFFSET $3`, hexToBytes(address), limit, offset)
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

func (r *Repository) ListNFTOwnershipByCollection(ctx context.Context, collection string, limit, offset int) ([]models.NFTOwnership, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name, nft_id,
		       COALESCE(encode(owner, 'hex'), '') AS owner,
		       COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE contract_address = $1
		ORDER BY contract_name ASC, nft_id ASC
		LIMIT $2 OFFSET $3`, hexToBytes(collection), limit, offset)
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

func (r *Repository) GetNFTOwnership(ctx context.Context, collection, contractName, nftID string) (*models.NFTOwnership, error) {
	var o models.NFTOwnership
	err := r.db.QueryRow(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name, '') AS contract_name, nft_id,
		       COALESCE(encode(owner, 'hex'), '') AS owner,
		       COALESCE(last_height,0), updated_at
		FROM app.nft_ownership
		WHERE contract_address = $1 AND nft_id = $2 AND ($3 = '' OR contract_name = $3)`,
		hexToBytes(collection), nftID, contractName).
		Scan(&o.ContractAddress, &o.ContractName, &o.NFTID, &o.Owner, &o.LastHeight, &o.UpdatedAt)
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
		SELECT encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name,''), COALESCE(name,''), COALESCE(symbol,''), updated_at
		FROM app.nft_collections
		ORDER BY contract_address ASC, contract_name ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.NFTCollection
	for rows.Next() {
		var c models.NFTCollection
		if err := rows.Scan(&c.ContractAddress, &c.ContractName, &c.Name, &c.Symbol, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (r *Repository) GetNFTCollection(ctx context.Context, contract, contractName string) (*models.NFTCollection, error) {
	var c models.NFTCollection
	err := r.db.QueryRow(ctx, `
		SELECT encode(contract_address, 'hex') AS contract_address, COALESCE(contract_name,''), COALESCE(name,''), COALESCE(symbol,''), updated_at
		FROM app.nft_collections
		WHERE contract_address = $1 AND ($2 = '' OR contract_name = $2)`,
		hexToBytes(contract), contractName).
		Scan(&c.ContractAddress, &c.ContractName, &c.Name, &c.Symbol, &c.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// Contracts
type ContractListFilter struct {
	Address   string
	Name      string
	Body      string
	ValidFrom *uint64
	Sort      string
	SortOrder string
	Limit     int
	Offset    int
}

func (r *Repository) ListContractsFiltered(ctx context.Context, f ContractListFilter) ([]models.SmartContract, error) {
	clauses := []string{}
	args := []interface{}{}
	arg := 1

	if f.Address != "" {
		clauses = append(clauses, fmt.Sprintf("address = $%d", arg))
		args = append(args, hexToBytes(f.Address))
		arg++
	}
	if f.Name != "" {
		clauses = append(clauses, fmt.Sprintf("name = $%d", arg))
		args = append(args, f.Name)
		arg++
	}
	if f.Body != "" {
		clauses = append(clauses, fmt.Sprintf("code ILIKE $%d", arg))
		args = append(args, "%"+f.Body+"%")
		arg++
	}
	if f.ValidFrom != nil {
		clauses = append(clauses, fmt.Sprintf("COALESCE(last_updated_height,0) <= $%d", arg))
		args = append(args, int64(*f.ValidFrom))
		arg++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	sort := strings.ToLower(strings.TrimSpace(f.Sort))
	sortOrder := strings.ToLower(strings.TrimSpace(f.SortOrder))
	dir := "DESC"
	if sortOrder == "asc" {
		dir = "ASC"
	}

	orderBy := "COALESCE(last_updated_height,0) DESC, address ASC, name ASC"
	switch sort {
	case "", "valid_from", "activity":
		orderBy = "COALESCE(last_updated_height,0) " + dir + ", address ASC, name ASC"
	case "created_at":
		orderBy = "created_at " + dir + ", address ASC, name ASC"
	case "updated_at":
		orderBy = "updated_at " + dir + ", address ASC, name ASC"
	case "address":
		orderBy = "address " + dir + ", name ASC"
	case "name":
		orderBy = "name " + dir + ", address ASC"
	case "usage", "import":
		// Not modeled yet; approximate with activity.
		orderBy = "COALESCE(last_updated_height,0) " + dir + ", address ASC, name ASC"
	}

	args = append(args, f.Limit, f.Offset)
	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex') AS address, name, COALESCE(code,''), COALESCE(version,1), COALESCE(last_updated_height,0), created_at, updated_at
		FROM app.smart_contracts
		`+where+`
		ORDER BY `+orderBy+`
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
	return out, rows.Err()
}

func (r *Repository) ListContracts(ctx context.Context, address string, limit, offset int) ([]models.SmartContract, error) {
	return r.ListContractsFiltered(ctx, ContractListFilter{
		Address: address,
		Limit:   limit,
		Offset:  offset,
	})
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
		SELECT encode(address, 'hex') AS address, name, COALESCE(code,''), COALESCE(version,1), COALESCE(last_updated_height,0), created_at, updated_at
		FROM app.smart_contracts
		WHERE address = $1 AND ($2 = '' OR name = $2)
		ORDER BY address ASC, name ASC`, hexToBytes(address), name)
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
	return out, rows.Err()
}

func (r *Repository) IterateContracts(ctx context.Context, cursorHeight *uint64, fn func(models.SmartContract) error) error {
	var cursor interface{}
	if cursorHeight != nil {
		cursor = int64(*cursorHeight)
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex') AS address, name, COALESCE(code,''), COALESCE(version,1), COALESCE(last_updated_height,0), created_at, updated_at
		FROM app.smart_contracts
		WHERE ($1::bigint IS NULL OR COALESCE(last_updated_height,0) <= $1)
		ORDER BY address ASC, name ASC`, cursor)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var c models.SmartContract
		if err := rows.Scan(&c.Address, &c.Name, &c.Code, &c.Version, &c.BlockHeight, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return err
		}
		if err := fn(c); err != nil {
			return err
		}
	}
	return rows.Err()
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
			hexToBytes(row.TransactionID), row.ContractIdentifier, row.Source)
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
			hexToBytes(row.TransactionID), row.Tag)
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
		SELECT encode(transaction_id, 'hex') AS transaction_id, contract_identifier
		FROM app.tx_contracts
		WHERE transaction_id = ANY($1)`, sliceHexToBytes(txIDs))
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
		SELECT encode(transaction_id, 'hex') AS transaction_id, tag
		FROM app.tx_tags
		WHERE transaction_id = ANY($1)`, sliceHexToBytes(txIDs))
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

// --- Contract Versions ---

// InsertContractVersion inserts a new contract version, auto-incrementing the version number.
func (r *Repository) InsertContractVersion(ctx context.Context, address, name, code string, blockHeight uint64, transactionID string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.contract_versions (address, name, version, code, block_height, transaction_id)
		SELECT $1, $2,
		       COALESCE(MAX(version), 0) + 1,
		       $3, $4, $5
		FROM app.contract_versions
		WHERE address = $1 AND name = $2
		ON CONFLICT (address, name, version) DO NOTHING`,
		hexToBytes(address), name, code, blockHeight, hexToBytesOrNull(transactionID))
	return err
}

// ListContractVersions returns version metadata (without code) for a contract.
func (r *Repository) ListContractVersions(ctx context.Context, address, name string, limit, offset int) ([]models.ContractVersion, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(address, 'hex') AS address, name, version, block_height,
		       COALESCE(encode(transaction_id, 'hex'), '') AS transaction_id,
		       created_at
		FROM app.contract_versions
		WHERE address = $1 AND name = $2
		ORDER BY version DESC
		LIMIT $3 OFFSET $4`, hexToBytes(address), name, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ContractVersion
	for rows.Next() {
		var v models.ContractVersion
		if err := rows.Scan(&v.Address, &v.Name, &v.Version, &v.BlockHeight, &v.TransactionID, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// GetContractVersion returns a specific version with code.
func (r *Repository) GetContractVersion(ctx context.Context, address, name string, version int) (*models.ContractVersion, error) {
	var v models.ContractVersion
	err := r.db.QueryRow(ctx, `
		SELECT encode(address, 'hex') AS address, name, version, COALESCE(code, '') AS code, block_height,
		       COALESCE(encode(transaction_id, 'hex'), '') AS transaction_id,
		       created_at
		FROM app.contract_versions
		WHERE address = $1 AND name = $2 AND version = $3`,
		hexToBytes(address), name, version).Scan(
		&v.Address, &v.Name, &v.Version, &v.Code, &v.BlockHeight, &v.TransactionID, &v.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
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
