# Search Preview & Contract Search

## Summary

Add an as-you-type search dropdown to the FlowIndex header search bar for **fuzzy text searches** (contract names, token names, NFT collection names). Deterministic pattern matches (tx hashes, addresses, block heights) keep their current direct-jump behavior. The only exception is ambiguous 64-hex input, which shows a dropdown to let the user choose between Cadence tx and EVM tx.

## Goals

- Add contract name search (the biggest gap in current search)
- Add FT token and NFT collection name search via dropdown preview
- Resolve the 64-hex ambiguity (Cadence tx vs EVM tx) by showing both options
- Keep deterministic searches fast — no extra clicks for hash/address lookups

## Non-Goals

- Full-text search of contract source code
- Full search results page (can add later via "View all" link)
- Transaction content/memo search
- Dropdown for unambiguous deterministic matches (blocks, addresses, public keys)

---

## Backend: Unified Search Endpoint

### `GET /flow/search?q={query}&limit={n}`

Route registered as `/flow/search` (no `/v1/` — consistent with all other backend routes). Frontend calls via the Axios API client which handles the `/v1/` prefix stripping.

A single endpoint that queries 3 data sources in parallel (goroutines) and returns grouped results.

**Parameters:**
- `q` (required): search query, minimum 2 characters, maximum 100 characters
- `limit` (optional): max results per group, default 3, max 5

**Response:**
```json
{
  "data": {
    "contracts": [
      {
        "address": "1654653399040a61",
        "name": "FlowToken",
        "kind": "FT",
        "dependent_count": 42
      }
    ],
    "tokens": [
      {
        "symbol": "FLOW",
        "name": "FlowToken",
        "address": "1654653399040a61",
        "price": 0.72
      }
    ],
    "nft_collections": [
      {
        "name": "FlowverseItems",
        "address": "9212a87501a8a6a2",
        "contract_name": "FlowverseItems",
        "item_count": 2847
      }
    ]
  }
}
```

Empty groups are returned as empty arrays (all three keys always present).

**Query logic per group:**
- `contracts`: `ILIKE '%query%'` on `app.smart_contracts.name`, ordered by `dependent_count DESC`, limit 3
- `tokens`: `ILIKE '%query%'` on `app.ft_tokens.symbol` and `app.ft_tokens.name`, limit 3
- `nft_collections`: `ILIKE '%query%'` on `app.nft_collections` name fields, limit 3

**Performance note:** These tables are small (hundreds to low thousands of rows), so `ILIKE` with leading wildcard is acceptable without trigram indexes. If tables grow significantly, add `pg_trgm` GIN indexes later.

**Caching:** Wrap handler with `cachedHandler()` (30s TTL) to reduce DB load from repeated keystrokes.

**Implementation location:**
- Handler: `backend/internal/api/v1_handlers_search.go` (new file)
- Route registration: `backend/internal/api/routes_registration.go`
- Repository: new `SearchAll()` method in `backend/internal/repository/`

---

## Frontend: SearchDropdown Component

### Behavior by Input Type

```
User types text
  ├─ Matches deterministic pattern (unambiguous)
  │   → NO dropdown, Enter direct-jumps (current behavior preserved)
  │   ├─ /^\d+$/                    → /blocks/$height
  │   ├─ /^(0x)?[a-fA-F0-9]{128}$/ → /key/$publicKey
  │   ├─ /^0x[a-fA-F0-9]{64}$/     → /txs/evm/$txId
  │   ├─ /^(0x)?[a-fA-F0-9]{40}$/  → COA resolve → /accounts/$address
  │   ├─ /^(0x)?[a-fA-F0-9]{16}$/  → /accounts/$address
  │   └─ starts with 0x (other)    → /accounts/$address
  │
  ├─ 64 hex (ambiguous — could be Cadence or EVM tx)
  │   → Dropdown with 2 options:
  │       • Cadence Transaction {hash}
  │       • EVM Transaction 0x{hash}
  │   → Enter selects first (Cadence), or user picks EVM
  │
  └─ Free text (>= 2 chars, not matching any pattern above)
      → 300ms debounce → call GET /flow/search?q={input}
      → Dropdown with grouped results (Contracts / Tokens / NFTs)
```

