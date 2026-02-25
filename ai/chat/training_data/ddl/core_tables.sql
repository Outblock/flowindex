-- Core Blockscout DDL for Vanna training.
-- These are simplified definitions focusing on the columns most useful for queries.
-- The actual schema has more columns; Vanna will learn the key ones from these + examples.

CREATE TABLE blocks (
    number bigint PRIMARY KEY,
    hash bytea NOT NULL,
    miner_hash bytea,          -- address that mined/validated the block
    parent_hash bytea NOT NULL,
    nonce bytea,
    size integer,
    gas_limit numeric(100,0),
    gas_used numeric(100,0),
    timestamp timestamp without time zone NOT NULL,
    difficulty numeric(50,0),
    total_difficulty numeric(50,0),
    base_fee_per_gas numeric(100,0),
    consensus boolean DEFAULT true,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE transactions (
    hash bytea PRIMARY KEY,
    block_hash bytea,
    block_number bigint,
    from_address_hash bytea NOT NULL,
    to_address_hash bytea,
    value numeric(100,0) NOT NULL,  -- in wei
    gas numeric(100,0) NOT NULL,
    gas_price numeric(100,0),
    gas_used numeric(100,0),
    input bytea,
    nonce integer NOT NULL,
    index integer,
    status integer,                  -- 0 = error, 1 = ok
    error text,
    block_timestamp timestamp without time zone,
    max_fee_per_gas numeric(100,0),
    max_priority_fee_per_gas numeric(100,0),
    type integer,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE addresses (
    hash bytea PRIMARY KEY,
    fetched_coin_balance numeric(100,0),
    fetched_coin_balance_block_number bigint,
    contract_code bytea,
    nonce integer,
    decompiled boolean,
    verified boolean,
    gas_used bigint,
    transactions_count integer,
    token_transfers_count integer,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE tokens (
    contract_address_hash bytea PRIMARY KEY,
    name text,
    symbol text,
    total_supply numeric(100,0),
    decimals smallint,
    type text NOT NULL,             -- 'ERC-20', 'ERC-721', 'ERC-1155'
    holder_count integer,
    cataloged boolean DEFAULT false,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE token_transfers (
    transaction_hash bytea NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    block_hash bytea NOT NULL,
    from_address_hash bytea NOT NULL,
    to_address_hash bytea NOT NULL,
    token_contract_address_hash bytea NOT NULL,
    amount numeric(100,0),          -- NULL for NFTs
    token_id numeric(78,0),         -- NULL for ERC-20
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    PRIMARY KEY (transaction_hash, block_hash, log_index)
);

CREATE TABLE address_current_token_balances (
    id bigserial PRIMARY KEY,
    address_hash bytea NOT NULL,
    block_number bigint NOT NULL,
    token_contract_address_hash bytea NOT NULL,
    value numeric(100,0),
    value_fetched_at timestamp without time zone,
    token_id numeric(78,0),
    token_type text,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    UNIQUE (address_hash, token_contract_address_hash, token_id)
);

CREATE TABLE address_token_balances (
    id bigserial PRIMARY KEY,
    address_hash bytea NOT NULL,
    block_number bigint NOT NULL,
    token_contract_address_hash bytea NOT NULL,
    value numeric(100,0),
    value_fetched_at timestamp without time zone,
    token_id numeric(78,0),
    token_type text,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE internal_transactions (
    transaction_hash bytea NOT NULL,
    index integer NOT NULL,
    block_number bigint,
    block_hash bytea NOT NULL,
    block_index integer,
    call_type text,
    from_address_hash bytea,
    to_address_hash bytea,
    value numeric(100,0),
    gas numeric(100,0),
    gas_used numeric(100,0),
    input bytea,
    output bytea,
    error text,
    type text NOT NULL,             -- 'call', 'create', 'selfdestruct', 'reward'
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    PRIMARY KEY (transaction_hash, block_hash, index)
);

CREATE TABLE logs (
    transaction_hash bytea NOT NULL,
    block_hash bytea NOT NULL,
    address_hash bytea NOT NULL,
    data bytea NOT NULL,
    index integer NOT NULL,
    block_number bigint,
    first_topic text,
    second_topic text,
    third_topic text,
    fourth_topic text,
    type text,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    PRIMARY KEY (transaction_hash, block_hash, index)
);

CREATE TABLE smart_contracts (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    compiler_version text NOT NULL,
    optimization boolean NOT NULL,
    contract_source_code text NOT NULL,
    abi jsonb,
    address_hash bytea NOT NULL UNIQUE,
    constructor_arguments text,
    evm_version text,
    optimization_runs integer,
    verified_via_sourcify boolean DEFAULT false,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE address_coin_balances (
    address_hash bytea NOT NULL,
    block_number bigint NOT NULL,
    value numeric(100,0),
    value_fetched_at timestamp without time zone,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    PRIMARY KEY (address_hash, block_number)
);

-- Operational tables used for indexer status monitoring
CREATE TABLE missing_block_ranges (
    id bigserial PRIMARY KEY,
    from_number bigint,
    to_number bigint,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE pending_block_operations (
    block_hash bytea PRIMARY KEY,
    block_number bigint,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

-- Account / API rate limiting tables
CREATE TABLE account_api_plans (
    id bigserial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    max_req_per_second integer NOT NULL,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE account_identities (
    id bigserial PRIMARY KEY,
    email text,
    plan_id bigint REFERENCES account_api_plans(id),
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE account_api_keys (
    id bigserial PRIMARY KEY,
    identity_id bigint REFERENCES account_identities(id),
    name text,
    value text NOT NULL UNIQUE,
    inserted_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);
