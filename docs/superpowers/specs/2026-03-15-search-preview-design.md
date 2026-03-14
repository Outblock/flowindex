# Search Preview Panel

**Date:** 2026-03-15
**Status:** Draft

## Problem

When searching for tx hashes or addresses, the search bar immediately navigates without showing any preview. Users can't see cross-chain relationships (EVM tx → parent Cadence tx, COA → linked Flow address) before clicking.

## Goal

Replace direct-navigation pattern matches with a preview panel inside the existing SearchDropdown. Show summaries with cross-chain relationships so users can choose which view to open.

## Constraints

- Do not change fuzzy search behavior (text search like "flow" already has good dropdown UX)
- Do not change block height or public key search (keep direct navigation)
- Preview data must load fast (<500ms) — single API call, not multiple parallel fetches
- Reuse existing SearchDropdown component and styling patterns

## Scope

| Pattern | Current Behavior | New Behavior |
|---------|-----------------|-------------|
| `0x` + 64 hex (EVM tx) | Direct nav to `/txs/evm/` | Preview: Cadence tx + EVM tx with parent link |
| 64 hex (ambiguous tx) | Quick-match (two bare options) | Preview: Cadence tx + EVM tx with summaries |
| `0x` + 40 hex (EVM addr) | Direct nav to `/accounts/` | Preview: EVM address info + COA linked Flow address |
| 40 hex (bare EVM addr) | Direct nav to `/accounts/` | Same as above |
| 16 hex (Flow addr) | Direct nav to `/accounts/` | Preview: Flow address info + COA linked EVM address |
| Pure digits (block) | Direct nav to `/blocks/` | **No change** |
| 128 hex (public key) | Direct nav to `/key/` | **No change** |

## Backend: Unified Preview Endpoint

```
GET /flow/v1/search/preview?q={query}&type={tx|address}
```

### type=tx

Query is a tx hash (64 hex, with or without `0x`). Backend normalizes.

Response:
```json
{
  "cadence": {
    "id": "abc...def",
    "status": "SEALED",
    "block_height": 12345,
    "timestamp": "2026-03-15T10:00:00Z",
    "authorizers": ["0x1654653399040a61"],
    "is_evm": true
  },
  "evm": {
    "hash": "0xabc...def",
    "status": "ok",
    "from": "0x...",
    "to": "0x...",
    "value": "1000000000000000000",
    "method": "transfer",
    "block_number": 67890
  },
  "link": {
    "cadence_tx_id": "abc...def",
    "evm_hash": "0xabc...def"
  }
}
```

All top-level fields are nullable. `link` is present when a Cadence tx wraps an EVM execution (or vice versa — an EVM hash resolves to a parent Cadence tx).

**Backend logic:**
1. Normalize hash: strip `0x`, lowercase
2. Query local DB: `SELECT id, status, block_height, timestamp, authorizers, is_evm FROM raw.transactions WHERE id = $1` (also check `raw.tx_lookup` for EVM hash mapping)
3. Query Blockscout: `GET /api/v2/transactions/0x{hash}` (via existing proxy, or direct DB if configured)
4. If EVM hash found in `app.evm_tx_hashes`, resolve to parent Cadence tx ID for the `link` field
5. If Cadence tx has `is_evm = true`, look up EVM hash from `app.evm_tx_hashes` for the `link` field

### type=address

Query is an address (16 hex or 40 hex, with or without `0x`).

Response:
```json
{
  "cadence": {
    "address": "0x1654653399040a61",
    "balance": "100.50000000",
    "keys_count": 2,
    "contracts_count": 3
  },
  "evm": {
    "address": "0xAbCd...1234",
    "balance": "1000000000000000000",
    "is_contract": false,
    "is_verified": false,
    "tx_count": 42
  },
  "coa_link": {
    "flow_address": "0x1654653399040a61",
    "evm_address": "0x000000000000000000000002AbCd1234"
  }
}
```

