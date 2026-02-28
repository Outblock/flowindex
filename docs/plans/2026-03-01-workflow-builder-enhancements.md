# Workflow Builder Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded workflow node config options with dynamic searchable selectors, add contract event discovery, and preset workflow templates.

**Architecture:** Add 2 new backend API endpoints for event discovery. Create a reusable `SearchableSelect` frontend component that fetches from existing `/flow/ft`, `/flow/nft`, `/flow/contract` APIs. Upgrade `NodeConfigPanel` to use dynamic selectors. Add template gallery to workflow list page.

**Tech Stack:** Go (backend API), React + TypeScript (frontend), TailwindCSS, Lucide icons, existing `webhookApi.ts` pattern for API calls.

---

### Task 1: Backend — Contract Event Types Endpoint

**Files:**
- Modify: `backend/internal/api/routes_registration.go`
- Modify: `backend/internal/api/v1_handlers_contracts.go`
- Modify: `backend/internal/repository/query_v2.go`

**Step 1: Add repository method**

In `backend/internal/repository/query_v2.go`, add at the end:

```go
type ContractEventType struct {
	Type         string
	EventName    string
	Count        int64
	LastSeen     time.Time
}

func (r *Repository) GetContractEventTypes(ctx context.Context, contractAddress, contractName string, limit int) ([]ContractEventType, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT type, event_name, count(*) as cnt, max(block_timestamp) as last_seen
		FROM raw.events
		WHERE contract_address = $1 AND type LIKE $2
		GROUP BY type, event_name
		ORDER BY cnt DESC
		LIMIT $3
	`
	pattern := "A." + contractAddress + "." + contractName + ".%"
	rows, err := r.pool.Query(ctx, query, contractAddress, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []ContractEventType
	for rows.Next() {
		var et ContractEventType
		if err := rows.Scan(&et.Type, &et.EventName, &et.Count, &et.LastSeen); err != nil {
			return nil, err
		}
		results = append(results, et)
	}
	return results, rows.Err()
}
```

**Step 2: Add handler**

In `backend/internal/api/v1_handlers_contracts.go`, add:

```go
func (s *Server) handleContractEventTypes(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address, name, _ := splitContractIdentifier(vars["identifier"])
	if address == "" || name == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid contract identifier")
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	events, err := s.repo.GetContractEventTypes(r.Context(), address, name, limit)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to query event types")
		return
	}

	data := make([]map[string]interface{}, len(events))
	for i, e := range events {
		data[i] = map[string]interface{}{
			"type":       e.Type,
			"event_name": e.EventName,
			"count":      e.Count,
			"last_seen":  e.LastSeen,
		}
	}
	writeAPIResponse(w, data, map[string]interface{}{"count": len(data)}, nil)
}
```

**Step 3: Register route**

In `backend/internal/api/routes_registration.go`, add after the existing contract routes:

```go
r.HandleFunc("/flow/contract/{identifier}/events", s.handleContractEventTypes).Methods("GET", "OPTIONS")
```

**Step 4: Commit**

```bash
git add backend/internal/repository/query_v2.go backend/internal/api/v1_handlers_contracts.go backend/internal/api/routes_registration.go
git commit -m "feat(api): add contract event types discovery endpoint"
```

---

### Task 2: Backend — Event Name Search Endpoint

**Files:**
- Modify: `backend/internal/api/routes_registration.go`
- Modify: `backend/internal/api/v1_handlers_contracts.go`
- Modify: `backend/internal/repository/query_v2.go`

**Step 1: Add repository method**

In `backend/internal/repository/query_v2.go`, add:

```go
type EventSearchResult struct {
	Type            string
	ContractAddress string
	ContractName    string
	EventName       string
	Count           int64
}

