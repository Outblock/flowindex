# Search Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct-navigation pattern matches with a preview panel in the search dropdown — showing cross-chain relationships (EVM tx ↔ parent Cadence tx, COA ↔ linked Flow address).

**Architecture:** New Go backend endpoint `GET /flow/search/preview` performs parallel local DB + Blockscout lookups and returns unified preview data. Frontend `useSearch` hook gets a new `preview` mode that fires this endpoint for pattern matches instead of directly navigating. `SearchDropdown` renders preview cards with summaries.

**Tech Stack:** Go (Gorilla Mux), React 19, TanStack Router, TypeScript, TailwindCSS

**Spec:** `docs/superpowers/specs/2026-03-15-search-preview-design.md`

### Import Conventions (reference for all tasks)

```typescript
// CopyButton
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
// Relative time
import { formatRelativeTime } from '@/lib/time';
// EVM utils
import { formatWei, truncateHash } from '@/lib/evmUtils';
// API base URL
import { resolveApiBaseUrl } from '@/api';
```

---

## Chunk 1: Backend Preview Endpoint

### Task 1: Add Search Preview Handler

**Files:**
- Create: `backend/internal/api/v1_handlers_search_preview.go`
- Modify: `backend/internal/api/routes_registration.go`

- [ ] **Step 1: Create the preview handler file**