All top-level fields are nullable. `coa_link` is present when a COA mapping exists.

**Backend logic:**
1. Detect address type by length (16 hex = Flow, 40 hex = EVM)
2. If Flow address: query `app.accounts` for balance/keys/contracts, then `app.coa_accounts` for linked EVM address
3. If EVM address: query Blockscout `/api/v2/addresses/0x{addr}` for balance/contract/tx_count, then `app.coa_accounts` for linked Flow address
4. If COA link found, also fetch the other side's basic info (Flow account or EVM address)

## Frontend: Search State Changes

### New search mode: `preview`

Add to `SearchState`:
```typescript
type SearchMode = 'idle' | 'quick-match' | 'fuzzy' | 'preview';

interface PreviewData {
  type: 'tx' | 'address';
  cadence: TxPreview | AddressPreview | null;
  evm: EVMTxPreview | EVMAddressPreview | null;
  link: TxLink | COALink | null;
}

interface SearchState {
  mode: SearchMode;
  // ... existing fields ...
  previewData: PreviewData | null;
  previewLoading: boolean;
}
```

### detectPattern changes

Pattern matches that currently return `mode: 'idle'` change to `mode: 'preview'`:

```
EVM_TX (0x + 64 hex) → mode: 'preview', fire preview API (type=tx)
HEX_64 (64 hex)      → mode: 'preview', fire preview API (type=tx)
EVM_ADDR (0x + 40 hex) → mode: 'preview', fire preview API (type=address)
HEX_40 (40 hex)       → mode: 'preview', fire preview API (type=address)
HEX_16 (16 hex)       → mode: 'preview', fire preview API (type=address)
```

Block height (digits) and public key (128 hex) remain `mode: 'idle'` with direct navigation.

### Preview API call

When mode becomes `preview`, immediately fire:
```typescript
const res = await fetch(`${baseUrl}/flow/v1/search/preview?q=${query}&type=${type}`);
```

Show skeleton loading in the dropdown while waiting. No debounce needed (pattern is deterministic).

## Frontend: SearchDropdown Preview Rendering

### TX Preview Layout

```
┌─────────────────────────────────────────────┐
│ CADENCE TRANSACTION                         │
│ 🟢 SEALED  Block #12,345  3m ago           │
│ abc123...def456                   → view    │
├─────────────────────────────────────────────┤
│ EVM TRANSACTION                    [parent] │
│ ✓ Success  transfer()  1.0 FLOW            │
│ 0xabc...def → 0x123...456        → view    │
└─────────────────────────────────────────────┘
```

- Each section is a clickable row (navigates to `/txs/{id}` or `/txs/{evmHash}`)
- `[parent]` badge shown when the EVM tx is wrapped by the Cadence tx (or vice versa)
- If only one side found, show only that section
- If neither found, show "Transaction not found"

### Address Preview Layout

```
┌─────────────────────────────────────────────┐
│ EVM ADDRESS                                 │
│ 0xAbCd...1234  Balance: 1.0 FLOW           │
│ 42 txns  [Contract]               → view   │
├─────────────────────────────────────────────┤
│ LINKED FLOW ADDRESS (COA)                   │
│ 0x1654...0a61  Balance: 100.5 FLOW         │
│ 2 keys  3 contracts               → view   │
└─────────────────────────────────────────────┘
```

- Primary address shown first, linked address second
- COA badge on the linked section
- If no COA link, show only the primary address section
- If address not found at all, show "Address not found"

### Styling

Follow existing SearchDropdown patterns:
- `SectionLabel` for section headers
- Green left border on active/selected item
- Keyboard navigation (↑↓) works across preview sections
- Same dark theme (zinc-900 bg, zinc-200 text)
- Skeleton loading: 2 card placeholders while preview loads

## Non-Goals

- Changing fuzzy search behavior
- Adding preview for block height or public key searches
- Direct Blockscout DB connection (use existing API proxy for now; can switch to DB later)
- Caching preview results (queries are unique hashes/addresses)
