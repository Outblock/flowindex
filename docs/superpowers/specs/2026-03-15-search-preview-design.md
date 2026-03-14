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
GET /flow/search/preview?q={query}&type={tx|address}
```

Note: Uses `/flow/search/preview` (no `/v1/`) to match existing `/flow/search` convention.

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
2. Fire two lookups **in parallel** (goroutines):
   - **Local DB**: `SELECT id, status, block_height, timestamp, authorizers, is_evm FROM raw.transactions WHERE id = $1`. Also check `raw.tx_lookup` for EVM hash → Cadence tx mapping.
   - **Blockscout**: `GET /api/v2/transactions/0x{hash}` with a **2-second timeout**. If Blockscout times out or fails, return `evm: null` (graceful degradation).
3. Build `link` field:
   - If Cadence tx has `is_evm = true`: look up `app.evm_tx_hashes WHERE transaction_id = $1` to get the first EVM hash
   - If EVM hash found in `app.evm_tx_hashes`: resolve to parent Cadence tx ID
   - If a Cadence tx has multiple EVM hashes (multiple `event_index` entries), return only the first one. Multiple EVM executions per Cadence tx are rare; the link is for navigation, not exhaustive listing.

**Value display:** `evm.value` is a raw wei string. Frontend converts to FLOW (divide by 1e18) using existing `formatWei()` from `@/lib/evmUtils`.

**Method display:** `evm.method` comes from Blockscout's decoded function selector. If contract is not verified, Blockscout returns `null` or a raw 4-byte hex. Frontend shows the method name if available, otherwise hides it.

### type=address

Query is an address (16 hex or 40 hex, with or without `0x`).

Response:
```json
{
  "cadence": {
    "address": "0x1654653399040a61",
    "contracts_count": 3,
    "has_keys": true
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
2. Fire lookups **in parallel**:
   - **COA link**: `app.coa_accounts` — check if address has a linked counterpart
   - **Cadence data** (if Flow address or COA-linked Flow address): `SELECT COUNT(*) FROM app.smart_contracts WHERE address = $1` for contracts_count, `SELECT EXISTS(SELECT 1 FROM app.account_keys WHERE address = $1 AND revoked = false)` for has_keys. Note: `app.accounts` does not store balance/keys_count directly — we keep the Cadence preview lightweight with only DB-cheap fields. Full balance requires Flow Access Node RPC which is too slow for preview.
   - **EVM data** (if EVM address or COA-linked EVM address): Blockscout `GET /api/v2/addresses/0x{addr}` with **2-second timeout**. Returns balance, is_contract, tx_count.
3. If COA link found, also fetch the other side's basic info.

**EVM balance display:** Frontend converts wei to FLOW using `formatWei()`.

## Frontend: Search State Changes

### New search mode: `preview`

Add to `SearchState` (preserving all existing fields including `evmResults`):
```typescript
type SearchMode = 'idle' | 'quick-match' | 'fuzzy' | 'preview';

interface TxPreviewData {
  type: 'tx';
  cadence: {
    id: string;
    status: string;
    block_height: number;
    timestamp: string;
    authorizers: string[];
    is_evm: boolean;
  } | null;
  evm: {
    hash: string;
    status: string;
    from: string;
    to: string | null;
    value: string;
    method: string | null;
    block_number: number;
  } | null;
  link: { cadence_tx_id: string; evm_hash: string } | null;
}

interface AddressPreviewData {
  type: 'address';
  cadence: {
    address: string;
    contracts_count: number;
    has_keys: boolean;
  } | null;
  evm: {
    address: string;
    balance: string;
    is_contract: boolean;
    is_verified: boolean;
    tx_count: number;
  } | null;
  coa_link: { flow_address: string; evm_address: string } | null;
}

type PreviewData = TxPreviewData | AddressPreviewData;

interface SearchState {
  mode: SearchMode;
  quickMatches: QuickMatchItem[];
  fuzzyResults: SearchAllResponse | null;
  evmResults: BSSearchItem[];          // preserved from existing implementation
  previewData: PreviewData | null;     // NEW
  previewLoading: boolean;             // NEW
  isLoading: boolean;
  error: string | null;
}
```

### detectPattern changes

Pattern matches that currently return `mode: 'idle'` change to `mode: 'preview'`. Both `EVM_ADDR` (0x-prefixed) and `HEX_40` (bare) patterns collapse to the same behavior:

```
EVM_TX (0x + 64 hex) → mode: 'preview', fire preview API (type=tx)
HEX_64 (64 hex)      → mode: 'preview', fire preview API (type=tx)
EVM_ADDR (0x + 40 hex) → mode: 'preview', fire preview API (type=address)
HEX_40 (40 hex)       → mode: 'preview', fire preview API (type=address)
HEX_16 (16 hex)       → mode: 'preview', fire preview API (type=address)
```

Block height (digits) and public key (128 hex) remain `mode: 'idle'` with direct navigation.

### Preview API call

When mode becomes `preview`, immediately fire (no debounce — pattern is deterministic):
```typescript
const res = await fetch(`${baseUrl}/flow/search/preview?q=${query}&type=${type}`);
```

Show skeleton loading in the dropdown while waiting.

### Enter key during loading

If the user presses Enter while preview is loading, **fall back to direct navigation** (same behavior as current). This preserves the paste-and-Enter workflow. Once preview data arrives, Enter selects the first preview item instead.

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

- Each section is a separate item in `flatItems` (for keyboard ↑↓ navigation)
- Cadence section navigates to `/txs/{cadence_tx_id}`
- EVM section navigates to `/txs/{evm_hash}`
- `[parent]` badge shown when `link` is present (the EVM tx is wrapped by the Cadence tx)
- If only one side found, show only that section
- If neither found, show "Transaction not found" with the hash displayed for copy

### Address Preview Layout

```
┌─────────────────────────────────────────────┐
│ EVM ADDRESS                                 │
│ 0xAbCd...1234  Balance: 1.0 FLOW           │
│ 42 txns  [Contract]               → view   │
├─────────────────────────────────────────────┤
│ LINKED FLOW ADDRESS (COA)                   │
│ 0x1654...0a61                              │
│ 3 contracts                        → view   │
└─────────────────────────────────────────────┘
```

- Primary address shown first, linked address second
- Each section is a separate item in `flatItems`
- COA badge on the linked section
- If no COA link, show only the primary address section
- If address not found at all, show "Address not found"

### Styling

Follow existing SearchDropdown patterns:
- `SectionLabel` for section headers
- Green left border on active/selected item
- Keyboard navigation (↑↓) works across preview sections — each section is one `flatItem`
- Same dark theme (zinc-900 bg, zinc-200 text)
- Skeleton loading: 2 card placeholders while preview loads

## Non-Goals

- Changing fuzzy search behavior
- Adding preview for block height or public key searches
- Direct Blockscout DB connection (use existing API proxy for now; can switch to DB later)
- Caching preview results (queries are unique hashes/addresses — cache hit rate would be very low)
- Showing Flow account balance in Cadence preview (requires Flow Access Node RPC, too slow for preview)
- Handling multiple EVM hashes per Cadence tx (return first only; rare edge case)