Create `backend/internal/api/v1_handlers_search_preview.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// --- Response types ---

type SearchPreviewResponse struct {
	Cadence  interface{} `json:"cadence"`
	EVM      interface{} `json:"evm"`
	Link     interface{} `json:"link"`
	COALink  interface{} `json:"coa_link,omitempty"`
}

type CadenceTxPreview struct {
	ID          string   `json:"id"`
	Status      string   `json:"status"`
	BlockHeight uint64   `json:"block_height"`
	Timestamp   string   `json:"timestamp"`
	Authorizers []string `json:"authorizers"`
	IsEVM       bool     `json:"is_evm"`
}

type EVMTxPreview struct {
	Hash        string  `json:"hash"`
	Status      string  `json:"status"`
	From        string  `json:"from"`
	To          *string `json:"to"`
	Value       string  `json:"value"`
	Method      *string `json:"method"`
	BlockNumber uint64  `json:"block_number"`
}

type TxLink struct {
	CadenceTxID string `json:"cadence_tx_id"`
	EVMHash     string `json:"evm_hash"`
}

type CadenceAddressPreview struct {
	Address        string `json:"address"`
	ContractsCount int    `json:"contracts_count"`
	HasKeys        bool   `json:"has_keys"`
}

type EVMAddressPreview struct {
	Address    string `json:"address"`
	Balance    string `json:"balance"`
	IsContract bool   `json:"is_contract"`
	IsVerified bool   `json:"is_verified"`
	TxCount    int    `json:"tx_count"`
}

type COALink struct {
	FlowAddress string `json:"flow_address"`
	EVMAddress  string `json:"evm_address"`
}

// --- Handler ---

func (s *Server) handleSearchPreview(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeAPIError(w, http.StatusInternalServerError, "repository unavailable")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	typ := strings.TrimSpace(r.URL.Query().Get("type"))

	if q == "" || (typ != "tx" && typ != "address") {
		writeAPIError(w, http.StatusBadRequest, "q and type (tx|address) required")
		return
	}

	// Normalize: strip 0x, lowercase
	normalized := strings.ToLower(strings.TrimPrefix(q, "0x"))

	switch typ {
	case "tx":
		s.handleTxPreview(w, r, normalized)
	case "address":
		s.handleAddressPreview(w, r, normalized, q)
	}
}

func (s *Server) handleTxPreview(w http.ResponseWriter, r *http.Request, hash string) {
	ctx := r.Context()
	resp := SearchPreviewResponse{}

	var wg sync.WaitGroup
	var mu sync.Mutex

	// 1. Local DB: try to find Cadence tx
	wg.Add(1)
	go func() {
		defer wg.Done()
		tx, err := s.repo.GetTransactionByID(ctx, hash)
		if err != nil || tx == nil {
			return
		}
		authorizers := []string{}
		if tx.Authorizers != nil {
			for _, a := range tx.Authorizers {
				authorizers = append(authorizers, "0x"+a)
			}
		}
		mu.Lock()
		resp.Cadence = &CadenceTxPreview{
			ID:          tx.ID,
			Status:      tx.Status,
			BlockHeight: tx.BlockHeight,
			Timestamp:   tx.Timestamp.Format(time.RFC3339),
			Authorizers: authorizers,
			IsEVM:       tx.IsEVM,
		}
		// If this Cadence tx has EVM execution, look up EVM hash
		if tx.IsEVM {
			var evmHash string
			err := s.repo.DB().QueryRow(ctx,
				"SELECT encode(evm_hash, 'hex') FROM app.evm_tx_hashes WHERE transaction_id = decode($1, 'hex') LIMIT 1",
				hash,
			).Scan(&evmHash)
			if err == nil && evmHash != "" {
				resp.Link = &TxLink{CadenceTxID: hash, EVMHash: "0x" + evmHash}
			}
		}
		mu.Unlock()
	}()

	// 2. Local DB: check if this hash is an EVM hash mapped to a Cadence tx
	wg.Add(1)
	go func() {
		defer wg.Done()
		var cadenceTxID string
		err := s.repo.DB().QueryRow(ctx,
			"SELECT encode(transaction_id, 'hex') FROM app.evm_tx_hashes WHERE evm_hash = decode($1, 'hex') LIMIT 1",
			hash,
		).Scan(&cadenceTxID)
		if err == nil && cadenceTxID != "" {
			mu.Lock()
			// Only set link if not already set by the Cadence lookup
			if resp.Link == nil {
				resp.Link = &TxLink{CadenceTxID: cadenceTxID, EVMHash: "0x" + hash}
			}
			mu.Unlock()
		}
	}()

	// 3. Blockscout: try to find EVM tx (with 2s timeout)
	wg.Add(1)
	go func() {
		defer wg.Done()
		bsCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()

		target := s.blockscoutURL + "/api/v2/transactions/0x" + hash
		req, err := http.NewRequestWithContext(bsCtx, "GET", target, nil)
		if err != nil {
			return
		}
		req.Header.Set("Accept", "application/json")

		bsResp, err := blockscoutClient.Do(req)
		if err != nil || bsResp.StatusCode != 200 {
			if bsResp != nil {
				bsResp.Body.Close()
			}
			return
		}
		defer bsResp.Body.Close()

		body, err := io.ReadAll(bsResp.Body)
		if err != nil {
			return
		}

		var parsed map[string]interface{}
		if json.Unmarshal(body, &parsed) != nil {
			return
		}

		preview := &EVMTxPreview{
			Hash:   "0x" + hash,
			Status: stringVal(parsed, "status"),
			Value:  stringVal(parsed, "value"),
		}

		if from, ok := parsed["from"].(map[string]interface{}); ok {
			preview.From = stringVal(from, "hash")
		}
		if to, ok := parsed["to"].(map[string]interface{}); ok {
			toHash := stringVal(to, "hash")
			preview.To = &toHash
		}
		if method := stringVal(parsed, "method"); method != "" {
			preview.Method = &method
		}
		if bn, ok := parsed["block_number"].(float64); ok {
			preview.BlockNumber = uint64(bn)
		}

		mu.Lock()
		resp.EVM = preview
		mu.Unlock()
	}()

	wg.Wait()

	// If link was found via EVM hash lookup but Cadence side is missing, fetch it
	if resp.Link != nil && resp.Cadence == nil {
		if link, ok := resp.Link.(*TxLink); ok {
			tx, err := s.repo.GetTransactionByID(ctx, link.CadenceTxID)
			if err == nil && tx != nil {
				authorizers := []string{}
				if tx.Authorizers != nil {
					for _, a := range tx.Authorizers {
						authorizers = append(authorizers, "0x"+a)
					}
				}
				resp.Cadence = &CadenceTxPreview{
					ID:          tx.ID,
					Status:      tx.Status,
					BlockHeight: tx.BlockHeight,
					Timestamp:   tx.Timestamp.Format(time.RFC3339),
					Authorizers: authorizers,
					IsEVM:       tx.IsEVM,
				}
			}
		}
	}

	writeAPIResponse(w, resp, nil, nil)
}

func (s *Server) handleAddressPreview(w http.ResponseWriter, r *http.Request, normalized string, original string) {
	ctx := r.Context()
	resp := SearchPreviewResponse{}

	isFlowAddr := len(normalized) == 16
	isEVMAddr := len(normalized) == 40

	var wg sync.WaitGroup
	var mu sync.Mutex

	// 1. COA link lookup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if isFlowAddr {
			coa, err := s.repo.GetCOAByFlowAddress(ctx, normalized)
			if err == nil && coa != nil {
				mu.Lock()
				resp.COALink = &COALink{
					FlowAddress: "0x" + coa.FlowAddress,
					EVMAddress:  "0x" + coa.COAAddress,
				}
				mu.Unlock()
			}
		} else if isEVMAddr {
			coa, err := s.repo.GetFlowAddressByCOA(ctx, normalized)
			if err == nil && coa != nil {
				mu.Lock()
				resp.COALink = &COALink{
					FlowAddress: "0x" + coa.FlowAddress,
					EVMAddress:  "0x" + coa.COAAddress,
				}
				mu.Unlock()
			}
		}
	}()

	// 2. Cadence address data (if Flow address)
	if isFlowAddr {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var contractsCount int
			s.repo.DB().QueryRow(ctx,
				"SELECT COUNT(*) FROM app.smart_contracts WHERE address = $1", normalized,
			).Scan(&contractsCount)

			var hasKeys bool
			s.repo.DB().QueryRow(ctx,
				"SELECT EXISTS(SELECT 1 FROM app.account_keys WHERE address = $1 AND revoked = false)", normalized,
			).Scan(&hasKeys)

			mu.Lock()
			resp.Cadence = &CadenceAddressPreview{
				Address:        "0x" + normalized,
				ContractsCount: contractsCount,
				HasKeys:        hasKeys,
			}
			mu.Unlock()
		}()
	}

	// 3. EVM address data (if EVM address, via Blockscout with 2s timeout)
	if isEVMAddr {
		wg.Add(1)
		go func() {
			defer wg.Done()
			bsCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()

			target := s.blockscoutURL + "/api/v2/addresses/0x" + normalized
			req, err := http.NewRequestWithContext(bsCtx, "GET", target, nil)
			if err != nil {
				return
			}
			req.Header.Set("Accept", "application/json")

			bsResp, err := blockscoutClient.Do(req)
			if err != nil || bsResp.StatusCode != 200 {
				if bsResp != nil {
					bsResp.Body.Close()
				}
				return
			}
			defer bsResp.Body.Close()

			body, err := io.ReadAll(bsResp.Body)
			if err != nil {
				return
			}

			var parsed map[string]interface{}
			if json.Unmarshal(body, &parsed) != nil {
				return
			}

			preview := &EVMAddressPreview{
				Address:    "0x" + normalized,
				Balance:    stringVal(parsed, "coin_balance"),
				IsContract: boolVal(parsed, "is_contract"),
				IsVerified: boolVal(parsed, "is_verified"),
			}
			if tc, ok := parsed["transactions_count"].(float64); ok {
				preview.TxCount = int(tc)
			}

			mu.Lock()
			resp.EVM = preview
			mu.Unlock()
		}()
	}

	wg.Wait()

	// After COA link resolved: fetch the other side's data if missing
	if coaLink, ok := resp.COALink.(*COALink); ok && coaLink != nil {
		// If we searched a Flow address, also fetch the linked EVM address data
		if isFlowAddr && resp.EVM == nil {
			evmNorm := strings.ToLower(strings.TrimPrefix(coaLink.EVMAddress, "0x"))
			bsCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			target := s.blockscoutURL + "/api/v2/addresses/0x" + evmNorm
			req, _ := http.NewRequestWithContext(bsCtx, "GET", target, nil)
			if req != nil {
				req.Header.Set("Accept", "application/json")
				bsResp, err := blockscoutClient.Do(req)
				if err == nil && bsResp.StatusCode == 200 {
					body, _ := io.ReadAll(bsResp.Body)
					bsResp.Body.Close()
					var parsed map[string]interface{}
					if json.Unmarshal(body, &parsed) == nil {
						resp.EVM = &EVMAddressPreview{
							Address:    coaLink.EVMAddress,
							Balance:    stringVal(parsed, "coin_balance"),
							IsContract: boolVal(parsed, "is_contract"),
							IsVerified: boolVal(parsed, "is_verified"),
							TxCount:    intVal(parsed, "transactions_count"),
						}
					}
				} else if bsResp != nil {
					bsResp.Body.Close()
				}
			}
		}
		// If we searched an EVM address, also fetch the linked Flow address data
		if isEVMAddr && resp.Cadence == nil {
			flowNorm := strings.ToLower(strings.TrimPrefix(coaLink.FlowAddress, "0x"))
			var contractsCount int
			s.repo.DB().QueryRow(ctx,
				"SELECT COUNT(*) FROM app.smart_contracts WHERE address = $1", flowNorm,
			).Scan(&contractsCount)
			var hasKeys bool
			s.repo.DB().QueryRow(ctx,
				"SELECT EXISTS(SELECT 1 FROM app.account_keys WHERE address = $1 AND revoked = false)", flowNorm,
			).Scan(&hasKeys)
			resp.Cadence = &CadenceAddressPreview{
				Address:        coaLink.FlowAddress,
				ContractsCount: contractsCount,
				HasKeys:        hasKeys,
			}
		}
	}

	writeAPIResponse(w, resp, nil, nil)
}

// --- Helpers ---

func stringVal(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func boolVal(m map[string]interface{}, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

func intVal(m map[string]interface{}, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}
```

