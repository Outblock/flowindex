-- Protocol: Flow & Flow-EVM Support

-- 1. Core Chain Data
CREATE TABLE IF NOT EXISTS blocks (
    height BIGINT PRIMARY KEY,
    id VARCHAR(64) NOT NULL,
    parent_id VARCHAR(64),
    timestamp TIMESTAMPTZ,
    collection_count INT DEFAULT 0,
    tx_count BIGINT DEFAULT 0,
    event_count BIGINT DEFAULT 0,
    state_root_hash VARCHAR(64),
    
    -- Redundancy Fields (Exhaustive)
    collection_guarantees JSONB,
    block_seals JSONB,
    signatures JSONB,
    parent_voter_signature TEXT,
    block_status VARCHAR(20),
    execution_result_id VARCHAR(64),
    
    total_gas_used BIGINT DEFAULT 0,
    is_sealed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    block_height BIGINT REFERENCES blocks(height) ON DELETE CASCADE,
    transaction_index INT, -- Position in block
    
    -- Flow Specifics (Exhaustive)
    proposer_address VARCHAR(18),
    proposer_key_index INT,
    proposer_sequence_number BIGINT,
    payer_address VARCHAR(18),
    authorizers TEXT[], -- Array of addresses
    
    -- Execution
    script TEXT,
    arguments JSONB,
    reference_block_id VARCHAR(64),
    status VARCHAR(20), -- SEALED, EXPIRED, etc.
    error_message TEXT,
    
    -- Gas / Metadata
    gas_limit BIGINT,
    gas_used BIGINT,
    computation_usage BIGINT,
    status_code INT,
    execution_status VARCHAR(20), -- Success, Failure, Pending
    
    -- Signatures (Exhaustive Redundancy)
    proposal_key JSONB,
    payload_signatures JSONB,
    envelope_signatures JSONB,
    
    -- EVM Flag
    is_evm BOOLEAN DEFAULT FALSE,
    
    -- Denormalized Events (Extreme Redundancy)
    events JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure denormalized events column exists in transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS events JSONB;

CREATE INDEX IF NOT EXISTS idx_transactions_block_height ON transactions(block_height);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- 2. EVM Extension
CREATE TABLE IF NOT EXISTS evm_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    evm_hash VARCHAR(66), -- 0x...
    from_address VARCHAR(42), -- 0x...
    to_address VARCHAR(42),
    value DECIMAL(78, 0), -- BigInt
    data TEXT,
    gas_used BIGINT,
    logs JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Patch for existing tables (Railway DB persistence)
ALTER TABLE evm_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Events
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    block_height BIGINT, -- Denormalized for speed
    transaction_index INT, -- Position in block
    type TEXT, -- e.g. A.0x...
    event_index INTEGER, -- Position in tx
    contract_address TEXT,
    contract_name TEXT,
    event_name TEXT,
    payload JSONB,
    values JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transaction_id, event_index)
);

-- Ensure Blockscout columns exist if table was already created
ALTER TABLE events ADD COLUMN IF NOT EXISTS contract_address TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS contract_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS values JSONB;
ALTER TABLE events ALTER COLUMN type TYPE TEXT;