func (r *Repository) SearchEventsByName(ctx context.Context, name string, limit int) ([]EventSearchResult, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	query := `
		SELECT type, contract_address,
		       split_part(type, '.', 3) as contract_name,
		       event_name, count(*) as cnt
		FROM raw.events
		WHERE event_name ILIKE $1
		GROUP BY type, contract_address, event_name
		ORDER BY cnt DESC
		LIMIT $2
	`
	rows, err := r.pool.Query(ctx, query, "%"+name+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []EventSearchResult
	for rows.Next() {
		var e EventSearchResult
		if err := rows.Scan(&e.Type, &e.ContractAddress, &e.ContractName, &e.EventName, &e.Count); err != nil {
			return nil, err
		}
		results = append(results, e)
	}
	return results, rows.Err()
}
```

**Step 2: Add handler**

In `backend/internal/api/v1_handlers_contracts.go`, add:

```go
func (s *Server) handleSearchEvents(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		writeAPIError(w, http.StatusBadRequest, "name parameter required")
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	events, err := s.repo.SearchEventsByName(r.Context(), name, limit)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to search events")
		return
	}

	data := make([]map[string]interface{}, len(events))
	for i, e := range events {
		data[i] = map[string]interface{}{
			"type":             e.Type,
			"contract_address": formatAddressV1(e.ContractAddress),
			"contract_name":    e.ContractName,
			"event_name":       e.EventName,
			"count":            e.Count,
		}
	}
	writeAPIResponse(w, data, map[string]interface{}{"count": len(data)}, nil)
}
```

**Step 3: Register route**

In `backend/internal/api/routes_registration.go`:

```go
r.HandleFunc("/flow/events/search", s.handleSearchEvents).Methods("GET", "OPTIONS")
```

**Step 4: Commit**

```bash
git add backend/internal/repository/query_v2.go backend/internal/api/v1_handlers_contracts.go backend/internal/api/routes_registration.go
git commit -m "feat(api): add event name search endpoint"
```

---

### Task 3: Frontend — SearchableSelect Component

**Files:**
- Create: `frontend/app/components/developer/workflow/SearchableSelect.tsx`

**Step 1: Create component**

```tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, X, Loader2 } from 'lucide-react'

interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
  icon?: string // URL for icon/logo
}

interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  fetchOptions: (query: string) => Promise<SearchableSelectOption[]>
  placeholder?: string
  debounceMs?: number
}

