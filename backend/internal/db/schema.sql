-- Tables for Flow Scan Clone

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
    height BIGINT PRIMARY KEY,
    id VARCHAR(64) NOT NULL,
    parent_id VARCHAR(64),
    timestamp TIMESTAMPTZ,
    collection_guarantees JSONB, -- List of collection guarantees
    block_seals JSONB, -- List of block seals
    signature VARCHAR(255),
    proposer_id VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    block_height BIGINT REFERENCES blocks(height),
    script TEXT,
    arguments JSONB,
    gas_limit BIGINT,
    proposal_key JSONB, -- Structure for proposal key
    payer VARCHAR(64),
    authorizers JSONB,
    signatures JSONB,
    status VARCHAR(20), -- PENDING, FINALIZED, EXECUTED, SEALED
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accounts table (Indexing balance updates if possible, though usually we just query on demand)
CREATE TABLE IF NOT EXISTS accounts (
    address VARCHAR(64) PRIMARY KEY,
    balance DECIMAL(20),
    code_hash VARCHAR(64),
    keys JSONB,
    contracts JSONB, -- Map of contract name to code
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events table (Indexing events for search)
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) REFERENCES transactions(id),
    block_height BIGINT REFERENCES blocks(height),
    type VARCHAR(255), -- Event type e.g. 'FlowToken.TokensDeposited'
    payload JSONB, -- The event data
    timestamp TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_block_height ON transactions(block_height);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_transaction_id ON events(transaction_id);
