# Search Preview & Contract Search

## Summary

Add an as-you-type search dropdown to the FlowIndex header search bar. The dropdown handles **all** input types with consistent behavior — deterministic pattern matches show "Quick Match" results, while free-text input triggers fuzzy search across contracts, tokens, and NFT collections via a new unified backend endpoint.

## Goals

- Consistent search UX: every input gets a dropdown preview, no silent jumps
- Resolve ambiguous inputs (e.g., 64 hex could be Cadence tx or EVM tx) by showing options
- Add contract name search (the biggest gap in current search)
- Add FT token and NFT collection name search

## Non-Goals

- Full-text search of contract source code
- Full search results page (can add later via "View all" link)
- Transaction content/memo search

---

## Backend: Unified Search Endpoint

### `GET /flow/v1/search?q={query}&limit={n}`

A single endpoint that queries 3 data sources in parallel (goroutines) and returns grouped results.

**Parameters:**
- `q` (required): search query, minimum 2 characters
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

**Query logic per group:**
- `contracts`: `ILIKE '%query%'` on `app.smart_contracts.name`, ordered by `dependent_count DESC`, limit 3
- `tokens`: `ILIKE '%query%'` on `app.ft_tokens.symbol` and `app.ft_tokens.name`, limit 3
- `nft_collections`: `ILIKE '%query%'` on `app.nft_collections` name fields, limit 3

**Implementation location:**
- Handler: `backend/internal/api/v1_handlers_search.go` (new file)
- Route registration: `backend/internal/api/routes_registration.go`
- Repository: new `SearchAll()` method in `backend/internal/repository/`

---

## Frontend: SearchDropdown Component

### Two Dropdown Modes

The dropdown operates in two modes based on what the user types:

#### Mode 1: Quick Match (deterministic pattern)

When input matches a known pattern, show 1-2 pre-resolved items immediately. No API call needed (except async resolution for ambiguous cases).

| Input Pattern | Dropdown Shows |
|---|---|
| Pure digits (`/^\d+$/`) | `Block #12345` |
| 128 hex (`/^(0x)?[a-fA-F0-9]{128}$/`) | `Public Key abc...` (resolve associated addresses async) |
| `0x` + 64 hex (`/^0x[a-fA-F0-9]{64}$/`) | `EVM Transaction 0xabc...` |
| 64 hex (`/^[a-fA-F0-9]{64}$/`) | `Cadence Transaction abc...` + `EVM Transaction 0xabc...` |
| 40 hex (`/^(0x)?[a-fA-F0-9]{40}$/`) | `EVM Address (COA) 0xabc...` (resolve Flow address async) |
| 16 hex (`/^(0x)?[a-fA-F0-9]{16}$/`) | `Flow Account 0x1234...` |

For 64-hex and COA inputs, the dropdown shows the option(s) immediately and resolves details async (HEAD check for tx type, COA→Flow address mapping). Results update in-place as resolution completes.

#### Mode 2: Fuzzy Search (free text, >= 2 chars)

When input doesn't match any deterministic pattern, call `GET /flow/v1/search?q={input}` with 300ms debounce.

Results displayed in groups:
1. **Contracts** — name, address (truncated), kind badge (FT/NFT/Contract), dependent count
2. **Tokens** — symbol, name, address, price
3. **NFT Collections** — name, address, item count, NFT badge

Each group shows max 3 results. Search term highlighted in green (`#00ef8b`) within result names.

### Component Structure

**New file:** `frontend/app/components/SearchDropdown.tsx`

**Modifications:** `frontend/app/components/Header.tsx`
- Extract search logic into a custom hook `useSearch()`
- Render `<SearchDropdown>` below the search input
- Remove direct navigation from `handleSearch` — delegate to dropdown selection

**State (all local, no global store):**
- `results`: API response data or quick-match items
- `isOpen`: boolean
- `activeIndex`: number (keyboard navigation)
- `isLoading`: boolean
- `mode`: `'quick-match' | 'fuzzy-search'`

### Interaction

- **Typing**: determines mode, triggers debounced API call (fuzzy) or instant pattern match (quick)
- **`↑` `↓`**: navigate between results, crossing group boundaries
- **`Enter`**: navigate to active (highlighted) result; if no active result, navigate to first result
- **`Esc`**: close dropdown, keep input text
- **Click result**: navigate to that result
- **Click outside / blur**: close dropdown
- **Loading state**: show skeleton placeholders while API responds

### Navigation Targets

| Result Type | Route |
|---|---|
| Block | `/blocks/$height` |
| Cadence Transaction | `/txs/$txId` |
| EVM Transaction | `/txs/evm/$txId` |
| Flow Account | `/accounts/$address` |
| COA (resolved) | `/accounts/$flowAddress` |
| Public Key | `/key/$publicKey` |
| Contract | `/contracts/$address.$name` |
| FT Token | `/tokens` (filtered) |
| NFT Collection | `/nfts/$address.$contractName` |

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
1. `backend/internal/api/v1_handlers_search.go` — `handleSearch()` handler
2. `backend/internal/repository/` — `SearchAll()` method
3. `backend/internal/api/routes_registration.go` — register `GET /flow/v1/search`

### Frontend (new + modified)
1. **New:** `frontend/app/components/SearchDropdown.tsx` — dropdown component
2. **New:** `frontend/app/hooks/useSearch.ts` — search logic hook (debounce, pattern detection, API calls)
3. **Modified:** `frontend/app/components/Header.tsx` — integrate dropdown, replace direct navigation
4. **Modified:** `frontend/app/api.ts` — add `searchAll()` API method

### No schema changes required
All needed tables already exist: `app.smart_contracts`, `app.ft_tokens`, `app.nft_collections`.