- [ ] **Step 2: Register the route**

In `routes_registration.go`, add after the existing `/flow/search` route (around line 204):

```go
r.HandleFunc("/flow/search/preview", s.handleSearchPreview).Methods("GET", "OPTIONS")
```

- [ ] **Step 3: Check that repo has DB() method**

The handler uses `s.repo.DB()` for raw queries. Verify this method exists on the Repository struct. Search for `func (r *Repository) DB()` in the repository files. If it doesn't exist, check how other handlers do raw queries and adapt.

- [ ] **Step 4: Verify build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/v1_handlers_search_preview.go backend/internal/api/routes_registration.go
git commit -m "feat(api): add unified search preview endpoint with cross-chain resolution"
```

---

## Chunk 2: Frontend Types + API Client

### Task 2: Add Preview Types and API Function

**Files:**
- Modify: `frontend/app/types/blockscout.ts` (add preview types)
- Modify: `frontend/app/api/evm.ts` (add preview fetch function)

- [ ] **Step 1: Add preview types**

Append to `frontend/app/types/blockscout.ts`:

```typescript
// --- Search Preview Types ---

export interface CadenceTxPreview {
  id: string;
  status: string;
  block_height: number;
  timestamp: string;
  authorizers: string[];
  is_evm: boolean;
}

