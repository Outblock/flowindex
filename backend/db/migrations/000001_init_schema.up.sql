-- Enable UUID extension if needed (optional, using Hash strings for Flow)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Blocks Table
CREATE TABLE IF NOT EXISTS blocks (
    height BIGINT PRIMARY KEY,
    id VARCHAR(64) NOT NULL UNIQUE,
    parent_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    collection_count INT DEFAULT 0,
    total_gas_used BIGINT DEFAULT 0,
    is_sealed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX idx_blocks_parent_id ON blocks(parent_id);

-- 2. Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    block_height BIGINT REFERENCES blocks(height) ON DELETE CASCADE,
    proposer_address VARCHAR(18),
    payer_address VARCHAR(18),
    authorizers TEXT[], -- Array of addresses
    script TEXT,
    arguments JSONB,
    status VARCHAR(20), -- 'SEALED', 'EXPIRED', 'PENDING'
    error_message TEXT,
    gas_limit BIGINT,
    gas_used BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_block_height ON transactions(block_height);
CREATE INDEX idx_transactions_payer ON transactions(payer_address);
CREATE INDEX idx_transactions_proposer ON transactions(proposer_address);

-- 3. Events Table
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    type VARCHAR(255) NOT NULL, -- e.g. A.1654653399040a61.FlowToken.TokensDeposited
    event_index INT NOT NULL,
    payload JSONB,
    block_height BIGINT, -- Denormalized for speed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transaction_id, event_index)
);

CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_block_height ON events(block_height);

-- 4. Tokens Registry
CREATE TABLE IF NOT EXISTS tokens (
    contract_address VARCHAR(255) PRIMARY KEY, -- e.g. A.1654653399040a61.FlowToken
    name VARCHAR(100),
    symbol VARCHAR(20),
    decimals INT,
    type VARCHAR(20), -- 'Fungible', 'NonFungible'
    verified BOOLEAN DEFAULT FALSE
);

-- 5. Token Transfers (Fungible)
CREATE TABLE IF NOT EXISTS token_transfers (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    block_height BIGINT NOT NULL,
    token_contract_address VARCHAR(255) REFERENCES tokens(contract_address),
    from_address VARCHAR(18), -- NULL for Mint
    to_address VARCHAR(18),   -- NULL for Burn
    amount NUMERIC(78, 0),    -- Handles large ufix64 values
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_token_transfers_from ON token_transfers(from_address, block_height DESC);
CREATE INDEX idx_token_transfers_to ON token_transfers(to_address, block_height DESC);
CREATE INDEX idx_token_transfers_token ON token_transfers(token_contract_address);

-- 6. NFT Transfers
CREATE TABLE IF NOT EXISTS nft_transfers (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    block_height BIGINT NOT NULL,
    token_contract_address VARCHAR(255) REFERENCES tokens(contract_address),
    nft_id BIGINT NOT NULL,
    from_address VARCHAR(18),
    to_address VARCHAR(18),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nft_transfers_from ON nft_transfers(from_address, block_height DESC);
CREATE INDEX idx_nft_transfers_to ON nft_transfers(to_address, block_height DESC);
CREATE INDEX idx_nft_transfers_nft_id ON nft_transfers(token_contract_address, nft_id);

-- 7. Addresses (Accounts)
CREATE TABLE IF NOT EXISTS addresses (
    address VARCHAR(18) PRIMARY KEY,
    balance_flow NUMERIC DEFAULT 0,
    is_contract BOOLEAN DEFAULT FALSE,
    name_tag VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Smart Contracts
CREATE TABLE IF NOT EXISTS smart_contracts (
    address VARCHAR(18) REFERENCES addresses(address),
    name VARCHAR(255),
    code TEXT,
    abi JSONB,
    verification_status VARCHAR(20) DEFAULT 'UNVERIFIED',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, name)
);

-- 9. Address Current Token Balances (Portfolio)
CREATE TABLE IF NOT EXISTS address_token_balances (
    address VARCHAR(18) REFERENCES addresses(address),
    token_contract_address VARCHAR(255) REFERENCES tokens(contract_address),
    balance NUMERIC DEFAULT 0,
    nft_count INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, token_contract_address)
);

-- 10. Address Transactions (Lookup Table - The "Blockscout Secret")
-- Maps ANY role (Payer, Proposer, Authorizer, Event Participant) to a Tx
CREATE TABLE IF NOT EXISTS address_transactions (
    address VARCHAR(18) NOT NULL,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    block_height BIGINT NOT NULL,
    transaction_type VARCHAR(50), -- 'GENERAL', 'TRANSFER', 'CONTRACT_DEPLOY'
    role VARCHAR(20), -- 'PAYER', 'PROPOSER', 'AUTHORIZER', 'EVENT'
    PRIMARY KEY (address, transaction_id, role)
);

CREATE INDEX idx_address_transactions_lookup ON address_transactions(address, block_height DESC);

-- 11. Indexing Checkpoints (Resilience)
CREATE TABLE IF NOT EXISTS indexing_checkpoints (
    service_name VARCHAR(50) PRIMARY KEY,
    last_height BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