**Short hex-prefixed inputs** (e.g., `0xAB` — doesn't match any length pattern): treated as free text, triggers fuzzy search. If no results, dropdown shows "No results found".

### Dropdown Modes

#### Ambiguous Match (64 hex only)

Shows exactly 2 items — Cadence tx and EVM tx — with no API call. User picks one.

#### Fuzzy Search (free text)

Results displayed in groups:
1. **Contracts** — name, address (truncated), kind badge (FT/NFT/Contract), dependent count
2. **Tokens** — symbol, name, address, price
3. **NFT Collections** — name, address, item count, NFT badge

Each group shows max 3 results. Search term highlighted in green (`#00ef8b`) within result names.

### Component Structure

**New file:** `frontend/app/components/SearchDropdown.tsx`

**New file:** `frontend/app/hooks/useSearch.ts` — search logic hook (debounce, pattern detection, API calls)

**Modified:** `frontend/app/components/Header.tsx`
- Integrate `<SearchDropdown>` below the search input
- Keep existing `handleSearch` for deterministic Enter-to-jump
- Add: when 64 hex is entered and dropdown is open, Enter navigates to active dropdown item instead of doing HEAD check

**Modified:** `frontend/app/api.ts` — add `searchAll()` API method

**State (all local, no global store):**
- `results`: API response data or ambiguous-match items
- `isOpen`: boolean
- `activeIndex`: number (keyboard navigation)
- `isLoading`: boolean
- `error`: boolean (API failure state)

### Interaction

- **Typing**: determines mode, triggers debounced API call (fuzzy) or shows ambiguous options (64 hex)
- **`↑` `↓`**: navigate between results, crossing group boundaries
- **`Enter`**: if dropdown open with active item → navigate to that item; otherwise → existing direct-jump behavior
- **`Esc`**: close dropdown, keep input text
- **Click result**: navigate to that result
- **Click outside / blur**: close dropdown
- **Loading state**: show skeleton placeholders while API responds
- **Error state**: show "Search unavailable" message, auto-dismiss after 3s. Do not retry automatically.
- **No results**: show "No results found for '{query}'"

### Navigation Targets

| Result Type | Route | Param Format |
|---|---|---|
| Block | `/blocks/$height` | `"12345"` |
| Cadence Transaction | `/txs/$txId` | `"abc123..."` |
| EVM Transaction | `/txs/evm/$txId` | `"0xabc123..."` |
| Flow Account | `/accounts/$address` | `"0x1654653399040a61"` |
| COA (resolved) | `/accounts/$address` | resolved Flow address |
| Public Key | `/key/$publicKey` | `"abc123..."` (128 hex) |
| Contract | `/contracts/$id` | `"A.1654653399040a61.FlowToken"` (Cadence identifier) |
| FT Token | `/tokens/$token` | `"A.1654653399040a61.FlowToken"` |
| NFT Collection | `/nfts/$nftType` | `"A.9212a87501a8a6a2.FlowverseItems"` |

### Visual Design

- Dropdown: `position: absolute`, below search input, same width
- Background: `#111`, border `rgba(255,255,255, 0.1)`, shadow `0 8px 32px rgba(0,0,0,0.6)`
- Group headers: uppercase label + divider line
- Active item: left green border + subtle green background
- Type badges: FT (green), Contract (gray), NFT (purple)
- Footer: keyboard shortcut hints + result count
- Placeholder updated to: `"Search by block / tx / address / contract name"`

---

## Summary of Changes

### Backend (new files)
1. `backend/internal/api/v1_handlers_search.go` — `handleSearch()` handler, wrapped with `cachedHandler(30s)`
2. `backend/internal/repository/` — `SearchAll()` method (3 parallel queries)
3. `backend/internal/api/routes_registration.go` — register `GET /flow/search`

### Frontend (new + modified)
1. **New:** `frontend/app/components/SearchDropdown.tsx` — dropdown component
2. **New:** `frontend/app/hooks/useSearch.ts` — search logic hook (debounce, pattern detection, API calls)
3. **Modified:** `frontend/app/components/Header.tsx` — integrate dropdown, add 64-hex ambiguity handling
4. **Modified:** `frontend/app/api.ts` — add `searchAll()` API method

### No schema changes required
All needed tables already exist: `app.smart_contracts`, `app.ft_tokens`, `app.nft_collections`.