export interface EVMTxPreview {
  hash: string;
  status: string;
  from: string;
  to: string | null;
  value: string;
  method: string | null;
  block_number: number;
}

export interface TxLink {
  cadence_tx_id: string;
  evm_hash: string;
}

export interface CadenceAddressPreview {
  address: string;
  contracts_count: number;
  has_keys: boolean;
}

export interface EVMAddressPreview {
  address: string;
  balance: string;
  is_contract: boolean;
  is_verified: boolean;
  tx_count: number;
}

export interface COALink {
  flow_address: string;
  evm_address: string;
}

export interface TxPreviewResponse {
  cadence: CadenceTxPreview | null;
  evm: EVMTxPreview | null;
  link: TxLink | null;
}

export interface AddressPreviewResponse {
  cadence: CadenceAddressPreview | null;
  evm: EVMAddressPreview | null;
  coa_link: COALink | null;
}
```

- [ ] **Step 2: Add preview API function**

Add to `frontend/app/api/evm.ts` (or create a new module — but keeping it here is simpler since it's a search-related fetch):

```typescript
import type { TxPreviewResponse, AddressPreviewResponse } from '@/types/blockscout';

export async function fetchSearchPreview(
  query: string,
  type: 'tx' | 'address',
  signal?: AbortSignal
): Promise<TxPreviewResponse | AddressPreviewResponse> {
  const baseUrl = await resolveApiBaseUrl();
  const params = new URLSearchParams({ q: query, type });
  const res = await fetch(`${baseUrl}/flow/search/preview?${params}`, { signal });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}