export default function SearchableSelect({
  value,
  onChange,
  fetchOptions,
  placeholder = 'Search...',
  debounceMs = 300,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchableSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Load initial options and resolve selected label
  useEffect(() => {
    fetchOptions('').then((opts) => {
      setOptions(opts)
      if (value) {
        const match = opts.find((o) => o.value === value)
        if (match) setSelectedLabel(match.label)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(async () => {
        setLoading(true)
        try {
          const results = await fetchOptions(q)
          setOptions(results)
        } finally {
          setLoading(false)
        }
      }, debounceMs)
    },
    [fetchOptions, debounceMs],
  )

  function handleSelect(opt: SearchableSelectOption) {
    onChange(opt.value)
    setSelectedLabel(opt.label)
    setQuery('')
    setOpen(false)
  }

  function handleClear() {
    onChange('')
    setSelectedLabel('')
    setQuery('')
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Display selected value or search input */}
      {!open && value ? (
        <div
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          className="flex items-center justify-between w-full px-3 py-2 bg-zinc-50 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded-lg text-sm cursor-pointer hover:border-[#00ef8b]/50 transition-colors"
        >
          <span className="text-zinc-900 dark:text-white truncate">{selectedLabel || value}</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleClear() }}
            className="p-0.5 text-zinc-400 dark:text-neutral-500 hover:text-zinc-700 dark:hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-neutral-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="w-full pl-9 pr-8 py-2 bg-zinc-50 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 animate-spin" />
          )}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-neutral-800 border border-zinc-200 dark:border-neutral-700 rounded-lg shadow-lg">
          {options.length === 0 ? (
            <div className="px-3 py-4 text-xs text-zinc-500 dark:text-neutral-500 text-center">
              {loading ? 'Searching...' : 'No results'}
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-neutral-700 transition-colors"
              >
                {opt.icon && (
                  <img src={opt.icon} alt="" className="w-5 h-5 rounded-full shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-zinc-900 dark:text-white truncate">{opt.label}</div>
                  {opt.sublabel && (
                    <div className="text-xs text-zinc-500 dark:text-neutral-500 truncate font-mono">{opt.sublabel}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/components/developer/workflow/SearchableSelect.tsx
git commit -m "feat(ui): add SearchableSelect component for dynamic config fields"
```

---

### Task 4: Frontend — API Fetch Functions for Selectors

**Files:**
- Create: `frontend/app/components/developer/workflow/fetchOptions.ts`

**Step 1: Create fetch helpers**

These functions call existing backend APIs and transform responses into `SearchableSelectOption[]` format.

```typescript
const API_URL = import.meta.env.VITE_API_URL || ''

interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
  icon?: string
}

// Simple in-memory cache
const cache = new Map<string, { data: SearchableSelectOption[]; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 min

async function cachedFetch(key: string, fetcher: () => Promise<SearchableSelectOption[]>): Promise<SearchableSelectOption[]> {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
  const data = await fetcher()
  cache.set(key, { data, ts: Date.now() })
  return data
}

export async function fetchFTTokens(query: string): Promise<SearchableSelectOption[]> {
  const url = query
    ? `${API_URL}/flow/ft?search=${encodeURIComponent(query)}&limit=20`
    : `${API_URL}/flow/ft?limit=30`
  return cachedFetch(`ft:${query}`, async () => {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    const tokens = json.data ?? []
    return [
      { value: '', label: 'Any Token' },
      ...tokens.map((t: any) => ({
        value: `A.${t.address?.replace('0x', '')}.${t.contract_name}`,
        label: t.symbol || t.name || t.contract_name,
        sublabel: `A.${t.address?.replace('0x', '')}.${t.contract_name}`,
        icon: t.logo || undefined,
      })),
    ]
  })
}

export async function fetchNFTCollections(query: string): Promise<SearchableSelectOption[]> {
  const url = query
    ? `${API_URL}/flow/nft?search=${encodeURIComponent(query)}&limit=20`
    : `${API_URL}/flow/nft?limit=30`
  return cachedFetch(`nft:${query}`, async () => {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    const collections = json.data ?? []
    return [
      { value: '', label: 'Any Collection' },
      ...collections.map((c: any) => ({
        value: `A.${c.address?.replace('0x', '')}.${c.contract_name}`,
        label: c.display_name || c.name || c.contract_name,
        sublabel: `A.${c.address?.replace('0x', '')}.${c.contract_name}`,
        icon: c.square_image || undefined,
      })),
    ]
  })
}

export async function fetchContracts(query: string): Promise<SearchableSelectOption[]> {
  if (!query || query.length < 2) {
    return []
  }
  const url = `${API_URL}/flow/contract?body=${encodeURIComponent(query)}&limit=15`
  return cachedFetch(`contract:${query}`, async () => {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    const contracts = json.data ?? []
    return contracts.map((c: any) => ({
      value: c.identifier || `A.${c.address?.replace('0x', '')}.${c.name}`,
      label: c.name,
      sublabel: c.identifier || `${c.address}.${c.name}`,
      icon: c.token_logo || undefined,
    }))
  })
}

export async function fetchContractEvents(contractIdentifier: string): Promise<SearchableSelectOption[]> {
  if (!contractIdentifier) return []
  const url = `${API_URL}/flow/contract/${encodeURIComponent(contractIdentifier)}/events?limit=50`
  return cachedFetch(`events:${contractIdentifier}`, async () => {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    const events = json.data ?? []
    return events.map((e: any) => ({
      value: e.event_name,
      label: e.event_name,
      sublabel: `${e.count} occurrences`,
    }))
  })
}

export async function fetchEventsByName(query: string): Promise<SearchableSelectOption[]> {
  if (!query || query.length < 2) return []
  const url = `${API_URL}/flow/events/search?name=${encodeURIComponent(query)}&limit=20`
  return cachedFetch(`eventsearch:${query}`, async () => {
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    const events = json.data ?? []
    return events.map((e: any) => ({
      value: e.type,
      label: `${e.contract_name}.${e.event_name}`,
      sublabel: `${e.contract_address} · ${e.count} events`,
    }))
  })
}
```

**Step 2: Commit**

```bash
git add frontend/app/components/developer/workflow/fetchOptions.ts
git commit -m "feat(ui): add API fetch functions for dynamic workflow selectors"
```

---

### Task 5: Frontend — Upgrade NodeConfigPanel with Dynamic Selectors

**Files:**
- Modify: `frontend/app/components/developer/workflow/NodeConfigPanel.tsx`
- Modify: `frontend/app/components/developer/workflow/nodeTypes.ts`
- Modify: `frontend/app/components/developer/workflow/constants.ts`

**Step 1: Add `searchable` field type to ConfigFieldDef**

In `nodeTypes.ts`, update the `ConfigFieldDef` interface:

```typescript
export interface ConfigFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'searchable'  // add 'searchable'
  placeholder?: string
  options?: Array<string | { value: string; label: string }>
  isArray?: boolean
  fetchFn?: string  // key for fetch function: 'ft_tokens' | 'nft_collections' | 'contracts' | 'contract_events' | 'events_search'
  linkedField?: string  // field key that this field depends on (for contract→events linkage)
}
```

**Step 2: Update node type definitions to use `searchable` type**

In `nodeTypes.ts`, change the relevant config fields:

For `trigger_ft_transfer` and `trigger_balance_change`, change `token_contract` field:
```typescript
{ key: 'token_contract', label: 'Token', type: 'searchable', fetchFn: 'ft_tokens', placeholder: 'Search tokens...' },
```

For `trigger_nft_transfer`, change `collection` field:
```typescript
{ key: 'collection', label: 'Collection', type: 'searchable', fetchFn: 'nft_collections', placeholder: 'Search NFT collections...' },
```

For `trigger_contract_event`, change both fields:
```typescript
{ key: 'contract_address', label: 'Contract', type: 'searchable', fetchFn: 'contracts', placeholder: 'Search contracts...' },
{ key: 'event_names', label: 'Event Names', type: 'searchable', fetchFn: 'contract_events', linkedField: 'contract_address', placeholder: 'Select events...' },
```

For `trigger_account_event`, change `subtypes` to a select with preset options:
```typescript
{
  key: 'subtypes', label: 'Subtypes', type: 'select',
  options: [
    { value: 'account.created', label: 'Account Created' },
    { value: 'key.added', label: 'Key Added' },
    { value: 'key.removed', label: 'Key Removed' },
    { value: 'contract.added', label: 'Contract Deployed' },
    { value: 'contract.updated', label: 'Contract Updated' },
    { value: 'contract.removed', label: 'Contract Removed' },
  ],
},
```

**Step 3: Remove hardcoded constants**

In `constants.ts`, remove `FT_TOKENS` and `NFT_COLLECTIONS` arrays (keep `COLORS`). Update `nodeTypes.ts` to remove their imports.

**Step 4: Update NodeConfigPanel to render SearchableSelect**

In `NodeConfigPanel.tsx`, add the import and rendering logic:

```typescript
import SearchableSelect from './SearchableSelect'
import { fetchFTTokens, fetchNFTCollections, fetchContracts, fetchContractEvents, fetchEventsByName } from './fetchOptions'

// Map fetchFn strings to actual functions
const FETCH_FN_MAP: Record<string, (query: string) => Promise<any[]>> = {
  ft_tokens: fetchFTTokens,
  nft_collections: fetchNFTCollections,
  contracts: fetchContracts,
  events_search: fetchEventsByName,
}
```

In the config field rendering, add a case for `type === 'searchable'`:

```tsx
{field.type === 'searchable' ? (
  <SearchableSelect
    value={config[field.key] ?? ''}
    onChange={(val) => onConfigChange(field.key, val)}
    fetchOptions={
      field.fetchFn === 'contract_events'
        ? (q) => fetchContractEvents(config[field.linkedField ?? ''] || '')
        : FETCH_FN_MAP[field.fetchFn ?? ''] ?? (() => Promise.resolve([]))
    }
    placeholder={field.placeholder}
  />
) : field.type === 'select' ? (
  // ... existing select code
```

**Step 5: Commit**

```bash
git add frontend/app/components/developer/workflow/NodeConfigPanel.tsx frontend/app/components/developer/workflow/nodeTypes.ts frontend/app/components/developer/workflow/constants.ts
git commit -m "feat(ui): integrate dynamic searchable selectors into workflow config panel"
```

---

### Task 6: Frontend — Workflow Templates

**Files:**
- Create: `frontend/app/components/developer/workflow/templates.ts`
- Modify: `frontend/app/routes/developer/subscriptions.index.tsx`

**Step 1: Create template definitions**

```typescript
import { Waves, DollarSign, Shield, FileCode, Image, Landmark, Wallet, Package, Clock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'whale' | 'project' | 'personal'
  icon: LucideIcon
  nodes: Array<{
    id: string
    type: string
    data: { nodeType: string; config: Record<string, string> }
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
  }>
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // — Whale Monitoring —
  {
    id: 'whale_flow',
    name: 'Large FLOW Transfer',
    description: 'Alert when FLOW transfers exceed 100,000',
    category: 'whale',
    icon: Waves,
    nodes: [
      { id: 'node_1', type: 'trigger_ft_transfer', data: { nodeType: 'trigger_ft_transfer', config: { addresses: '', direction: 'both', token_contract: 'A.1654653399040a61.FlowToken', min_amount: '100000' } } },
      { id: 'node_2', type: 'dest_discord', data: { nodeType: 'dest_discord', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'whale_usdc',
    name: 'Large USDC Transfer',
    description: 'Alert when USDC transfers exceed 50,000',
    category: 'whale',
    icon: DollarSign,
    nodes: [
      { id: 'node_1', type: 'trigger_ft_transfer', data: { nodeType: 'trigger_ft_transfer', config: { addresses: '', direction: 'both', token_contract: 'A.b19436aae4d94622.FiatToken', min_amount: '50000' } } },
      { id: 'node_2', type: 'dest_slack', data: { nodeType: 'dest_slack', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'whale_activity',
    name: 'Whale Address Activity',
    description: 'Monitor transactions from/to specific addresses',
    category: 'whale',
    icon: Shield,
    nodes: [
      { id: 'node_1', type: 'trigger_tx_sealed', data: { nodeType: 'trigger_tx_sealed', config: { addresses: '', roles: 'PROPOSER,PAYER,AUTHORIZER' } } },
      { id: 'node_2', type: 'dest_email', data: { nodeType: 'dest_email', config: { to: '', subject: 'Whale Activity Alert' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  // — Project Monitoring —
  {
    id: 'contract_deploy',
    name: 'Contract Deploy Notification',
    description: 'Get notified when new contracts are deployed',
    category: 'project',
    icon: FileCode,
    nodes: [
      { id: 'node_1', type: 'trigger_account_event', data: { nodeType: 'trigger_account_event', config: { addresses: '', subtypes: 'contract.added' } } },
      { id: 'node_2', type: 'dest_discord', data: { nodeType: 'dest_discord', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'nft_topshot',
    name: 'TopShot Trade Monitor',
    description: 'Track NBA Top Shot NFT transfers',
    category: 'project',
    icon: Image,
    nodes: [
      { id: 'node_1', type: 'trigger_nft_transfer', data: { nodeType: 'trigger_nft_transfer', config: { addresses: '', collection: 'A.0b2a3299cc857e29.TopShot', direction: 'both' } } },
      { id: 'node_2', type: 'dest_webhook', data: { nodeType: 'dest_webhook', config: { url: '', method: 'POST' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'staking_changes',
    name: 'Staking Changes',
    description: 'Monitor FlowIDTableStaking contract events',
    category: 'project',
    icon: Landmark,
    nodes: [
      { id: 'node_1', type: 'trigger_contract_event', data: { nodeType: 'trigger_contract_event', config: { contract_address: '0x8624b52f9ddcd04a', event_names: 'DelegatorTokensCommitted,DelegatorRewardTokensWithdrawn' } } },
      { id: 'node_2', type: 'dest_telegram', data: { nodeType: 'dest_telegram', config: { bot_token: '', chat_id: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  // — Personal Alerts —
  {
    id: 'low_balance',
    name: 'Low Balance Warning',
    description: 'Alert when FLOW balance drops below threshold',
    category: 'personal',
    icon: Wallet,
    nodes: [
      { id: 'node_1', type: 'trigger_balance_change', data: { nodeType: 'trigger_balance_change', config: { addresses: '', token_contract: 'A.1654653399040a61.FlowToken', min_amount: '0' } } },
      { id: 'node_2', type: 'condition_if', data: { nodeType: 'condition_if', config: { field: 'amount', operator: '<', value: '1000' } } },
      { id: 'node_3', type: 'dest_email', data: { nodeType: 'dest_email', config: { to: '', subject: 'Low FLOW Balance Alert' } } },
    ],
    edges: [
      { source: 'node_1', target: 'node_2' },
      { source: 'node_2', target: 'node_3', sourceHandle: 'true' },
    ],
  },
  {
    id: 'nft_received',
    name: 'NFT Received',
    description: 'Notify when your address receives any NFT',
    category: 'personal',
    icon: Package,
    nodes: [
      { id: 'node_1', type: 'trigger_nft_transfer', data: { nodeType: 'trigger_nft_transfer', config: { addresses: '', collection: '', direction: 'in' } } },
      { id: 'node_2', type: 'dest_discord', data: { nodeType: 'dest_discord', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'daily_report',
    name: 'Daily Balance Report',
    description: 'Send daily balance check via webhook',
    category: 'personal',
    icon: Clock,
    nodes: [
      { id: 'node_1', type: 'trigger_schedule', data: { nodeType: 'trigger_schedule', config: { cron: '0 9 * * *', timezone: 'UTC' } } },
      { id: 'node_2', type: 'dest_webhook', data: { nodeType: 'dest_webhook', config: { url: '', method: 'POST' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
]

export const TEMPLATE_CATEGORIES = [
  { key: 'whale' as const, label: 'Whale Monitoring', emoji: '🐋' },
  { key: 'project' as const, label: 'Project Monitoring', emoji: '📡' },
  { key: 'personal' as const, label: 'Personal Alerts', emoji: '🔔' },
]
```

**Step 2: Add template gallery to subscriptions.index.tsx**

Import templates and add a gallery section between the header and workflow list. When clicked, call `createWorkflow()` with the template name and canvas JSON (nodes with auto-layout positions + edges), then navigate to the editor.

Add imports:
```typescript
import { WORKFLOW_TEMPLATES, TEMPLATE_CATEGORIES } from '../../components/developer/workflow/templates'
```

Add handler:
```typescript
async function handleUseTemplate(template: typeof WORKFLOW_TEMPLATES[0]) {
  setCreating(true)
  try {
    // Auto-layout: place nodes left-to-right
    const layoutedNodes = template.nodes.map((n, i) => ({
      ...n,
      position: { x: 100 + i * 280, y: 150 },
    }))
    const edges = template.edges.map((e, i) => ({
      id: `edge_${i}`,
      ...e,
      animated: true,
      style: { stroke: '#525252', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed', color: '#525252', width: 16, height: 16 },
    }))
    const wf = await createWorkflow(template.name, { nodes: layoutedNodes, edges })
    navigate({ to: '/developer/subscriptions/$id', params: { id: wf.id } })
  } catch {
    setCreating(false)
  }
}
```

Add template gallery JSX before the workflow list `<div>`:
```tsx
{/* Templates */}
<div className="space-y-4">
  <h2 className="text-sm font-semibold text-zinc-500 dark:text-neutral-400 uppercase tracking-wider">Templates</h2>
  {TEMPLATE_CATEGORIES.map((cat) => (
    <div key={cat.key}>
      <p className="text-xs text-zinc-500 dark:text-neutral-500 mb-2">{cat.emoji} {cat.label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {WORKFLOW_TEMPLATES.filter((t) => t.category === cat.key).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => handleUseTemplate(t)}
              disabled={creating}
              className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-neutral-800/50 border border-zinc-200 dark:border-neutral-800 rounded-lg hover:border-[#00ef8b]/40 hover:bg-zinc-100 dark:hover:bg-neutral-800 transition-colors text-left disabled:opacity-50"
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-neutral-700 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-zinc-600 dark:text-neutral-300" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-white">{t.name}</p>
                <p className="text-xs text-zinc-500 dark:text-neutral-500 mt-0.5">{t.description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  ))}
</div>
```

**Step 3: Commit**

```bash
git add frontend/app/components/developer/workflow/templates.ts frontend/app/routes/developer/subscriptions.index.tsx
git commit -m "feat(ui): add workflow template gallery with 9 presets"
```

---

### Task 7: Update AI System Prompt

**Files:**
- Modify: `frontend/app/components/developer/workflow/aiGenerate.ts`

**Step 1: Simplify the system prompt**

Remove hardcoded token/collection lists from the `buildNodeCatalog()` output. For `token_contract` and `collection` fields, instead of listing all options, just describe the format:

In the `buildNodeCatalog()` function, where it builds the options string, add a special case:

```typescript
if (f.key === 'token_contract') {
  desc += ' [format: A.<address>.<ContractName>, e.g. A.1654653399040a61.FlowToken for FLOW, A.b19436aae4d94622.FiatToken for USDC]'
} else if (f.key === 'collection') {
  desc += ' [format: A.<address>.<ContractName>, e.g. A.0b2a3299cc857e29.TopShot for NBA Top Shot]'
} else if (f.options) {
  // existing options handling
}
```

This keeps the AI prompt smaller and avoids it going stale as new tokens/collections are added.

**Step 2: Commit**

```bash
git add frontend/app/components/developer/workflow/aiGenerate.ts
git commit -m "feat(ai): simplify system prompt, remove hardcoded token/collection lists"
```

---

### Task 8: Push to Main

**Step 1: Merge and push**

```bash
git fetch origin main
git merge origin/main --no-edit
git push origin ai-bun-migration:main
```
