# API Redesign Plan (Implementation Notes)

This document tracks API coverage vs `api.json` and notes DB gaps and migration strategy.

## Specs

- `api.json` paths: 74

- `find-api.json` paths: 97


### Tag Breakdown (api.json)

- `Accounting`: 9 operations
- `DeFi`: 5 operations
- `Flow`: 38 operations
- `Staking`: 15 operations
- `Status`: 7 operations

## Scope & Compatibility

- **Implemented now**: `Accounting`, `Flow`, `Status` tags from `api.json`.
- **Deferred (501)**: `DeFi`, `Staking`, Flow nodes/scheduled-tx/tax-report, EVM token catalog.
- **find-api compatibility**: any path not present in `api.json` returns **HTTP 501** with a deprecation message.

## DB Coverage & Gaps

**Already covered by existing data**:
- Blocks/transactions/events: `raw.blocks`, `raw.transactions`, `raw.events`, `raw.block_lookup`, `raw.tx_lookup`
- Transfers: `app.token_transfers` (FT/NFT with `is_nft`)
- Address activity: `app.address_transactions`, `app.address_stats`
- Contracts: `app.smart_contracts`
- Account keys: `app.account_keys`
- Stats: `app.daily_stats`, `app.market_prices`

**Added to support the new API**:
- `app.accounts` catalog for `/flow/v1/account`
- `app.ft_tokens` + `app.ft_holdings` for FT lists/holdings
- `app.nft_collections` + `app.nft_ownership` for NFT collections/holdings/items
- `app.tx_contracts` + `app.tx_tags` for transaction enrichment
- `app.status_snapshots` for epoch/tokenomics/status caching

## Migration & Backfill

- Migration file: `backend/db/migrations/000002_api_redesign.up.sql` (idempotent)
- Schema mirror updated in `backend/schema_v2.sql`
- Backfill workers:
  - `accounts_worker`
  - `ft_holdings_worker` (run with concurrency=1)
  - `nft_ownership_worker` (run with concurrency=1)
  - `tx_contracts_worker`

## Tests

- **Unit**: `backend/internal/api/v1_handlers_test.go` (RPC mapping for account response)
- **Optional live smoke**: enable in CI later via `RUN_LIVE_RPC_TESTS=1`
- **Integration**: planned (`httptest` + temporary Postgres) for endpoint-by-endpoint verification

## Coverage Matrix (api.json)