```

Note: The backend wraps responses with `writeAPIResponse` which may use a `{ data: ... }` envelope. The `json.data ?? json` handles both cases.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/types/blockscout.ts frontend/app/api/evm.ts
git commit -m "feat(frontend): add search preview types and API function"
```

---

## Chunk 3: Frontend Search Hook Changes

### Task 3: Add Preview Mode to useSearch

**Files:**
- Modify: `frontend/app/hooks/useSearch.ts`

- [ ] **Step 1: Update SearchMode and SearchState types**

```typescript
export type SearchMode = 'idle' | 'quick-match' | 'fuzzy' | 'preview';

export interface SearchState {
  mode: SearchMode;
  quickMatches: QuickMatchItem[];
  fuzzyResults: SearchAllResponse | null;
  evmResults: BSSearchItem[];
  previewData: any | null;       // TxPreviewResponse | AddressPreviewResponse
  previewType: 'tx' | 'address' | null;
  previewLoading: boolean;
  isLoading: boolean;
  error: string | null;
}
```

Update `INITIAL_STATE` to include the new fields:
```typescript
const INITIAL_STATE: SearchState = {
  mode: 'idle',
  quickMatches: [],
  fuzzyResults: null,
  evmResults: [],
  previewData: null,
  previewType: null,
  previewLoading: false,
  isLoading: false,
  error: null,
};
```

- [ ] **Step 2: Update detectPattern to return preview mode**

Change the following patterns from `mode: 'idle'` to `mode: 'preview'`:

```typescript
// EVM_TX: was mode: 'idle', now mode: 'preview'
if (EVM_TX.test(q)) {
  return { mode: 'preview' as SearchMode, matches: [{ type: 'evm-tx', label: 'EVM Transaction', value: q, route: `/txs/evm/${q}` }] };
}

// HEX_64: was mode: 'quick-match', now mode: 'preview'
if (HEX_64.test(q)) {
  return { mode: 'preview' as SearchMode, matches: [
    { type: 'cadence-tx', label: 'Cadence Transaction', value: q, route: `/txs/${q}` },
    { type: 'evm-tx', label: 'EVM Transaction', value: q, route: `/txs/evm/0x${q}` },
  ] };
}

// EVM_ADDR: was mode: 'idle', now mode: 'preview'
if (EVM_ADDR.test(q)) {
  return { mode: 'preview' as SearchMode, matches: [{ type: 'evm-addr', label: 'EVM Address', value: q, route: `/accounts/${q}` }] };
}

// HEX_40: was mode: 'idle', now mode: 'preview'
if (HEX_40.test(q)) {
  return { mode: 'preview' as SearchMode, matches: [{ type: 'evm-addr', label: 'EVM Address', value: q, route: `/accounts/0x${q}` }] };
}

// HEX_16: was mode: 'idle', now mode: 'preview'
if (HEX_16.test(q)) {
  const addr = q.startsWith('0x') ? q.slice(2) : q;
  return { mode: 'preview' as SearchMode, matches: [{ type: 'flow-account', label: 'Flow Account', value: addr, route: `/accounts/0x${addr}` }] };
}
```

Block height (DIGITS) and public key (HEX_128) keep `mode: 'idle'`.

- [ ] **Step 3: Add preview API call in the search callback**

In the `search` callback, after the existing `quick-match` and `idle` handling, add a `preview` branch:

