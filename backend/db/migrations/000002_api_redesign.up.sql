-- API Redesign (Phase 1) additions
-- Adds app-level tables needed for Accounting/Flow/Status APIs.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

-- Accounts catalog (discoverable addresses)
CREATE TABLE IF NOT EXISTS app.accounts (
    address           VARCHAR(18) PRIMARY KEY,
    first_seen_height BIGINT,
    last_seen_height  BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_last_seen
  ON app.accounts (last_seen_height DESC);

-- FT tokens metadata
CREATE TABLE IF NOT EXISTS app.ft_tokens (
    contract_address VARCHAR(255) PRIMARY KEY,
    name             TEXT,
    symbol           TEXT,
    decimals         INT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FT holdings (address -> token balance)
CREATE TABLE IF NOT EXISTS app.ft_holdings (
    address          VARCHAR(18) NOT NULL,
    contract_address VARCHAR(255) NOT NULL,
    balance          NUMERIC(78, 18) NOT NULL DEFAULT 0,
    last_height      BIGINT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (address, contract_address)
);

CREATE INDEX IF NOT EXISTS idx_ft_holdings_address
  ON app.ft_holdings (address);

-- NFT collections metadata
CREATE TABLE IF NOT EXISTS app.nft_collections (
    contract_address VARCHAR(255) PRIMARY KEY,
    name             TEXT,
    symbol           TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NFT ownership (collection + id -> owner)
CREATE TABLE IF NOT EXISTS app.nft_ownership (
    contract_address VARCHAR(255) NOT NULL,
    nft_id           VARCHAR(255) NOT NULL,
    owner            VARCHAR(18),
    last_height      BIGINT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contract_address, nft_id)
);

CREATE INDEX IF NOT EXISTS idx_nft_ownership_owner
  ON app.nft_ownership (owner);

-- Transaction -> contract imports/outputs
CREATE TABLE IF NOT EXISTS app.tx_contracts (
    transaction_id     VARCHAR(64) NOT NULL,
    contract_identifier TEXT NOT NULL,
    source             TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (transaction_id, contract_identifier)
);

-- Transaction tags (derived classifications)
CREATE TABLE IF NOT EXISTS app.tx_tags (
    transaction_id VARCHAR(64) NOT NULL,
    tag            TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (transaction_id, tag)
);

-- Cached status snapshots (epoch, tokenomics, etc)
CREATE TABLE IF NOT EXISTS app.status_snapshots (
    kind       TEXT NOT NULL,
    payload    JSONB NOT NULL,
    as_of      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind)
);

COMMIT;
