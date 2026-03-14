# EVM Account & Transaction Detail Pages

**Date:** 2026-03-15
**Status:** Draft

## Problem

FlowIndex currently shows EVM data only as a sub-tab of Cadence transactions (EVM Execution tab). There are no dedicated pages for EVM addresses (EOA/COA) or EVM transaction details. Users who interact with Flow EVM have to go to the separate Blockscout instance (evm.flowindex.io) for full EVM data.

## Goal

Add native EVM account detail, transaction detail, and activity pages to FlowIndex — so users can explore EOA, COA, and EVM contract addresses and transactions without leaving the site.

## Constraints

- **Do not break existing Cadence experience.** All current Cadence account/tx pages remain unchanged. EVM is purely additive.
- **Use existing Blockscout API proxy.** We have an unlimited API key. No DB direct-connect needed initially.
- **Reuse existing UI primitives.** DataTable, Pagination, AddressDisplay, COABadge, CopyButton, etc.

## Architecture

### Data Flow

```
Frontend → Go Backend (proxy) → Blockscout API (self-hosted, unlimited key)
                ↓
        Local DB (coa_accounts, evm_contracts) for enrichment
```

No new database tables. No data migration. The backend acts as a thin proxy to Blockscout's `/api/v2/` endpoints, with optional enrichment from local tables (COA mapping, ABI decode).

### Backend: New Proxy Routes

Add to `blockscout_proxy.go` — all are transparent pass-throughs to Blockscout `/api/v2/`. Use `/flow/evm/transaction/` consistently (matching existing routes, NOT `/flow/evm/tx/`).

**Address endpoints:**
| FlowIndex Route | Blockscout Upstream |
|---|---|
| `GET /flow/evm/address/{addr}` | `/api/v2/addresses/{addr}` |
| `GET /flow/evm/address/{addr}/transactions` | `/api/v2/addresses/{addr}/transactions` |
| `GET /flow/evm/address/{addr}/internal-transactions` | `/api/v2/addresses/{addr}/internal-transactions` |
| `GET /flow/evm/address/{addr}/token-transfers` | `/api/v2/addresses/{addr}/token-transfers` |

**Transaction sub-resource endpoints** (extend existing `/flow/evm/transaction/{hash}`):
| FlowIndex Route | Blockscout Upstream |
|---|---|
| `GET /flow/evm/transaction/{hash}/internal-transactions` | `/api/v2/transactions/{hash}/internal-transactions` |
| `GET /flow/evm/transaction/{hash}/logs` | `/api/v2/transactions/{hash}/logs` |
| `GET /flow/evm/transaction/{hash}/token-transfers` | `/api/v2/transactions/{hash}/token-transfers` |

**Search endpoint:**
| FlowIndex Route | Blockscout Upstream |
|---|---|
| `GET /flow/evm/search?q=` | `/api/v2/search?q=` |

**Existing routes unchanged:**
- `GET /flow/evm/transaction` (list) — already exists
- `GET /flow/evm/transaction/{hash}` (detail) — already exists
- `GET /flow/evm/token` — already exists
- `GET /flow/evm/address/{addr}/token` — already exists, serves as alias for `/tokens`

### Backend: Enrichment

For detail endpoints only (not lists), the Go handler enriches Blockscout responses **in-place** by adding fields:
- **COA detection:** On `GET /flow/evm/address/{addr}`, check `coa_accounts` table. If found, add `"flow_address": "0x..."` field to response JSON.
- **ABI decode:** For `GET /flow/evm/transaction/{hash}`, use local `evm_contracts.abi` to decode input data (existing logic in `postgres_evm_metadata.go` and `evm_calldata.go`). Add `"decoded_input"` field if ABI available.

List endpoints are pure pass-through — no enrichment, no DB queries.

## Frontend Design

### Routing Strategy

Reuse existing routes (`/accounts/$address`, `/txs/$txId`). Detect address/hash type and render different components. The detection logic lives inside the existing route component loaders, which need modification to add EVM branches.

### Address Type Detection

The existing `accounts/$address.tsx` loader needs a new branch. Currently it only handles Cadence addresses and COA redirect. The new logic:

```
Input address → normalizeAddress() → strip 0x → hexOnly

if hexOnly.length <= 16:
  → Cadence address → existing CadenceAccountPage (NO CHANGES)

if hexOnly.length == 40:
  → EVM address → EVMAccountPage
  → Additionally, fire GET /flow/v1/coa/{addr} as side query
    → if COA found: enrich header with Flow address link + COA badge
    → if not COA: show as plain EOA or contract
```

