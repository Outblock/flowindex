-- DANGER: This will wipe all data. Use for schema reset.
DROP TABLE IF EXISTS account_keys CASCADE;
DROP TABLE IF EXISTS address_token_balances CASCADE;
DROP TABLE IF EXISTS address_transactions CASCADE;
DROP TABLE IF EXISTS daily_stats CASCADE;
DROP TABLE IF EXISTS indexing_checkpoints CASCADE;
DROP TABLE IF EXISTS token_transfers CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS evm_transactions CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS blocks CASCADE;

-- Re-run schema.sql after this
