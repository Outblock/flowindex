# Workflow Builder Enhancements — Design

## Goal
Replace hardcoded node config options with dynamic, searchable selectors backed by real blockchain data. Add contract event discovery and preset workflow templates.

## Part 1: Dynamic Data Selectors

### Problem
NFT collections (5), FT tokens (7), event subtypes, and contract events are all hardcoded or free-text in `nodeTypes.ts`. Users can't discover what's available.

### Solution
New `SearchableSelect` component in `NodeConfigPanel` that fetches from existing backend APIs.

**Data source mapping:**

| Config field | Current | New source |
|---|---|---|
| NFT collection | 5 hardcoded | `GET /flow/nft?search=` |
| FT token_contract | 7 hardcoded | `GET /flow/ft?search=` |
| Contract Event → contract_address | Free text | `GET /flow/contract?search=` |
| Contract Event → event_names | Free text | New: `GET /flow/contract/{id}/events` |
| Account Event → subtypes | Free text | Static list: account.created, key.added, key.removed, contract.added, contract.updated, contract.removed |

### SearchableSelect component
- Debounced text input (300ms)
- Fetches matching results from API
- Shows icon + name + contract identifier
- Caches results in memory (5 min TTL)
- Falls back to free-text if API unavailable

### New Backend API
```
GET /flow/contract/{identifier}/events
→ [{ event_name: string, count: number, last_seen: timestamp }]
```
Query: `SELECT event_name, count(*), max(block_timestamp) FROM raw.events WHERE contract_address = $1 GROUP BY event_name ORDER BY count DESC`

## Part 2: Contract Event Discovery (Dual Path)

### Path A: Contract → Events
1. User searches contract in `contract_address` field
2. System loads that contract's event types via `/flow/contract/{id}/events`
3. `event_names` field becomes a multi-select checkbox list

### Path B: Event Name → Contracts
1. User types event name (e.g. "Deposit") in `event_names` field
2. Dropdown shows matching `contract.EventName` entries from events table
3. Selecting auto-fills `contract_address`

### New Backend API for Path B
```
GET /flow/events/search?name=Deposit
→ [{ type: "A.0x123.TopShot.Deposit", contract_address: "0x123", contract_name: "TopShot", event_name: "Deposit", count: number }]
```
Query: `SELECT type, contract_address, event_name, count(*) FROM raw.events WHERE event_name ILIKE $1 GROUP BY type, contract_address, event_name ORDER BY count DESC LIMIT 20`

### Field Linkage
When one field changes, the other updates:
- Set contract → load its events into event_names options
- Set event → auto-fill contract_address

## Part 3: Workflow Templates

### UI Location
Workflow list page (`subscriptions.index.tsx`), above the "New Workflow" button.

### Template Structure
```typescript
interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'whale' | 'project' | 'personal'
  icon: LucideIcon
  nodes: Array<{ id: string; type: string; data: any }>
  edges: Array<{ source: string; target: string; sourceHandle?: string }>
  placeholders: string[] // fields user must fill (e.g. "webhook_url", "addresses")
}
```

### Preset Templates

**Whale Monitoring:**
1. Large FLOW Transfer Alert → FT Transfer (FLOW, min: 100,000) → Discord
2. Large USDC Transfer Alert → FT Transfer (USDC, min: 50,000) → Slack
3. Whale Address Activity → TX Sealed (configurable addresses) → Email

**Project Monitoring:**
4. Contract Deploy Notification → Account Event (contract.added) → Discord
5. TopShot Trade Monitor → NFT Transfer (TopShot collection) → Webhook
6. Staking Changes → Contract Event (FlowIDTableStaking events) → Telegram

**Personal Alerts:**
7. Low Balance Warning → Balance Change (my address) → IF (< threshold) → Email
8. NFT Received → NFT Transfer (my address, direction: in) → Discord
9. Daily Balance Report → Schedule (cron: 0 9 * * *) → Webhook

### Template UX
- Grid of template cards with icon, name, description
- Click → creates new workflow pre-populated with template nodes/edges
- Opens editor with placeholder fields highlighted (pulse animation)
- User fills in their webhook URLs, addresses, thresholds → Save

## Part 4: AI System Prompt Update

Update `aiGenerate.ts` system prompt to reference dynamic data:
- Remove hardcoded token/collection lists from prompt
- Instead, tell AI to use descriptive names and let the user refine via the searchable selectors
- AI still generates the node structure, user fine-tunes config values

## Implementation Order

1. **Backend APIs** — new contract events + event search endpoints
2. **SearchableSelect component** — reusable async search dropdown
3. **NodeConfigPanel integration** — wire up dynamic selectors for NFT, FT, Contract, Events
4. **Contract event dual-path** — field linkage between contract and events
5. **Workflow templates** — template data + UI on list page
6. **AI prompt update** — simplify prompt, remove hardcoded lists