**Key change:** All 40-hex addresses route to EVMAccountPage. COA is an enrichment on top, not a separate routing branch. The old "10+ leading zeros" heuristic is removed. The `coa_accounts` table is the authoritative source for COA detection.

### TX Hash Detection

In `txs/$txId.tsx`, use format-based routing to avoid waterfall latency:

```
Input hash → normalize

if hash matches /^0x[0-9a-fA-F]{64}$/:
  → Could be either Cadence or EVM. Fire both requests in parallel:
    → GET /flow/v1/transaction/{hash}
    → GET /flow/evm/transaction/{hash}
  → Render whichever succeeds first. If both succeed, prefer Cadence (it's the canonical view).
  → If neither → 404

if hash is 64 hex without 0x prefix:
  → Cadence tx ID → existing CadenceTxDetail (NO CHANGES)
```

Note: Cadence tx IDs are typically 64 hex without `0x`. EVM hashes always have `0x`. In practice, most lookups will be unambiguous. The parallel strategy handles the overlap case without double latency.

### Page Layouts

#### EVMAccountPage

```
┌─────────────────────────────────────────────────┐
│ AddressHeader                                   │
│  0xAbCd...1234  [Copy] [EOA|Contract badge]     │
│  Balance: 1.23 FLOW  |  Txns: 456              │
│  (if COA) ↔ Flow Address: 0x1234abcd [Link]    │
├─────────────────────────────────────────────────┤
│ [Transactions] [Internal Txs] [Token Transfers] │
│ [Token Holdings] [Contract]                     │
├─────────────────────────────────────────────────┤
│  (Tab Content — DataTable + Load More)          │
└─────────────────────────────────────────────────┘
```

Tabs:
- **Transactions** — EVM tx list (from/to/value/gas/status). DataTable with "Load More" button.
- **Internal Txs** — Internal transactions. DataTable showing type/call_type/from/to/value/gas.
- **Token Transfers** — ERC-20/721/1155 transfers. Filterable by type.
- **Token Holdings** — Current token balances from `address_current_token_balances`.
- **Contract** — Only shown if `is_contract`. Display verified source and ABI. Interactive read/write is a stretch goal.

#### COAAccountPage

```
┌─────────────────────────────────────────────────┐
│ COA Header                                      │
│  Flow: 0x1234abcd [Link]  ↔  EVM: 0xAbCd…1234  │
├─────────────────────────────────────────────────┤
│ [Cadence ▾]  [EVM ▾]                            │
│  Cadence: Activity | Tokens | NFTs | Keys | ... │
│  EVM: Transactions | Internal | Transfers | ... │
├─────────────────────────────────────────────────┤
│  (Tab Content)                                  │
└─────────────────────────────────────────────────┘
```

Two tab groups. Cadence tabs render existing components (unchanged). EVM tabs render the same components as EVMAccountPage.

#### EVMTxDetail

```
┌─────────────────────────────────────────────────┐
│ EVM Transaction                                 │
│  Hash: 0xabc...def [Copy]                       │
│  Status: Success | Block: 12345 | Timestamp     │
├─────────────────────────────────────────────────┤
│ Overview                                        │
│  From: 0x... → To: 0x...                        │
│  Value: 1.0 FLOW  |  Gas Used: 21000 / 50000   │
│  Input Data: transfer(addr, uint256) [Decoded]  │
├─────────────────────────────────────────────────┤
│ [Internal Txs (3)] [Logs (5)] [Token Transfers] │
├─────────────────────────────────────────────────┤
│  (Tab Content)                                  │
└─────────────────────────────────────────────────┘
```

Tabs:
- **Internal Txs** — Call tree with indentation based on `trace_address` depth. Shows type, from, to, value, gas.
- **Logs** — Event logs with topic decode (using local ABI when available).
- **Token Transfers** — ERC-20/721/1155 transfers within this transaction.

### Pagination Strategy

Blockscout uses cursor-based pagination (`next_page_params` object), not offset/limit. The existing FlowIndex `Pagination` component assumes page numbers.

**Decision:** EVM tables use a **"Load More" button** pattern instead of page numbers. This maps naturally to cursor-based pagination:
- Initial load fetches first page.
- "Load More" appends `next_page_params` as query parameters to fetch the next page.
- Results accumulate in the table.

This avoids building a page-number abstraction on top of cursors. A new `LoadMorePagination` component wraps this pattern, reusable across all EVM tables.

### Search Enhancement

Existing search in `useSearch.ts` has a pattern-detection pipeline that short-circuits on deterministic matches (hex patterns). Integration:

