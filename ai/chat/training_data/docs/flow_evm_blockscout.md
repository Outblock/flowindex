# Flow EVM Blockscout Database Documentation

## Overview
This is a Blockscout instance indexing the **Flow EVM** chain (Chain ID: 747).
The native token is **FLOW** and addresses use the standard 20-byte Ethereum format.
All address and hash columns are stored as `bytea`. Use `encode(col, 'hex')` to display
them as hex strings, or `'\x...'::bytea` / `decode('...','hex')` to filter by address.

## Key Tables and Relationships

### Blocks & Transactions
- `blocks.number` is the block height. `blocks.timestamp` is the block time.
- `transactions.block_number` links to `blocks.number`.
- `transactions.status`: 1 = success, 0 = failure.
- `transactions.value` is in **wei** (1 FLOW = 1e18 wei).

### Tokens
- `tokens` stores ERC-20, ERC-721, and ERC-1155 token metadata.
- `tokens.type` distinguishes token standards.
- `tokens.holder_count` is a denormalized count that may lag behind actual balances.

### Token Balances (IMPORTANT)
- `address_current_token_balances` holds the **latest** balance per (address, token, token_id).
  This is the primary table for "who holds what" queries.
- `address_token_balances` holds **historical** snapshots at each block where balance changed.
- `token_transfers` logs every transfer event. It is the source of truth for transfer history.
- To find **top holders** of a token: query `address_current_token_balances` filtered by
  `token_contract_address_hash`, ordered by `value DESC`.

### Native Coin Balances
- `address_coin_balances` tracks FLOW (native coin) balance at specific blocks.
- `addresses.fetched_coin_balance` has the latest known native balance.

### Contracts
- `smart_contracts` contains verified contract source code, ABI, and compiler info.
- Linked to `addresses` via `address_hash`.

### Internal Transactions
- `internal_transactions` stores sub-calls within transactions (CALL, CREATE, etc.).
- Useful for tracing value transfers that don't appear in top-level transactions.

## Well-Known Tokens on Flow EVM
- **WFLOW** (Wrapped FLOW): The canonical wrapped native token.
  To query WFLOW, filter by its `token_contract_address_hash`.

## Address Format Notes
- Addresses are stored as `bytea` (20 bytes).
- To display: `'0x' || encode(address_hash, 'hex')`
- To filter: `address_hash = decode('abcdef...', 'hex')` (without 0x prefix)
  or `address_hash = '\xabcdef...'::bytea`

## Common Query Patterns
- **Latest block**: `SELECT max(number) FROM blocks`
- **24h transaction count**: `SELECT count(*) FROM transactions WHERE block_timestamp > NOW() - INTERVAL '24 hours'`
- **Top token holders**: Join `address_current_token_balances` with `tokens` and `addresses`
- **Table sizes**: Use `pg_total_relation_size()` for monitoring
- **Indexer health**: Check `missing_block_ranges` and `pending_block_operations` counts