```typescript
if (mode === 'preview') {
  // Determine preview type from the first match
  const previewType = matches[0]?.type.includes('tx') ? 'tx' : 'address';

  // Set loading state immediately — keep matches for Enter fallback
  setState({
    mode: 'preview',
    quickMatches: matches,
    fuzzyResults: null,
    evmResults: [],
    previewData: null,
    previewType: previewType as 'tx' | 'address',
    previewLoading: true,
    isLoading: false,
    error: null,
  });

  // Fire preview API (no debounce needed)
  const controller = new AbortController();
  abortRef.current = controller;

  fetchSearchPreview(q, previewType as 'tx' | 'address', controller.signal)
    .then((data) => {
      if (controller.signal.aborted) return;
      setState((prev) => ({ ...prev, previewData: data, previewLoading: false }));
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      setState((prev) => ({ ...prev, previewLoading: false, error: 'Preview unavailable' }));
    });

  return;
}
```

Add import: `import { fetchSearchPreview } from '@/api/evm';`

- [ ] **Step 4: Verify no TypeScript errors in useSearch.ts**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep useSearch`
Expected: No errors from useSearch.ts

- [ ] **Step 5: Commit**

```bash
git add frontend/app/hooks/useSearch.ts
git commit -m "feat(frontend): add preview mode to useSearch with preview API integration"
```

---

## Chunk 4: Frontend SearchDropdown Preview Rendering

### Task 4: Render Preview Cards in SearchDropdown

**Files:**
- Modify: `frontend/app/components/SearchDropdown.tsx`

- [ ] **Step 1: Add preview types import**

```typescript
import type {
  TxPreviewResponse,
  AddressPreviewResponse,
  CadenceTxPreview,
  EVMTxPreview,
  CadenceAddressPreview,
  EVMAddressPreview,
} from '@/types/blockscout';
import { formatWei, truncateHash } from '@/lib/evmUtils';
import { formatRelativeTime } from '@/lib/time';
```

- [ ] **Step 2: Update getFlatItems to handle preview mode**

Add a `preview` branch:

```typescript
if (state.mode === 'preview') {
  const items: FlatItem[] = [];
  if (state.previewData) {
    const data = state.previewData;
    if (state.previewType === 'tx') {
      const txData = data as TxPreviewResponse;
      if (txData.cadence) items.push({ route: `/txs/${txData.cadence.id}`, label: 'Cadence Transaction' });
      if (txData.evm) items.push({ route: `/txs/${txData.evm.hash}`, label: 'EVM Transaction' });
    } else {
      const addrData = data as AddressPreviewResponse;
      if (addrData.evm) items.push({ route: `/accounts/${addrData.evm.address}`, label: 'EVM Address' });
      if (addrData.cadence) items.push({ route: `/accounts/${addrData.cadence.address}`, label: 'Cadence Address' });
      // If only COA link without separate entries, add linked address
      if (addrData.coa_link && !addrData.evm && addrData.cadence) {
        items.push({ route: `/accounts/${addrData.coa_link.evm_address}`, label: 'Linked EVM Address' });
      }
      if (addrData.coa_link && !addrData.cadence && addrData.evm) {
        items.push({ route: `/accounts/${addrData.coa_link.flow_address}`, label: 'Linked Flow Address' });
      }
    }
  }
  // Fallback: include quickMatches for Enter-during-loading
  if (items.length === 0 && state.quickMatches.length > 0) {
    return state.quickMatches.map((m) => ({ route: m.route, label: m.label }));
  }
  return items;
}
```

- [ ] **Step 3: Add preview rendering in the main component**

After the `quick-match` section and before the `fuzzy` section, add:

```typescript
{/* Preview mode — loading */}
{state.mode === 'preview' && state.previewLoading && (
  <div className="space-y-2 p-3">
    <div className="h-16 animate-pulse rounded bg-white/5" />
    <div className="h-16 animate-pulse rounded bg-white/5" />
  </div>
)}

{/* Preview mode — error */}
{state.mode === 'preview' && !state.previewLoading && state.error && (
  <div className="px-3 py-4 text-center text-sm text-zinc-500">
    Preview unavailable
  </div>
)}