CREATE INDEX IF NOT EXISTS idx_events_transaction_id ON events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_events_contract_address ON events(contract_address);
CREATE INDEX IF NOT EXISTS idx_events_contract_address_prefix ON events (contract_address varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_block_height ON events(block_height);

-- 4. Address Roles & Activity (The "Who did what" table)
CREATE TABLE IF NOT EXISTS address_transactions (
    address VARCHAR(42) NOT NULL,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    block_height BIGINT,
    transaction_type VARCHAR(50), -- GENERAL, TOKEN_TRANSFER, CONTRACT_DEPLOY
    role VARCHAR(20), -- PROPOSER, PAYER, AUTHORIZER, EVENT_Subject (e.g. Receiver)
    PRIMARY KEY (address, transaction_id, role)
);

-- Patch for existing tables
ALTER TABLE address_transactions ALTER COLUMN address TYPE VARCHAR(42);

CREATE INDEX IF NOT EXISTS idx_address_transactions_address_height ON address_transactions(address, block_height DESC);

-- 5. Token Indexing (Fungible & NFT)
CREATE TABLE IF NOT EXISTS token_transfers (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) REFERENCES transactions(id) ON DELETE CASCADE,
    block_height BIGINT,
    token_contract_address VARCHAR(255), -- e.g. 0x1.FlowToken
    from_address VARCHAR(42),
    to_address VARCHAR(42),
    amount DECIMAL(78, 18), -- Normalized amount
    token_id VARCHAR(255), -- For NFTs
    is_nft BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_transfers_from ON token_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_token_transfers_to ON token_transfers(to_address);

-- 6. Stats & Progress
CREATE TABLE IF NOT EXISTS indexing_checkpoints (
    service_name VARCHAR(50) PRIMARY KEY,
    last_height BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_stats (
    date DATE PRIMARY KEY,
    tx_count BIGINT DEFAULT 0,
    active_accounts BIGINT DEFAULT 0,
    new_contracts INT DEFAULT 0
);

-- 7. Public Key Registry
CREATE TABLE IF NOT EXISTS account_keys (
    public_key TEXT NOT NULL,
    address VARCHAR(18) NOT NULL,
    transaction_id VARCHAR(64),
    block_height BIGINT,
    key_index INT,
    signing_algorithm VARCHAR(20),
    hashing_algorithm VARCHAR(20),
    weight INT,
    revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (public_key, address)
);

CREATE INDEX IF NOT EXISTS idx_account_keys_public_key ON account_keys(public_key);
CREATE INDEX IF NOT EXISTS idx_account_keys_address ON account_keys(address);

-- 8. Smart Contracts
CREATE TABLE IF NOT EXISTS smart_contracts (
    id SERIAL PRIMARY KEY,
    address VARCHAR(18) NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    version INT DEFAULT 1,
    transaction_id VARCHAR(64),
    block_height BIGINT,
    is_evm BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(address, name)
);

-- 9. Address Statistics (Blockscout-Style)
CREATE TABLE IF NOT EXISTS address_stats (
    address VARCHAR(42) PRIMARY KEY,
    tx_count BIGINT DEFAULT 0,
    token_transfer_count BIGINT DEFAULT 0,
    nft_transfer_count BIGINT DEFAULT 0,
    total_gas_used BIGINT DEFAULT 0,
    last_updated_block BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. NFT Metadata (Non-Fungible Tokens)
CREATE TABLE IF NOT EXISTS nft_metadata (
    contract_address VARCHAR(255) NOT NULL,
    token_id VARCHAR(255) NOT NULL,
    name TEXT,
    description TEXT,
    image_url TEXT,
    animation_url TEXT,
    external_url TEXT,
    attributes JSONB, -- Array of {trait_type, value}
    metadata JSONB, -- Full metadata object
    collection_name TEXT,
    collection_description TEXT,
    collection_image_url TEXT,
    creator_address VARCHAR(42),
    owner_address VARCHAR(42), -- Current owner
    mint_block_height BIGINT,
    mint_transaction_id VARCHAR(64),
    last_transfer_block_height BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contract_address, token_id)
);

CREATE INDEX IF NOT EXISTS idx_nft_metadata_contract ON nft_metadata(contract_address);
CREATE INDEX IF NOT EXISTS idx_nft_metadata_owner ON nft_metadata(owner_address);
CREATE INDEX IF NOT EXISTS idx_nft_metadata_collection ON nft_metadata(collection_name);

-- 11. FT Metadata (Fungible Tokens)
CREATE TABLE IF NOT EXISTS ft_metadata (
    contract_address VARCHAR(255) PRIMARY KEY,
    token_name TEXT,
    token_symbol TEXT,
    decimals INT DEFAULT 18,
    total_supply DECIMAL(78, 0),
    logo_url TEXT,
    website_url TEXT,
    description TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    metadata JSONB, -- Full metadata object
    deployer_address VARCHAR(42),
    deploy_block_height BIGINT,
    deploy_transaction_id VARCHAR(64),
    holder_count BIGINT DEFAULT 0, -- Number of unique holders
    transfer_count BIGINT DEFAULT 0, -- Total transfers
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ft_metadata_symbol ON ft_metadata(token_symbol);
CREATE INDEX IF NOT EXISTS idx_ft_metadata_verified ON ft_metadata(is_verified);
