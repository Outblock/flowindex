-- FlowScan V2 Schema (Refined) — GCP/CloudSQL-friendly, Dual-DB-ready
-- Focus: performance + stability + resumability + extensibility at 10TB+
-- Defaults: 5M partitions for blocks/tx/collections/execution_results; 10M for events/transfers/evm.
--
-- How to use:
-- 1) Run this file once to create schemas, parent tables, and operational tables.
-- 2) Create only a small number of initial partitions (examples at bottom).
-- 3) In production, use a "partition manager" to create partitions on-demand + 1-2 lookahead.
--
-- Postgres: 13+ (recommended 14/15+)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Schemas (Logical split: raw vs app)
--    If you later use two physical DBs, run the raw part in Raw DB and app part in App DB.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Resumability / Ops Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 Worker checkpoints (per service/worker)
CREATE TABLE IF NOT EXISTS app.indexing_checkpoints (
    service_name TEXT PRIMARY KEY,   -- e.g. 'raw_ingester', 'token_worker', 'evm_worker', 'stats_worker'
    last_height  BIGINT NOT NULL DEFAULT 0,
    subcursor    JSONB,              -- optional: {"tx_index":12,"event_index":5}
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 Work leasing (coordinated concurrency)
-- Lease a height range [from_height, to_height) for a worker instance.
CREATE TABLE IF NOT EXISTS app.worker_leases (
    id              BIGSERIAL PRIMARY KEY,
    worker_type     TEXT NOT NULL,          -- e.g. 'token_worker'
    from_height     BIGINT NOT NULL,
    to_height       BIGINT NOT NULL,
    leased_by       TEXT NOT NULL,          -- pod name / instance id
    lease_expires_at TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, FAILED
    attempt         INT  NOT NULL DEFAULT 0,
    last_error_id   BIGINT,                 -- optionally reference raw.indexing_errors(id)
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (worker_type, from_height)
);

CREATE INDEX IF NOT EXISTS idx_worker_leases_claim
  ON app.worker_leases (worker_type, status, lease_expires_at);

-- 1.3 Indexing errors (de-dupe friendly)
CREATE TABLE IF NOT EXISTS raw.indexing_errors (
    id             BIGSERIAL PRIMARY KEY,
    worker_name    TEXT NOT NULL,
    block_height   BIGINT,
    transaction_id TEXT,
    error_hash     TEXT,                      -- sha256(message+stack) computed by app
    error_message  TEXT NOT NULL,
    raw_data       JSONB,                     -- truncated payload (cap in app code)
    severity       TEXT NOT NULL DEFAULT 'WARN', -- FATAL, WARN
    resolved       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Standard payload offloading columns
    payload_hash   VARCHAR(64),               -- SHA-256
    payload_ref    VARCHAR(255),              -- URL or GCS Key
    payload        JSONB,                     -- Full payload if < 8KB (nullable)
    
    UNIQUE (worker_name, block_height, transaction_id, error_hash)
);

CREATE INDEX IF NOT EXISTS idx_indexing_errors_active
  ON raw.indexing_errors (created_at DESC)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_indexing_errors_dedupe
  ON raw.indexing_errors(worker_name, block_height, transaction_id, error_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Partition helper (on-demand partition creation)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates partitions named <table>_p<from_height> in the same schema as parent table.
-- Example:
--   SELECT raw.create_partitions('raw.transactions', 'block_height', 0, 50000000, 5000000);
CREATE OR REPLACE FUNCTION raw.create_partitions(
  parent_table regclass,
  start_height bigint,
  end_height   bigint,
  step         bigint
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  from_h bigint;
  to_h   bigint;
  parent_nsp text;
  parent_rel text;
  part_name text;
BEGIN
  IF step <= 0 THEN
    RAISE EXCEPTION 'step must be > 0';
  END IF;

  SELECT n.nspname, c.relname
    INTO parent_nsp, parent_rel
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = parent_table;

  from_h := start_height;
  WHILE from_h < end_height LOOP
    to_h := LEAST(from_h + step, end_height);
    part_name := format('%s.%s_p%s', parent_nsp, parent_rel, from_h);

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %s PARTITION OF %s FOR VALUES FROM (%s) TO (%s);',
      part_name, parent_table, from_h, to_h
    );

    from_h := to_h;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RAW DATA (partitioned)
--    Rule of thumb: keep raw tables append-only + idempotent constraints.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 Blocks (5M partitions)
CREATE TABLE IF NOT EXISTS raw.blocks (
    height            BIGINT NOT NULL,
    id                BYTEA NOT NULL,
    parent_id         BYTEA,
    timestamp         TIMESTAMPTZ NOT NULL,
    collection_count  INT DEFAULT 0,
    tx_count          BIGINT DEFAULT 0,
    event_count       BIGINT DEFAULT 0,
    state_root_hash   BYTEA,
    total_gas_used    BIGINT DEFAULT 0,
    is_sealed         BOOLEAN DEFAULT FALSE,

    -- payloads (consider trimming if storage pressure is high)
    collection_guarantees JSONB,
    block_seals          JSONB,
    signatures           JSONB,
    execution_result_id  BYTEA,

    PRIMARY KEY (height),
    UNIQUE (height, id)
) PARTITION BY RANGE (height);

-- Ensure payload columns exist on older installs (safe no-op if present).
ALTER TABLE IF EXISTS raw.blocks
    ADD COLUMN IF NOT EXISTS total_gas_used BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS collection_guarantees JSONB,
    ADD COLUMN IF NOT EXISTS block_seals JSONB,
    ADD COLUMN IF NOT EXISTS signatures JSONB,
    ADD COLUMN IF NOT EXISTS execution_result_id BYTEA;

-- 3.1.b Scripts & Contract Code mapping tables (For payload offloading)
-- raw.scripts (store script text by hash)
CREATE TABLE IF NOT EXISTS raw.scripts (
    script_hash VARCHAR(64) PRIMARY KEY, -- SHA-256
    script_text TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- app.contract_code (store contract code by hash)
CREATE TABLE IF NOT EXISTS app.contract_code (
    code_hash  VARCHAR(64) PRIMARY KEY, -- SHA-256
    code_text  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.1.a Block lookup for fast "by id" queries (avoids scanning partitions)
CREATE TABLE IF NOT EXISTS raw.block_lookup (
    id      BYTEA PRIMARY KEY,
    height  BIGINT NOT NULL,
    timestamp TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_block_lookup_height ON raw.block_lookup(height);

-- 3.2 Transactions (5M partitions)
-- NOTE: PK must include partition key to enforce uniqueness across partitions.
CREATE TABLE IF NOT EXISTS raw.transactions (
    block_height      BIGINT NOT NULL,
    id                BYTEA NOT NULL,
    internal_id       BIGSERIAL,           -- surrogate, not authoritative ordering
    transaction_index INT NOT NULL,

    proposer_address  BYTEA,
    payer_address     BYTEA,
    authorizers       BYTEA[],

    -- Storage warning: script can be huge; store script_hash and de-dupe via raw.scripts.
    -- We keep `script` for backwards compatibility (older rows), but new ingests should prefer NULL + script_hash.
    script_hash       VARCHAR(64),
    script            TEXT,
    arguments         JSONB,

    status            VARCHAR(20),
    error_message     TEXT,
    gas_limit         BIGINT,
    gas_used          BIGINT,
    event_count       INT DEFAULT 0,
    is_evm            BOOLEAN DEFAULT FALSE,

    timestamp         TIMESTAMPTZ NOT NULL, -- copy from block.timestamp for redundancy

    PRIMARY KEY (block_height, id)
) PARTITION BY RANGE (block_height);

-- Ensure column exists on older installs (safe no-op for new DBs).
ALTER TABLE IF EXISTS raw.transactions
  ADD COLUMN IF NOT EXISTS script_hash VARCHAR(64);

-- 3.2.a Tx lookup for fast "by tx id" queries
CREATE TABLE IF NOT EXISTS raw.tx_lookup (
    id           BYTEA PRIMARY KEY,
    block_height BIGINT NOT NULL,
    transaction_index INT,
    timestamp    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tx_lookup_height ON raw.tx_lookup(block_height);
ALTER TABLE IF EXISTS raw.tx_lookup
  DROP COLUMN IF EXISTS evm_hash;

-- Pagination / range queries (built on parent => per-partition indexes)
CREATE INDEX IF NOT EXISTS idx_transactions_pagination
  ON raw.transactions (block_height DESC, transaction_index DESC, id DESC);

-- 3.3 Events (10M partitions - high volume)
CREATE TABLE IF NOT EXISTS raw.events (
    block_height      BIGINT NOT NULL,
    transaction_id    BYTEA NOT NULL,
    event_index       INT NOT NULL,
    internal_id       BIGSERIAL,
    transaction_index INT,

    type              TEXT NOT NULL,
    payload           JSONB,          -- can be massive; keep an eye on 10TB goal
    contract_address  BYTEA,
    event_name        TEXT,

    timestamp         TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (block_height, transaction_id, event_index)
) PARTITION BY RANGE (block_height);

-- Note: avoid heavy secondary indexes on raw.events in early phase.

-- 3.4 Collections (5M partitions)
CREATE TABLE IF NOT EXISTS raw.collections (
    block_height   BIGINT NOT NULL,
    id             BYTEA NOT NULL,
    guarantor_ids  TEXT[],
    signer_ids     TEXT[],
    signatures     JSONB,
    transaction_ids BYTEA[],
    timestamp      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (block_height, id)
) PARTITION BY RANGE (block_height);

-- 3.5 Execution Results (5M partitions)
CREATE TABLE IF NOT EXISTS raw.execution_results (
    block_height BIGINT NOT NULL,
    id           BYTEA NOT NULL,
    chunk_data   JSONB,
    timestamp    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (block_height, id)
) PARTITION BY RANGE (block_height);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) DERIVED HIGH-VOLUME TABLES (partitioned)
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 Token transfers (10M partitions)
CREATE TABLE IF NOT EXISTS app.token_transfers (
    block_height            BIGINT NOT NULL,
    transaction_id          BYTEA NOT NULL,
    event_index             INT NOT NULL,
    internal_id             BIGSERIAL,

    token_contract_address  BYTEA,
    contract_name           TEXT, -- Flow contract name (disambiguates multiple contracts per address)
    from_address            BYTEA,
    to_address              BYTEA,
    amount                  DECIMAL(78, 18),
    token_id                VARCHAR(255),
    is_nft                  BOOLEAN DEFAULT FALSE,

    timestamp               TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (block_height, transaction_id, event_index)
) PARTITION BY RANGE (block_height);

CREATE INDEX IF NOT EXISTS idx_token_transfers_from  ON app.token_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_token_transfers_to    ON app.token_transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_token_transfers_token ON app.token_transfers(token_contract_address);
CREATE INDEX IF NOT EXISTS idx_token_transfers_nft_height ON app.token_transfers(is_nft, block_height DESC, event_index DESC);

ALTER TABLE IF EXISTS app.token_transfers
  ADD COLUMN IF NOT EXISTS contract_name TEXT;

ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS event_index INT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS transaction_index INT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS nonce BIGINT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS gas_limit BIGINT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS gas_used BIGINT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS gas_price NUMERIC;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS gas_fee_cap NUMERIC;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS gas_tip_cap NUMERIC;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS value NUMERIC;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS tx_type INT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS chain_id NUMERIC;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS status_code INT;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE IF EXISTS app.evm_transactions
  DROP CONSTRAINT IF EXISTS evm_transactions_pkey;
ALTER TABLE IF EXISTS app.evm_transactions
  ADD CONSTRAINT evm_transactions_pkey PRIMARY KEY (block_height, transaction_id, event_index, evm_hash);

-- 4.2 EVM transactions/logs (10M partitions)
CREATE TABLE IF NOT EXISTS app.evm_transactions (
    block_height      BIGINT NOT NULL,
    transaction_id    BYTEA NOT NULL,
    evm_hash          BYTEA NOT NULL,
    event_index       INT NOT NULL,
    transaction_index INT,
    from_address      BYTEA,
    to_address        BYTEA,
    nonce             BIGINT,
    gas_limit         BIGINT,
    gas_used          BIGINT,
    gas_price         NUMERIC,
    gas_fee_cap       NUMERIC,
    gas_tip_cap       NUMERIC,
    value             NUMERIC,
    tx_type           INT,
    chain_id          NUMERIC,
    data              TEXT,
    logs              JSONB,                -- can be huge; consider splitting logs to separate table if needed
    status_code       INT,
    status            TEXT,
    timestamp         TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (block_height, transaction_id, event_index, evm_hash)
) PARTITION BY RANGE (block_height);

CREATE INDEX IF NOT EXISTS idx_evm_hash ON app.evm_transactions(evm_hash);
CREATE INDEX IF NOT EXISTS idx_evm_transactions_tx ON app.evm_transactions(transaction_id);

-- 4.3 EVM tx hash mapping (supports multiple EVM hashes per Cadence tx)
CREATE TABLE IF NOT EXISTS app.evm_tx_hashes (
    block_height      BIGINT NOT NULL,
    transaction_id    BYTEA NOT NULL,
    evm_hash          BYTEA NOT NULL,
    event_index       INT NOT NULL,
    timestamp         TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (block_height, transaction_id, event_index, evm_hash)
) PARTITION BY RANGE (block_height);

CREATE INDEX IF NOT EXISTS idx_evm_tx_hashes_hash ON app.evm_tx_hashes(evm_hash);
CREATE INDEX IF NOT EXISTS idx_evm_tx_hashes_tx ON app.evm_tx_hashes(transaction_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) STATE TABLES (App DB)
-- ─────────────────────────────────────────────────────────────────────────────

-- 5.1 Account Keys
CREATE TABLE IF NOT EXISTS app.account_keys (
    address             BYTEA NOT NULL,
    key_index            INT NOT NULL,
    public_key           BYTEA NOT NULL,
    signing_algorithm    SMALLINT,
    hashing_algorithm    SMALLINT,
    weight               INT,
    revoked              BOOLEAN NOT NULL DEFAULT FALSE,
    added_at_height      BIGINT,
    revoked_at_height    BIGINT,
    last_updated_height  BIGINT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (address, key_index)
);

CREATE INDEX IF NOT EXISTS idx_account_keys_public_key
  ON app.account_keys (public_key);
CREATE INDEX IF NOT EXISTS idx_account_keys_public_key_active
  ON app.account_keys (public_key)
  WHERE revoked = FALSE;

-- 5.2 Smart Contracts
CREATE TABLE IF NOT EXISTS app.smart_contracts (
    address             BYTEA NOT NULL,
    name                TEXT NOT NULL,
    code                TEXT,               -- consider hash+dedupe if storage grows fast
    version             INT DEFAULT 1,
    last_updated_height BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (address, name)
);

-- 5.3 Address Stats
CREATE TABLE IF NOT EXISTS app.address_stats (
    address            BYTEA PRIMARY KEY,
    tx_count           BIGINT DEFAULT 0,
    token_transfer_count BIGINT DEFAULT 0,
    total_gas_used     BIGINT DEFAULT 0,
    last_updated_block BIGINT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.4 FT metadata
CREATE TABLE IF NOT EXISTS app.ft_metadata (
    contract_address BYTEA PRIMARY KEY,
    token_name       TEXT,
    token_symbol     TEXT,
    decimals         INT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Initial partitions (keep minimal; partition manager should extend later)
-- ─────────────────────────────────────────────────────────────────────────────
-- 5M partitions: [0,5M), [5M,10M)
SELECT raw.create_partitions('raw.blocks', 0, 10000000, 5000000);
SELECT raw.create_partitions('raw.transactions', 0, 10000000, 5000000);
SELECT raw.create_partitions('raw.collections', 0, 10000000, 5000000);
SELECT raw.create_partitions('raw.execution_results', 0, 10000000, 5000000);

-- 10M partitions: [0,10M), [10M,20M)
SELECT raw.create_partitions('raw.events', 0, 20000000, 10000000);
SELECT raw.create_partitions('app.token_transfers', 0, 20000000, 10000000);
SELECT raw.create_partitions('app.evm_transactions', 0, 20000000, 10000000);

COMMIT;
-- Add missing tables required by backend but not in initial Schema V2
BEGIN;

CREATE TABLE IF NOT EXISTS app.address_transactions (
    address BYTEA NOT NULL,
    transaction_id BYTEA NOT NULL,
    block_height BIGINT NOT NULL,
    role VARCHAR(20), -- e.g. PROPOSER, PAYER, AUTHORIZER
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, block_height, transaction_id, role)
);
CREATE INDEX IF NOT EXISTS idx_address_txs_address_height ON app.address_transactions(address, block_height DESC);


CREATE TABLE IF NOT EXISTS app.daily_stats (
    date DATE PRIMARY KEY,
    tx_count BIGINT DEFAULT 0,
    active_accounts BIGINT DEFAULT 0,
    new_contracts BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.market_prices (
    id BIGSERIAL PRIMARY KEY,
    asset TEXT NOT NULL,
    currency TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    price_change_24h DOUBLE PRECISION,
    market_cap DOUBLE PRECISION,
    source TEXT,
    as_of TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_market_prices_asset_currency_time
    ON app.market_prices (asset, currency, as_of DESC);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) API Redesign Additions (Phase 1)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS app.accounts (
    address           BYTEA PRIMARY KEY,
    first_seen_height BIGINT,
    last_seen_height  BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_last_seen
  ON app.accounts (last_seen_height DESC);

CREATE TABLE IF NOT EXISTS app.ft_tokens (
    contract_address BYTEA NOT NULL,
    contract_name    TEXT NOT NULL DEFAULT '',
    name             TEXT,
    symbol           TEXT,
    decimals         INT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contract_address, contract_name)
);

CREATE TABLE IF NOT EXISTS app.coa_accounts (
    coa_address   BYTEA PRIMARY KEY,
    flow_address  BYTEA NOT NULL,
    transaction_id BYTEA,
    block_height  BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coa_accounts_flow ON app.coa_accounts (flow_address);

CREATE TABLE IF NOT EXISTS app.ft_holdings (
    address          BYTEA NOT NULL,
    contract_address BYTEA NOT NULL,
    contract_name    TEXT NOT NULL DEFAULT '',
    balance          NUMERIC(78, 18) NOT NULL DEFAULT 0,
    last_height      BIGINT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (address, contract_address, contract_name)
);
CREATE INDEX IF NOT EXISTS idx_ft_holdings_address
  ON app.ft_holdings (address);

CREATE TABLE IF NOT EXISTS app.nft_collections (
    contract_address BYTEA NOT NULL,
    contract_name    TEXT NOT NULL DEFAULT '',
    name             TEXT,
    symbol           TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contract_address, contract_name)
);

CREATE TABLE IF NOT EXISTS app.nft_ownership (
    contract_address BYTEA NOT NULL,
    contract_name    TEXT NOT NULL DEFAULT '',
    nft_id           VARCHAR(255) NOT NULL,
    owner            BYTEA,
    last_height      BIGINT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contract_address, contract_name, nft_id)
);
CREATE INDEX IF NOT EXISTS idx_nft_ownership_owner
  ON app.nft_ownership (owner);

ALTER TABLE IF EXISTS app.ft_tokens
  ADD COLUMN IF NOT EXISTS contract_name TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS app.ft_tokens
  DROP CONSTRAINT IF EXISTS ft_tokens_pkey;
ALTER TABLE IF EXISTS app.ft_tokens
  ADD CONSTRAINT ft_tokens_pkey PRIMARY KEY (contract_address, contract_name);

ALTER TABLE IF EXISTS app.ft_holdings
  ADD COLUMN IF NOT EXISTS contract_name TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS app.ft_holdings
  DROP CONSTRAINT IF EXISTS ft_holdings_pkey;
ALTER TABLE IF EXISTS app.ft_holdings
  ADD CONSTRAINT ft_holdings_pkey PRIMARY KEY (address, contract_address, contract_name);

ALTER TABLE IF EXISTS app.nft_collections
  ADD COLUMN IF NOT EXISTS contract_name TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS app.nft_collections
  DROP CONSTRAINT IF EXISTS nft_collections_pkey;
ALTER TABLE IF EXISTS app.nft_collections
  ADD CONSTRAINT nft_collections_pkey PRIMARY KEY (contract_address, contract_name);

ALTER TABLE IF EXISTS app.nft_ownership
  ADD COLUMN IF NOT EXISTS contract_name TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS app.nft_ownership
  DROP CONSTRAINT IF EXISTS nft_ownership_pkey;
ALTER TABLE IF EXISTS app.nft_ownership
  ADD CONSTRAINT nft_ownership_pkey PRIMARY KEY (contract_address, contract_name, nft_id);

CREATE TABLE IF NOT EXISTS app.tx_contracts (
    transaction_id      BYTEA NOT NULL,
    contract_identifier TEXT NOT NULL,
    source              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (transaction_id, contract_identifier)
);

CREATE TABLE IF NOT EXISTS app.tx_tags (
    transaction_id BYTEA NOT NULL,
    tag            TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (transaction_id, tag)
);

CREATE TABLE IF NOT EXISTS app.tx_metrics (
    block_height     BIGINT NOT NULL,
    transaction_id   BYTEA NOT NULL,
    event_count      INT NOT NULL DEFAULT 0,
    gas_used         BIGINT NOT NULL DEFAULT 0,
    fee              NUMERIC,
    fee_amount       NUMERIC,
    inclusion_effort NUMERIC,
    execution_effort NUMERIC,
    execution_status VARCHAR(32),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (block_height, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_metrics_tx ON app.tx_metrics (transaction_id);

CREATE TABLE IF NOT EXISTS app.account_storage_snapshots (
    address           BYTEA PRIMARY KEY,
    storage_used      BIGINT NOT NULL DEFAULT 0,
    storage_capacity  BIGINT NOT NULL DEFAULT 0,
    storage_available BIGINT NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.status_snapshots (
    kind       TEXT NOT NULL,
    payload    JSONB NOT NULL,
    as_of      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind)
);

COMMIT;