| Path | Method | Tags | Handler | Status |
| --- | --- | --- | --- | --- |
| `/accounting/v1/account/{address}` | `GET` | `Accounting` | `handleFlowGetAccount` | `implemented` |
| `/accounting/v1/account/{address}/ft` | `GET` | `Accounting` | `handleFlowAccountFTVaults` | `implemented` |
| `/accounting/v1/account/{address}/ft/transfer` | `GET` | `Accounting` | `handleFlowAccountFTTransfers` | `implemented` |
| `/accounting/v1/account/{address}/nft` | `GET` | `Accounting` | `handleFlowAccountNFTCollections` | `implemented` |
| `/accounting/v1/account/{address}/tax-report` | `GET` | `Accounting` | `handleNotImplemented` | `stubbed-501` |
| `/accounting/v1/account/{address}/transaction` | `GET` | `Accounting` | `handleFlowAccountTransactions` | `implemented` |
| `/accounting/v1/nft/transfer` | `GET` | `Accounting` | `handleFlowNFTTransfers` | `implemented` |
| `/accounting/v1/transaction` | `GET` | `Accounting` | `handleFlowListTransactions` | `implemented` |
| `/accounting/v1/transaction/{id}` | `GET` | `Accounting` | `handleFlowGetTransaction` | `implemented` |
| `/defi/v1/asset` | `GET` | `DeFi` | `handleNotImplemented` | `stubbed-501` |
| `/defi/v1/events` | `GET` | `DeFi` | `handleNotImplemented` | `stubbed-501` |
| `/defi/v1/latest-block` | `GET` | `DeFi` | `handleNotImplemented` | `stubbed-501` |
| `/defi/v1/latest-swap` | `GET` | `DeFi` | `handleNotImplemented` | `stubbed-501` |
| `/defi/v1/pair` | `GET` | `DeFi` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/account` | `GET` | `Flow` | `handleFlowListAccounts` | `implemented` |
| `/flow/v1/account/{address}` | `GET` | `Flow` | `handleFlowGetAccount` | `implemented` |
| `/flow/v1/account/{address}/ft` | `GET` | `Flow` | `handleFlowAccountFTVaults` | `implemented` |
| `/flow/v1/account/{address}/ft/holding` | `GET` | `Flow` | `handleFlowAccountFTHoldings` | `implemented` |
| `/flow/v1/account/{address}/ft/transfer` | `GET` | `Flow` | `handleFlowAccountFTTransfers` | `implemented` |
| `/flow/v1/account/{address}/ft/{token}` | `GET` | `Flow` | `handleFlowAccountFTToken` | `implemented` |
| `/flow/v1/account/{address}/ft/{token}/transfer` | `GET` | `Flow` | `handleFlowAccountFTTokenTransfers` | `implemented` |
| `/flow/v1/account/{address}/nft` | `GET` | `Flow` | `handleFlowAccountNFTCollections` | `implemented` |
| `/flow/v1/account/{address}/nft/{nft_type}` | `GET` | `Flow` | `handleFlowAccountNFTByCollection` | `implemented` |
| `/flow/v1/account/{address}/tax-report` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/account/{address}/transaction` | `GET` | `Flow` | `handleFlowAccountTransactions` | `implemented` |
| `/flow/v1/block` | `GET` | `Flow` | `handleFlowListBlocks` | `implemented` |
| `/flow/v1/block/{height}` | `GET` | `Flow` | `handleFlowGetBlock` | `implemented` |
| `/flow/v1/block/{height}/service-event` | `GET` | `Flow` | `handleFlowBlockServiceEvents` | `implemented` |
| `/flow/v1/block/{height}/transaction` | `GET` | `Flow` | `handleFlowBlockTransactions` | `implemented` |
| `/flow/v1/contract` | `GET` | `Flow` | `handleFlowListContracts` | `implemented` |
| `/flow/v1/contract/{identifier}` | `GET` | `Flow` | `handleFlowGetContract` | `implemented` |
| `/flow/v1/contract/{identifier}/{id}` | `GET` | `Flow` | `handleFlowGetContractVersion` | `implemented` |
| `/flow/v1/evm/token` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/evm/token/{address}` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/evm/transaction` | `GET` | `Flow` | `handleFlowListEVMTransactions` | `implemented` |
| `/flow/v1/evm/transaction/{hash}` | `GET` | `Flow` | `handleFlowGetEVMTransaction` | `implemented` |
| `/flow/v1/ft` | `GET` | `Flow` | `handleFlowListFTTokens` | `implemented` |
| `/flow/v1/ft/transfer` | `GET` | `Flow` | `handleFlowFTTransfers` | `implemented` |
| `/flow/v1/ft/{token}` | `GET` | `Flow` | `handleFlowGetFTToken` | `implemented` |
| `/flow/v1/ft/{token}/account/{address}` | `GET` | `Flow` | `handleFlowAccountFTHoldingByToken` | `implemented` |
| `/flow/v1/ft/{token}/holding` | `GET` | `Flow` | `handleFlowFTHoldingsByToken` | `implemented` |
| `/flow/v1/nft` | `GET` | `Flow` | `handleFlowListNFTCollections` | `implemented` |
| `/flow/v1/nft/transfer` | `GET` | `Flow` | `handleFlowNFTTransfers` | `implemented` |
| `/flow/v1/nft/{nft_type}` | `GET` | `Flow` | `handleFlowGetNFTCollection` | `implemented` |
| `/flow/v1/nft/{nft_type}/holding` | `GET` | `Flow` | `handleFlowNFTHoldingsByCollection` | `implemented` |
| `/flow/v1/nft/{nft_type}/item/{id}` | `GET` | `Flow` | `handleFlowNFTItem` | `implemented` |
| `/flow/v1/node` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/node/{node_id}` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/node/{node_id}/reward/delegation` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/scheduled-transaction` | `GET` | `Flow` | `handleNotImplemented` | `stubbed-501` |
| `/flow/v1/transaction` | `GET` | `Flow` | `handleFlowListTransactions` | `implemented` |
| `/flow/v1/transaction/{id}` | `GET` | `Flow` | `handleFlowGetTransaction` | `implemented` |
| `/staking/v1/account/{address}/ft/transfer` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/account/{address}/transaction` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/delegator` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/epoch/stats` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/epoch/{epoch}/nodes` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/epoch/{epoch}/role/{role}/nodes/aggregate` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/epoch/{epoch}/role/{role}/nodes/count` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/epoch/{epoch}/role/{role}/nodes/grouped` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/ft_transfer/{address}` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/node/{node_id}/event` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/rewards/paid` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/rewards/staking` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/tokenomics` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/transaction/address/{address}` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/staking/v1/transaction/{transaction_id}` | `GET` | `Staking` | `handleNotImplemented` | `stubbed-501` |
| `/status/v1/count` | `GET` | `Status` | `handleStatusCount` | `implemented` |
| `/status/v1/epoch/stat` | `GET` | `Status` | `handleStatusEpochStat` | `implemented` |
| `/status/v1/epoch/status` | `GET` | `Status` | `handleStatusEpochStatus` | `implemented` |
| `/status/v1/flow/stat` | `GET` | `Status` | `handleStatusFlowStat` | `implemented` |
| `/status/v1/stat` | `GET` | `Status` | `handleStatusStat` | `implemented` |
| `/status/v1/stat/{timescale}/trend` | `GET` | `Status` | `handleStatusStatTrend` | `implemented` |
| `/status/v1/tokenomics` | `GET` | `Status` | `handleStatusTokenomics` | `implemented` |