- **Hex pattern queries** (40-hex address, 64-hex hash): Already detected by `useSearch.ts`. Add a parallel Blockscout lookup alongside the existing Cadence lookup. For addresses, hit `/flow/evm/address/{addr}`. For tx hashes, hit `/flow/evm/transaction/{hash}`.
- **Free-text queries**: Fire `/flow/evm/search?q=` in parallel with the existing local `/flow/search?q=`. Blockscout returns `{ items: [...] }` — transform to match local search result shape in a `mapBlockscoutSearchResult()` helper.
- **Display**: Local results render first (faster). EVM results append when ready, each with an `[EVM]` badge. Blockscout timeout (>2s) shows local results only.

### Error & Loading States

- **Blockscout down**: EVM components show an inline error banner ("EVM data temporarily unavailable"). Cadence pages are never affected — EVM errors are contained within EVM components only.
- **Loading**: EVM components use skeleton loaders (matching existing FlowIndex skeleton patterns).
- **Partial failure**: If enrichment fails (COA lookup, ABI decode) but Blockscout data loaded, show the page without enrichment. Never block the page on enrichment.

### TypeScript Types

Generate types from Blockscout's OpenAPI spec (available at `evm.flowindex.io/api-docs`). Place in `frontend/app/api/gen/blockscout/` alongside existing generated types. Key interfaces needed:

- `BSAddress` — address detail (hash, balance, tx_count, is_contract, token, etc.)
- `BSTransaction` — transaction detail (hash, from/to, value, gas, status, block, input, decoded_input, etc.)
- `BSInternalTransaction` — internal tx (type, call_type, from/to, value, gas, trace_address, error)
- `BSTokenTransfer` — token transfer (from/to, token, amount, token_id, type)
- `BSLog` — event log (index, address, topics, data, decoded)
- `BSTokenBalance` — address token balance (token, value, token_id)
- `BSSearchResult` — search result item

### External Link Migration

The codebase has 15+ hardcoded references to `evm.flowindex.io` (in COABadge, TransactionRow, txs/$txId, etc.). Once EVM pages are live, migrate these to internal routes:
- `evm.flowindex.io/address/{addr}` → `/accounts/{addr}`
- `evm.flowindex.io/tx/{hash}` → `/txs/{hash}`

**Deferred to post-launch.** Ship EVM pages first, then update links in a follow-up PR.

### New Frontend Components

| Component | Purpose | Reuses |
|---|---|---|
| `EVMAccountPage` | EVM address overview + tabs | AddressDisplay, COABadge, CopyButton |
| `COAAccountPage` | Dual Cadence+EVM view | Existing Cadence tabs + EVM tabs |
| `EVMAccountOverview` | Balance, tx count, contract info | AddressDisplay |
| `EVMTransactionList` | Address tx history table | DataTable, LoadMorePagination, AddressDisplay, TimeAgo |
| `EVMInternalTxList` | Internal txs table | DataTable, LoadMorePagination |
| `EVMTokenTransfers` | Token transfer history | DataTable, LoadMorePagination |
| `EVMTokenHoldings` | Current token balances | DataTable |
| `EVMTxDetail` | EVM transaction detail page | StatusBadge, AddressDisplay, CopyButton |
| `EVMLogsList` | Transaction event logs | DataTable |
| `LoadMorePagination` | Cursor-based pagination control | Button |

### Data Format

Frontend consumes Blockscout `/api/v2/` JSON format directly (no transformation). Key format notes:
- Addresses: `"0x..."` hex strings
- Values: string representations of wei (use `formatEther()` from viem/ethers for display)
- Hashes: `"0x..."` hex strings
- Timestamps: ISO 8601 strings
- Pagination: `next_page_params` object — pass as query params to fetch next page

## Non-Goals (This Phase)

- **Direct Blockscout DB access** — Use API proxy for now. Switch to DB later if performance requires.
- **Contract read/write UI** — Showing verified source + ABI is in scope. Interactive read/write methods is a stretch goal.
- **EVM block detail page** — Not needed; Flow blocks already show EVM execution.
- **EVM token detail page** — Existing `/flow/evm/token/{address}` proxy may suffice; dedicated page deferred.
- **External link migration** — Updating hardcoded `evm.flowindex.io` links to internal routes. Do in follow-up PR.

## Risks

- **Blockscout API availability** — If Blockscout is down, EVM pages fail. Mitigation: inline error banner, Cadence pages unaffected.
- **Blockscout pagination format** — Cursor-based, not page numbers. Mitigation: use "Load More" pattern with `LoadMorePagination` component.
- **Blockscout response shape changes** — API v2 may change across Blockscout upgrades. Mitigation: generated TypeScript types catch breaking changes at build time.
