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

Add to `blockscout_proxy.go` — all are transparent pass-throughs to Blockscout `/api/v2/`:

**Address endpoints:**
| FlowIndex Route | Blockscout Upstream |
|---|---|
| `GET /flow/evm/address/{addr}` | `/api/v2/addresses/{addr}` |
| `GET /flow/evm/address/{addr}/transactions` | `/api/v2/addresses/{addr}/transactions` |
| `GET /flow/evm/address/{addr}/internal-transactions` | `/api/v2/addresses/{addr}/internal-transactions` |
| `GET /flow/evm/address/{addr}/token-transfers` | `/api/v2/addresses/{addr}/token-transfers` |
| `GET /flow/evm/address/{addr}/tokens` | `/api/v2/addresses/{addr}/tokens` |

**Transaction endpoints:**
| FlowIndex Route | Blockscout Upstream |
|---|---|
| `GET /flow/evm/tx/{hash}` | `/api/v2/transactions/{hash}` |
| `GET /flow/evm/tx/{hash}/internal-transactions` | `/api/v2/transactions/{hash}/internal-transactions` |
| `GET /flow/evm/tx/{hash}/logs` | `/api/v2/transactions/{hash}/logs` |
| `GET /flow/evm/tx/{hash}/token-transfers` | `/api/v2/transactions/{hash}/token-transfers` |

**Search endpoint:**
| FlowIndex Route | Blockscout Upstream |
|---|---|
| `GET /flow/evm/search?q=` | `/api/v2/search?q=` |

**Existing routes unchanged:**
- `GET /flow/evm/transaction` (list) — already exists
- `GET /flow/evm/transaction/{hash}` (detail) — already exists
- `GET /flow/evm/token` — already exists
- `GET /flow/evm/address/{addr}/token` — already exists

### Backend: Enrichment

For address endpoints, the Go handler optionally enriches Blockscout responses:
- **COA detection:** Check `coa_accounts` table — if EVM address is a COA, attach `flow_address` to the response.
- **ABI decode:** For tx detail and logs, use local `evm_contracts.abi` to decode input data and log topics (existing `evm_execution_enrichment.go` logic).

## Frontend Design

### Routing Strategy

Reuse existing routes (`/accounts/$address`, `/txs/$txId`). Detect address/hash type and render different components. **No new route files needed** — logic lives inside existing route components.

### Address Type Detection

Already partially implemented in `accounts/$address.tsx`:

```
Input address → normalizeAddress()
  → 16 hex chars (0x + 16) → Cadence → existing CadenceAccountPage (NO CHANGES)
  → 40 hex chars + 10+ leading zeros → COA
      → GET /flow/v1/coa/{addr} → found → COAAccountPage (dual view)
      → not found → EVMAccountPage
  → 40 hex chars (other) → EOA or Contract → EVMAccountPage
```

### TX Hash Detection

In `txs/$txId.tsx`:

```
Input hash
  → Try local API: GET /flow/v1/transaction/{hash} → found → CadenceTxDetail (NO CHANGES)
  → Not found → Try: GET /flow/evm/tx/{hash} → found → EVMTxDetail (new)
  → Neither → 404
```

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
│  (Tab Content — DataTable + Pagination)         │
└─────────────────────────────────────────────────┘
```

Tabs:
- **Transactions** — EVM tx list (from/to/value/gas/status). DataTable with pagination.
- **Internal Txs** — Internal transactions. DataTable showing type/call_type/from/to/value/gas.
- **Token Transfers** — ERC-20/721/1155 transfers. Filterable by type.
- **Token Holdings** — Current token balances from `address_current_token_balances`.
- **Contract** — Only shown if `is_contract`. Display verified source, ABI, read/write methods (stretch goal).

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

### Search Enhancement

Existing search (`/flow/search?q=`) queries local DB only. Enhancement:
- Fire a parallel request to `/flow/evm/search?q=` (Blockscout search proxy).
- Merge results into the search dropdown.
- EVM results display with an `[EVM]` badge to distinguish from Cadence results.

### New Frontend Components

| Component | Purpose | Reuses |
|---|---|---|
| `EVMAccountPage` | EVM address overview + tabs | AddressDisplay, COABadge, CopyButton |
| `COAAccountPage` | Dual Cadence+EVM view | Existing Cadence tabs + EVM tabs |
| `EVMAccountOverview` | Balance, tx count, contract info | AddressDisplay |
| `EVMTransactionList` | Address tx history table | DataTable, Pagination, AddressDisplay, TimeAgo |
| `EVMInternalTxList` | Internal txs table | DataTable, Pagination |
| `EVMTokenTransfers` | Token transfer history | DataTable, Pagination |
| `EVMTokenHoldings` | Current token balances | DataTable |
| `EVMTxDetail` | EVM transaction detail page | StatusBadge, AddressDisplay, CopyButton |
| `EVMLogsList` | Transaction event logs | DataTable |

### Data Format

Frontend consumes Blockscout `/api/v2/` JSON format directly (no transformation). Key format notes:
- Addresses: `"0x..."` hex strings
- Values: string representations of wei
- Hashes: `"0x..."` hex strings
- Timestamps: ISO 8601 strings
- Pagination: Blockscout uses cursor-based pagination (`next_page_params` object)

## Non-Goals (This Phase)

- **Direct Blockscout DB access** — Use API proxy for now. Switch to DB later if performance requires.
- **Contract read/write UI** — Showing verified source + ABI is in scope. Interactive read/write methods is a stretch goal.
- **EVM block detail page** — Not needed; Flow blocks already show EVM execution.
- **EVM token detail page** — Existing `/flow/evm/token/{address}` proxy may suffice; dedicated page deferred.

## Risks

- **Blockscout API availability** — If Blockscout is down, EVM pages fail. Mitigation: show graceful error state, Cadence pages unaffected.
- **Blockscout pagination format** — Uses cursor-based pagination (`next_page_params`), different from FlowIndex's offset/limit. Frontend EVM components must handle this.
- **COA detection edge cases** — The "10+ leading zeros" heuristic may have false positives. Should validate against `coa_accounts` table as authoritative source.