{/* Preview mode — tx results */}
{state.mode === 'preview' && !state.previewLoading && state.previewType === 'tx' && state.previewData && (() => {
  const data = state.previewData as TxPreviewResponse;
  const hasResults = data.cadence || data.evm;
  if (!hasResults) return (
    <div className="px-3 py-4 text-center text-sm text-zinc-500">Transaction not found</div>
  );
  return (
    <>
      {data.cadence && (() => {
        const idx = globalIdx++;
        return (
          <>
            <SectionLabel label="Cadence Transaction" />
            <button
              type="button"
              data-index={idx}
              onClick={() => goTo(`/txs/${data.cadence!.id}`)}
              className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                activeIndex === idx ? 'border-l-nothing-green bg-nothing-green/5' : 'border-l-transparent hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${data.cadence.status === 'SEALED' ? 'text-nothing-green' : 'text-yellow-400'}`}>
                  {data.cadence.status}
                </span>
                <span className="text-zinc-500">Block #{data.cadence.block_height.toLocaleString()}</span>
                <span className="text-zinc-600">{formatRelativeTime(data.cadence.timestamp)}</span>
                {data.cadence.is_evm && (
                  <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">EVM</span>
                )}
              </div>
              <div className="font-mono text-xs text-zinc-400">
                {truncateHash(data.cadence.id, 10, 8)}
              </div>
            </button>
          </>
        );
      })()}

      {data.evm && (() => {
        const idx = globalIdx++;
        return (
          <>
            <SectionLabel label={data.link ? 'EVM Transaction (linked)' : 'EVM Transaction'} />
            <button
              type="button"
              data-index={idx}
              onClick={() => goTo(`/txs/${data.evm!.hash}`)}
              className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                activeIndex === idx ? 'border-l-nothing-green bg-nothing-green/5' : 'border-l-transparent hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${data.evm.status === 'ok' ? 'text-nothing-green' : 'text-red-400'}`}>
                  {data.evm.status === 'ok' ? 'Success' : 'Failed'}
                </span>
                {data.evm.method && (
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{data.evm.method}</span>
                )}
                {data.evm.value !== '0' && (
                  <span className="text-zinc-400">{formatWei(data.evm.value)} FLOW</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                <span>{truncateHash(data.evm.from, 8, 6)}</span>
                <span className="text-zinc-600">→</span>
                <span>{data.evm.to ? truncateHash(data.evm.to, 8, 6) : 'Contract Create'}</span>
              </div>
            </button>
          </>
        );
      })()}
    </>
  );
})()}

{/* Preview mode — address results */}
{state.mode === 'preview' && !state.previewLoading && state.previewType === 'address' && state.previewData && (() => {
  const data = state.previewData as AddressPreviewResponse;
  const hasResults = data.cadence || data.evm;
  if (!hasResults) return (
    <div className="px-3 py-4 text-center text-sm text-zinc-500">Address not found</div>
  );
  return (
    <>
      {data.evm && (() => {
        const idx = globalIdx++;
        return (
          <>
            <SectionLabel label="EVM Address" />
            <button
              type="button"
              data-index={idx}
              onClick={() => goTo(`/accounts/${data.evm!.address}`)}
              className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                activeIndex === idx ? 'border-l-nothing-green bg-nothing-green/5' : 'border-l-transparent hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-zinc-200">{truncateHash(data.evm.address, 10, 8)}</span>
                <span className="text-zinc-400">Balance: {formatWei(data.evm.balance)} FLOW</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>{data.evm.tx_count.toLocaleString()} txns</span>
                {data.evm.is_contract && (
                  <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">Contract</span>
                )}
                {data.evm.is_verified && (
                  <span className="rounded bg-nothing-green/10 px-1.5 py-0.5 text-[10px] font-medium text-nothing-green">Verified</span>
                )}
              </div>
            </button>
          </>
        );
      })()}

      {data.cadence && (() => {
        const idx = globalIdx++;
        const label = data.coa_link ? 'Linked Flow Address (COA)' : 'Flow Address';
        return (
          <>
            <SectionLabel label={label} />
            <button
              type="button"
              data-index={idx}
              onClick={() => goTo(`/accounts/${data.cadence!.address}`)}
              className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                activeIndex === idx ? 'border-l-nothing-green bg-nothing-green/5' : 'border-l-transparent hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-zinc-200">{data.cadence.address}</span>
                {data.coa_link && (
                  <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">COA</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {data.cadence.contracts_count > 0 && <span>{data.cadence.contracts_count} contracts</span>}
                {data.cadence.has_keys && <span>Has keys</span>}
              </div>
            </button>
          </>
        );
      })()}
    </>
  );
})()}
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && NODE_OPTIONS="--max-old-space-size=8192" bun run build`
Expected: Build succeeds (may need to build workspace packages first)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/SearchDropdown.tsx
git commit -m "feat(frontend): render search preview cards with cross-chain relationships"
```

---

## Chunk 5: Header Enter Key Handling

### Task 5: Update Header for Preview Mode

**Files:**
- Modify: `frontend/app/components/Header.tsx`

The Header's `handleSearch` (Enter key) currently handles `mode: 'idle'` by doing direct navigation. With the new `preview` mode, Enter should:
- If preview is loaded and dropdown has items → select the active item (existing behavior via `dropdownRef.current?.selectActive()`)
- If preview is loading → fall back to direct navigation (paste-and-Enter workflow)

- [ ] **Step 1: Update handleSearch for preview mode**

In `Header.tsx`, the `handleSearch` function (line 145) starts with:
```typescript
if (searchState.mode !== 'idle' && (dropdownRef.current?.totalItems() ?? 0) > 0) {
  dropdownRef.current?.selectActive();
```

This already handles `preview` mode correctly when items are loaded (mode is not 'idle', items > 0). But when preview is loading (`previewLoading` is true), `totalItems()` returns the quickMatches count (from the fallback in `getFlatItems`), so Enter will select the first quickMatch — which IS the direct navigation fallback. This is the desired behavior.

However, we need to make sure the `onKeyDown` handler also works for preview mode. Check if the existing `onKeyDown` (line 231) blocks keyboard nav when mode is 'idle'. Currently:
```typescript
if (searchState.mode === 'idle') return;
```

Since `preview` is not `idle`, keyboard nav (↑↓ Enter Esc) will work. No change needed here.

- [ ] **Step 2: Remove redundant direct-navigation for patterns that now use preview**

The `handleSearch` function has explicit pattern matching (lines 159-196) that duplicates what `detectPattern` does. With preview mode, these patterns are handled by the dropdown. However, we should keep them as fallbacks for when preview is loading and user hits Enter.

Actually, the current flow already handles this correctly:
1. User types hash → `searchState.mode` becomes `'preview'`
2. User hits Enter → `handleSearch` runs
3. `searchState.mode !== 'idle'` is true
4. If `dropdownRef.current?.totalItems() > 0` → selects active dropdown item
5. If dropdown has no items yet (loading) → falls through to the pattern matching below
6. Pattern matching does direct navigation → this is the fallback

This is correct behavior. No changes needed to `handleSearch`.

- [ ] **Step 3: Verify no changes needed**

Read `Header.tsx` handleSearch and onKeyDown carefully. Confirm that:
1. Preview mode (not 'idle') enables keyboard nav → ✓
2. Enter selects dropdown item when available → ✓
3. Enter falls through to direct nav when loading → ✓

If all correct, no code changes needed for Header.tsx. Skip this task's commit.

---

## Chunk 6: Verification

### Task 6: Verify Full Stack Build

- [ ] **Step 1: Backend build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 2: Frontend build**

Run: `cd frontend && NODE_OPTIONS="--max-old-space-size=8192" bun run build`
Expected: Build succeeds

- [ ] **Step 3: Git status clean**

```bash
git status
```
Expected: Clean working tree

### Task 7: Manual Smoke Test Checklist

- [ ] Search `0x` + 64-hex EVM tx hash → dropdown shows preview with Cadence + EVM tx
- [ ] Search 64-hex bare hash → dropdown shows preview (was quick-match before)
- [ ] Search `0x` + 40-hex EVM address → dropdown shows EVM address preview + COA link
- [ ] Search 16-hex Flow address → dropdown shows Flow address preview + COA link
- [ ] Search block height (digits) → still direct navigation (no change)
- [ ] Search text "flow" → still fuzzy search dropdown (no change)
- [ ] Enter during preview loading → falls through to direct navigation
- [ ] Enter after preview loaded → navigates to selected preview item
- [ ] ↑↓ arrows navigate between preview cards
- [ ] Esc closes dropdown
