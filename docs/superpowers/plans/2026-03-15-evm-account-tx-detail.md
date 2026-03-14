# EVM Account & Transaction Detail Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native EVM account detail, transaction detail, and activity pages to FlowIndex — reusing Blockscout API via proxy.

**Architecture:** Go backend adds ~10 proxy routes forwarding to Blockscout `/api/v2/`. Frontend detects address/hash type in existing route loaders and renders EVM-specific components. No new DB tables. COA enrichment via existing `coa_accounts` table.

**Tech Stack:** Go (Gorilla Mux), React 19, TanStack Start/Router, TypeScript, TailwindCSS, Shadcn/UI

**Spec:** `docs/superpowers/specs/2026-03-15-evm-account-tx-detail-design.md`

### Import Conventions (reference for all tasks)

These are the correct imports used throughout the plan. If any task code differs from these, follow these:

```typescript
// CopyButton — NOT from '../ui/CopyButton'
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';

// Relative time — NO TimeAgo component exists. Use the function:
import { formatRelativeTime } from '@/lib/time';
// Usage: <span>{formatRelativeTime(tx.timestamp)}</span>

// Address display — use existing AddressLink for consistent look:
import { AddressLink } from '@/components/AddressLink';
// Usage: <AddressLink address={addr} showAvatar={false} />

// API base URL
import { resolveApiBaseUrl } from '@/api';

// EVM API client (created in Task 6)
import { getEVMAddress, getEVMAddressTransactions, ... } from '@/api/evm';

// Blockscout types (created in Task 5)
import type { BSAddress, BSTransaction, ... } from '@/types/blockscout';
```

---

## Chunk 1: Backend Proxy Routes

### Task 1: Add EVM Address Proxy Endpoints

**Files:**
- Modify: `backend/internal/api/v1_handlers_evm.go`
- Modify: `backend/internal/api/routes_registration.go`

- [ ] **Step 1: Add address detail handler**

In `v1_handlers_evm.go`, add after the existing handlers:

```go
func (s *Server) handleFlowGetEVMAddress(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr)
}
```

- [ ] **Step 2: Add address transactions handler**

```go
func (s *Server) handleFlowGetEVMAddressTransactions(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr+"/transactions")
}
```

- [ ] **Step 3: Add address internal transactions handler**

```go
func (s *Server) handleFlowGetEVMAddressInternalTxs(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr+"/internal-transactions")
}
```

- [ ] **Step 4: Add address token transfers handler**

```go
func (s *Server) handleFlowGetEVMAddressTokenTransfers(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	s.proxyBlockscout(w, r, "/api/v2/addresses/0x"+addr+"/token-transfers")
}
```

- [ ] **Step 5: Register address routes**

In `routes_registration.go`, after line 184 (existing EVM routes), add:

```go
r.HandleFunc("/flow/evm/address/{address}", s.handleFlowGetEVMAddress).Methods("GET", "OPTIONS")
r.HandleFunc("/flow/evm/address/{address}/transactions", s.handleFlowGetEVMAddressTransactions).Methods("GET", "OPTIONS")
r.HandleFunc("/flow/evm/address/{address}/internal-transactions", s.handleFlowGetEVMAddressInternalTxs).Methods("GET", "OPTIONS")
r.HandleFunc("/flow/evm/address/{address}/token-transfers", s.handleFlowGetEVMAddressTokenTransfers).Methods("GET", "OPTIONS")
```

Note: existing `/flow/evm/address/{address}/token` route already handles token balances.

- [ ] **Step 6: Verify build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add backend/internal/api/v1_handlers_evm.go backend/internal/api/routes_registration.go
git commit -m "feat(api): add EVM address proxy endpoints for Blockscout"
```

### Task 2: Add EVM Transaction Sub-resource Proxy Endpoints

**Files:**
- Modify: `backend/internal/api/v1_handlers_evm.go`
- Modify: `backend/internal/api/routes_registration.go`

- [ ] **Step 1: Add transaction internal txs handler**

```go
func (s *Server) handleFlowGetEVMTransactionInternalTxs(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(strings.TrimPrefix(mux.Vars(r)["hash"], "0x"))
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash+"/internal-transactions")
}
```

- [ ] **Step 2: Add transaction logs handler**

```go
func (s *Server) handleFlowGetEVMTransactionLogs(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(strings.TrimPrefix(mux.Vars(r)["hash"], "0x"))
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash+"/logs")
}
```

- [ ] **Step 3: Add transaction token transfers handler**

```go
func (s *Server) handleFlowGetEVMTransactionTokenTransfers(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(strings.TrimPrefix(mux.Vars(r)["hash"], "0x"))
	s.proxyBlockscout(w, r, "/api/v2/transactions/0x"+hash+"/token-transfers")
}
```

- [ ] **Step 4: Register transaction sub-resource routes**

In `routes_registration.go`, after the existing `/flow/evm/transaction/{hash}` route:

```go
r.HandleFunc("/flow/evm/transaction/{hash}/internal-transactions", s.handleFlowGetEVMTransactionInternalTxs).Methods("GET", "OPTIONS")
r.HandleFunc("/flow/evm/transaction/{hash}/logs", s.handleFlowGetEVMTransactionLogs).Methods("GET", "OPTIONS")
r.HandleFunc("/flow/evm/transaction/{hash}/token-transfers", s.handleFlowGetEVMTransactionTokenTransfers).Methods("GET", "OPTIONS")
```

- [ ] **Step 5: Verify build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/v1_handlers_evm.go backend/internal/api/routes_registration.go
git commit -m "feat(api): add EVM transaction sub-resource proxy endpoints"
```

### Task 3: Add EVM Search Proxy Endpoint

**Files:**
- Modify: `backend/internal/api/v1_handlers_evm.go`
- Modify: `backend/internal/api/routes_registration.go`

- [ ] **Step 1: Add search handler**

```go
func (s *Server) handleFlowEVMSearch(w http.ResponseWriter, r *http.Request) {
	s.proxyBlockscout(w, r, "/api/v2/search")
}
```

- [ ] **Step 2: Register with caching**

In `routes_registration.go`:

```go
r.HandleFunc("/flow/evm/search", cachedHandler(30*time.Second, s.handleFlowEVMSearch)).Methods("GET", "OPTIONS")
```

Check how `cachedHandler` is used for existing search routes in the same file to match the pattern.

- [ ] **Step 3: Verify build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/internal/api/v1_handlers_evm.go backend/internal/api/routes_registration.go
git commit -m "feat(api): add cached EVM search proxy endpoint"
```

### Task 4: Add COA Enrichment to EVM Address Detail

**Files:**
- Modify: `backend/internal/api/v1_handlers_evm.go`

The `handleFlowGetEVMAddress` handler currently does a pure proxy. Enhance it to check `coa_accounts` and inject `flow_address` into the response.

- [ ] **Step 1: Update handler to enrich with COA data**

Replace the simple proxy handler with:

```go
func (s *Server) handleFlowGetEVMAddress(w http.ResponseWriter, r *http.Request) {
	addr := normalizeAddr(mux.Vars(r)["address"])
	upstreamPath := "/api/v2/addresses/0x" + addr

	// Fetch from Blockscout
	target := s.blockscoutURL + upstreamPath
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", target, nil)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create request")
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := blockscoutClient.Do(req)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "blockscout unavailable")
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to read blockscout response")
		return
	}

	// Try to enrich with COA mapping
	if resp.StatusCode == http.StatusOK && s.repo != nil {
		coaRow, _ := s.repo.GetFlowAddressByCOA(r.Context(), addr)
		if coaRow != nil && coaRow.FlowAddress != "" {
			// Inject flow_address into JSON response
			var parsed map[string]interface{}
			if json.Unmarshal(body, &parsed) == nil {
				parsed["flow_address"] = "0x" + coaRow.FlowAddress
				parsed["is_coa"] = true
				if enriched, err := json.Marshal(parsed); err == nil {
					body = enriched
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}
```

Add `"encoding/json"` and `"io"` imports if not already present.

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/internal/api/v1_handlers_evm.go
git commit -m "feat(api): enrich EVM address detail with COA mapping"
```

---

## Chunk 2: TypeScript Types + EVM API Client

### Task 5: Define Blockscout TypeScript Types

**Files:**
- Create: `frontend/app/types/blockscout.ts`

- [ ] **Step 1: Create Blockscout type definitions**

```typescript
// Blockscout API v2 response types

export interface BSAddress {
  hash: string;
  is_contract: boolean;
  is_verified: boolean | null;
  name: string | null;
  coin_balance: string | null;       // wei string
  exchange_rate: string | null;
  block_number_balance_updated_at: number | null;
  transactions_count: number;
  token_transfers_count: number;
  has_custom_methods_read: boolean;
  has_custom_methods_write: boolean;
  // COA enrichment (added by our backend)
  flow_address?: string;
  is_coa?: boolean;
}

export interface BSTransaction {
  hash: string;
  block_number: number;
  timestamp: string;             // ISO 8601
  from: { hash: string; name?: string | null; is_contract: boolean };
  to: { hash: string; name?: string | null; is_contract: boolean } | null;
  value: string;                 // wei string
  gas_limit: string;
  gas_used: string;
  gas_price: string;             // wei string
  status: string;                // "ok" | "error"
  result: string;
  nonce: number;
  type: number;                  // 0=legacy, 1=access_list, 2=EIP-1559
  method: string | null;         // decoded method name
  raw_input: string;             // hex calldata
  decoded_input: BSDecodedInput | null;
  token_transfers: BSTokenTransfer[] | null;
  fee: { type: string; value: string };
  tx_types: string[];            // ["coin_transfer", "token_transfer", "contract_call", etc.]
  confirmations: number;
  revert_reason: string | null;
  has_error_in_internal_txs: boolean;
}

export interface BSDecodedInput {
  method_call: string;
  method_id: string;
  parameters: BSDecodedParam[];
}

export interface BSDecodedParam {
  name: string;
  type: string;
  value: string;
}

export interface BSInternalTransaction {
  index: number;
  transaction_hash: string;
  block_number: number;
  timestamp: string;
  type: string;                  // "call" | "create" | "selfdestruct" | "reward"
  call_type: string | null;      // "call" | "delegatecall" | "staticcall" | "callcode"
  from: { hash: string; name?: string | null; is_contract: boolean };
  to: { hash: string; name?: string | null; is_contract: boolean } | null;
  value: string;                 // wei string
  gas_limit: string;
  gas_used: string;
  input: string;
  output: string;
  error: string | null;
  created_contract: { hash: string; name?: string | null } | null;
  success: boolean;
}

export interface BSTokenTransfer {
  block_hash: string;
  block_number: number;
  log_index: number;
  timestamp: string;
  from: { hash: string; name?: string | null; is_contract: boolean };
  to: { hash: string; name?: string | null; is_contract: boolean };
  token: BSToken;
  total: { value: string; decimals: string } | null;
  tx_hash: string;
  type: string;                  // "token_transfer"
  method: string | null;
}

export interface BSToken {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  type: string;                  // "ERC-20" | "ERC-721" | "ERC-1155"
  icon_url: string | null;
  exchange_rate: string | null;
}

export interface BSTokenBalance {
  token: BSToken;
  token_id: string | null;
  value: string;
  token_instance: any | null;
}

export interface BSLog {
  index: number;
  address: { hash: string; name?: string | null; is_contract: boolean };
  data: string;                  // hex
  topics: string[];              // array of topic hex strings
  decoded: BSDecodedLog | null;
  tx_hash: string;
  block_number: number;
}

export interface BSDecodedLog {
  method_call: string;
  method_id: string;
  parameters: BSDecodedParam[];
}

export interface BSSearchResult {
  items: BSSearchItem[];
  next_page_params: BSPageParams | null;
}

export interface BSSearchItem {
  type: string;                  // "address" | "transaction" | "token" | "contract" | "block"
  name: string | null;
  address: string | null;
  url: string;
  symbol: string | null;
  token_type: string | null;
  is_smart_contract_verified: boolean | null;
  exchange_rate: string | null;
}

/** Cursor-based pagination — pass as query params to fetch next page */
export interface BSPageParams {
  [key: string]: string | number;
}

/** Wrapper for paginated Blockscout responses */
export interface BSPaginatedResponse<T> {
  items: T[];
  next_page_params: BSPageParams | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/types/blockscout.ts
git commit -m "feat(frontend): add Blockscout API v2 TypeScript types"
```

### Task 6: Create EVM API Client

**Files:**
- Create: `frontend/app/api/evm.ts`

- [ ] **Step 1: Create EVM API client module**

```typescript
import { resolveApiBaseUrl } from '@/api';
import type {
  BSAddress,
  BSTransaction,
  BSInternalTransaction,
  BSTokenTransfer,
  BSTokenBalance,
  BSLog,
  BSSearchResult,
  BSPageParams,
  BSPaginatedResponse,
} from '@/types/blockscout';

async function evmFetch<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const baseUrl = await resolveApiBaseUrl();
  const url = new URL(`${baseUrl}/flow/evm${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`EVM API error: ${res.status}`);
  return res.json();
}

function pageParamsToRecord(params?: BSPageParams): Record<string, string> | undefined {
  if (!params) return undefined;
  const record: Record<string, string> = {};
  Object.entries(params).forEach(([k, v]) => { record[k] = String(v); });
  return record;
}

// --- Address endpoints ---

export async function getEVMAddress(address: string, signal?: AbortSignal): Promise<BSAddress> {
  return evmFetch<BSAddress>(`/address/${address}`, undefined, signal);
}

export async function getEVMAddressTransactions(
  address: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSTransaction>> {
  return evmFetch(`/address/${address}/transactions`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMAddressInternalTxs(
  address: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSInternalTransaction>> {
  return evmFetch(`/address/${address}/internal-transactions`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMAddressTokenTransfers(
  address: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSTokenTransfer>> {
  return evmFetch(`/address/${address}/token-transfers`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMAddressTokenBalances(
  address: string, signal?: AbortSignal
): Promise<BSTokenBalance[]> {
  // Blockscout returns array directly for current token balances
  return evmFetch<BSTokenBalance[]>(`/address/${address}/token`, undefined, signal);
}

// --- Transaction endpoints ---

export async function getEVMTransaction(hash: string, signal?: AbortSignal): Promise<BSTransaction> {
  return evmFetch<BSTransaction>(`/transaction/${hash}`, undefined, signal);
}

export async function getEVMTransactionInternalTxs(
  hash: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSInternalTransaction>> {
  return evmFetch(`/transaction/${hash}/internal-transactions`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMTransactionLogs(
  hash: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSLog>> {
  return evmFetch(`/transaction/${hash}/logs`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMTransactionTokenTransfers(
  hash: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSTokenTransfer>> {
  return evmFetch(`/transaction/${hash}/token-transfers`, pageParamsToRecord(pageParams), signal);
}

// --- Search ---

export async function searchEVM(query: string, signal?: AbortSignal): Promise<BSSearchResult> {
  return evmFetch<BSSearchResult>(`/search`, { q: query }, signal);
}
```

- [ ] **Step 2: Verify frontend build**

Run: `cd frontend && bun run build`
Expected: No TypeScript errors (types are imported but not yet used by components)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/evm.ts
git commit -m "feat(frontend): add EVM API client for Blockscout proxy"
```

---

## Chunk 3: Shared Components

### Task 7: Create LoadMorePagination Component

**Files:**
- Create: `frontend/app/components/LoadMorePagination.tsx`

Blockscout uses cursor-based pagination. Instead of adapting the existing page-number `Pagination.tsx`, create a simple "Load More" button.

- [ ] **Step 1: Create component**

```typescript
import type { BSPageParams } from '@/types/blockscout';

interface LoadMorePaginationProps {
  nextPageParams: BSPageParams | null;
  isLoading: boolean;
  onLoadMore: (params: BSPageParams) => void;
}

export function LoadMorePagination({ nextPageParams, isLoading, onLoadMore }: LoadMorePaginationProps) {
  if (!nextPageParams) return null;

  return (
    <div className="flex justify-center py-4">
      <button
        onClick={() => onLoadMore(nextPageParams)}
        disabled={isLoading}
        className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Loading...' : 'Load More'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/LoadMorePagination.tsx
git commit -m "feat(frontend): add LoadMorePagination for cursor-based pagination"
```

### Task 8: Create EVM Utility Helpers

**Files:**
- Create: `frontend/app/lib/evmUtils.ts`

- [ ] **Step 1: Create utility functions**

```typescript
/** Format wei string to human-readable FLOW value */
export function formatWei(wei: string | null | undefined, decimals = 18, precision = 4): string {
  if (!wei || wei === '0') return '0';
  try {
    const num = BigInt(wei);
    const divisor = BigInt(10 ** decimals);
    const whole = num / divisor;
    const remainder = num % divisor;
    const fracStr = remainder.toString().padStart(decimals, '0').slice(0, precision);
    const result = `${whole}.${fracStr}`.replace(/\.?0+$/, '');
    return result || '0';
  } catch {
    return wei;
  }
}

/** Format gas number with commas */
export function formatGas(gas: string | number | null | undefined): string {
  if (!gas) return '0';
  return Number(gas).toLocaleString();
}

/** Truncate hex string: 0xAbCd...1234 */
export function truncateHash(hash: string, startLen = 6, endLen = 4): string {
  if (!hash || hash.length <= startLen + endLen + 3) return hash;
  return `${hash.slice(0, startLen)}...${hash.slice(-endLen)}`;
}

/** Normalize EVM address to lowercase with 0x prefix */
export function normalizeEVMAddress(addr: string): string {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  return `0x${clean}`;
}

/** Check if a hex string (without 0x) is a 40-char EVM address */
export function isEVMAddress(hexOnly: string): boolean {
  return /^[0-9a-fA-F]{40}$/.test(hexOnly);
}

/** Map Blockscout tx status to display */
export function txStatusLabel(status: string): { label: string; color: string } {
  if (status === 'ok') return { label: 'Success', color: 'text-green-600 dark:text-green-400' };
  return { label: 'Failed', color: 'text-red-600 dark:text-red-400' };
}

/** Map internal tx type + call_type to display label */
export function internalTxTypeLabel(type: string, callType: string | null): string {
  if (type === 'create') return 'CREATE';
  if (type === 'selfdestruct') return 'SELFDESTRUCT';
  if (callType === 'delegatecall') return 'DELEGATECALL';
  if (callType === 'staticcall') return 'STATICCALL';
  return 'CALL';
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/lib/evmUtils.ts
git commit -m "feat(frontend): add EVM utility helpers (formatting, normalization)"
```

---

## Chunk 4: EVM Account Page

### Task 9: Refactor Address Detection in Account Route

**Files:**
- Modify: `frontend/app/routes/accounts/$address.tsx`

This is the critical routing change. Currently the loader only handles Cadence addresses and COA redirect. We need to add an EVM branch.

- [ ] **Step 1: Update the loader to detect EVM addresses**

In `accounts/$address.tsx`, replace the existing COA detection block (lines ~63-87) with:

```typescript
loader: async ({ params, search }: any) => {
    try {
        const address = params.address;
        const normalized = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`;
        const hexOnly = normalized.replace(/^0x/, '');

        // EVM address: 40 hex chars
        if (hexOnly.length === 40) {
            const base = await resolveApiBaseUrl();
            // Check if this is a COA (has linked Flow address)
            const coaRes = await fetch(`${base}/flow/v1/coa/${normalized}`).catch(() => null);
            let flowAddress: string | null = null;
            if (coaRes?.ok) {
                const json = await coaRes.json().catch(() => null);
                flowAddress = json?.data?.[0]?.flow_address ?? null;
            }
            return {
                account: null,
                initialTransactions: [],
                initialNextCursor: '',
                isEVM: true,
                isCOA: !!flowAddress,
                evmAddress: normalized,
                flowAddress,
            };
        }

        // Cadence address: <= 16 hex chars — existing logic below (unchanged)
        // ... rest of existing loader code ...
```

- [ ] **Step 2: Update the component to render EVMAccountPage for EVM addresses**

In the main component function, add a branch at the top:

```typescript
function AccountPage() {
  const data = Route.useLoaderData();

  // EVM address → render EVM account page
  if (data.isEVM) {
    return (
      <EVMAccountPage
        address={data.evmAddress!}
        flowAddress={data.flowAddress ?? undefined}
        isCOA={data.isCOA}
      />
    );
  }

  // Existing Cadence account rendering below (unchanged)
  // ...
}
```

Add import at top: `import { EVMAccountPage } from '@/components/evm/EVMAccountPage';`

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npx tsc --noEmit`
Expected: May fail because `EVMAccountPage` doesn't exist yet. That's OK — create a placeholder in the next task.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/routes/accounts/\$address.tsx
git commit -m "feat(frontend): detect EVM addresses in account route loader"
```

### Task 10: Create EVMAccountPage Component

**Files:**
- Create: `frontend/app/components/evm/EVMAccountPage.tsx`

- [ ] **Step 1: Create the main EVM account page component**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { Copy, ExternalLink } from 'lucide-react';
import { getEVMAddress } from '@/api/evm';
import type { BSAddress } from '@/types/blockscout';
import { formatWei, truncateHash } from '@/lib/evmUtils';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { EVMTransactionList } from './EVMTransactionList';
import { EVMInternalTxList } from './EVMInternalTxList';
import { EVMTokenTransfers } from './EVMTokenTransfers';
import { EVMTokenHoldings } from './EVMTokenHoldings';

type EVMTab = 'transactions' | 'internal' | 'token-transfers' | 'holdings';

interface EVMAccountPageProps {
  address: string;
  flowAddress?: string;
  isCOA: boolean;
}

export function EVMAccountPage({ address, flowAddress, isCOA }: EVMAccountPageProps) {
  const [addressInfo, setAddressInfo] = useState<BSAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EVMTab>('transactions');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEVMAddress(address)
      .then((data) => { if (!cancelled) setAddressInfo(data); })
      .catch((err) => { if (!cancelled) setError('EVM data temporarily unavailable'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  const tabs: { key: EVMTab; label: string; show?: boolean }[] = [
    { key: 'transactions', label: 'Transactions' },
    { key: 'internal', label: 'Internal Txs' },
    { key: 'token-transfers', label: 'Token Transfers' },
    { key: 'holdings', label: 'Token Holdings' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            EVM Address
          </h1>
          {isCOA && (
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40 rounded">
              COA
            </span>
          )}
          {addressInfo?.is_contract && (
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40 rounded">
              Contract
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-sm text-zinc-600 dark:text-zinc-400">
          <span>{address}</span>
          <CopyButton content={address} />
        </div>

        {/* COA link to Flow address */}
        {flowAddress && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-zinc-500">Linked Flow Address:</span>
            <Link
              to="/accounts/$address"
              params={{ address: flowAddress }}
              className="font-mono text-green-600 dark:text-green-400 hover:underline"
            >
              {flowAddress}
            </Link>
          </div>
        )}

        {/* Balance & stats */}
        {loading ? (
          <div className="mt-3 flex gap-6">
            <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
            <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
          </div>
        ) : error ? (
          <div className="mt-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded border border-red-200 dark:border-red-800/40">
            {error}
          </div>
        ) : addressInfo && (
          <div className="mt-3 flex gap-6 text-sm text-zinc-600 dark:text-zinc-400">
            <span>Balance: <strong className="text-zinc-900 dark:text-zinc-100">{formatWei(addressInfo.coin_balance)} FLOW</strong></span>
            <span>Transactions: <strong className="text-zinc-900 dark:text-zinc-100">{addressInfo.transactions_count.toLocaleString()}</strong></span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-200 dark:border-zinc-700 mb-4">
        <div className="flex gap-0 -mb-px">
          {tabs.filter(t => t.show !== false).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'transactions' && <EVMTransactionList address={address} />}
      {activeTab === 'internal' && <EVMInternalTxList address={address} />}
      {activeTab === 'token-transfers' && <EVMTokenTransfers address={address} />}
      {activeTab === 'holdings' && <EVMTokenHoldings address={address} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/evm/EVMAccountPage.tsx
git commit -m "feat(frontend): create EVMAccountPage with header, tabs, and skeleton loading"
```

### Task 11: Create EVMTransactionList Component

**Files:**
- Create: `frontend/app/components/evm/EVMTransactionList.tsx`

- [ ] **Step 1: Create component**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMAddressTransactions } from '@/api/evm';
import type { BSTransaction, BSPageParams } from '@/types/blockscout';
import { formatWei, truncateHash, txStatusLabel } from '@/lib/evmUtils';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import { formatRelativeTime } from '@/lib/time';

interface EVMTransactionListProps {
  address: string;
}

export function EVMTransactionList({ address }: EVMTransactionListProps) {
  const [txs, setTxs] = useState<BSTransaction[]>([]);
  const [nextPage, setNextPage] = useState<BSPageParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEVMAddressTransactions(address)
      .then((res) => {
        if (!cancelled) {
          setTxs(res.items);
          setNextPage(res.next_page_params);
        }
      })
      .catch(() => { if (!cancelled) setError('Failed to load transactions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const res = await getEVMAddressTransactions(address, params);
      setTxs((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch {
      setError('Failed to load more transactions');
    } finally {
      setLoadingMore(false);
    }
  }, [address]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>;
  }

  if (txs.length === 0) {
    return <div className="text-sm text-zinc-500 py-4">No transactions found.</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700 text-left text-zinc-500 dark:text-zinc-400">
              <th className="pb-2 pr-4 font-medium">Tx Hash</th>
              <th className="pb-2 pr-4 font-medium">Method</th>
              <th className="pb-2 pr-4 font-medium">Block</th>
              <th className="pb-2 pr-4 font-medium">Age</th>
              <th className="pb-2 pr-4 font-medium">From</th>
              <th className="pb-2 pr-4 font-medium">To</th>
              <th className="pb-2 pr-4 font-medium text-right">Value</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((tx) => {
              const status = txStatusLabel(tx.status);
              return (
                <tr key={tx.hash} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="py-2.5 pr-4 font-mono">
                    <Link
                      to="/txs/$txId"
                      params={{ txId: tx.hash }}
                      className="text-green-600 dark:text-green-400 hover:underline"
                    >
                      {truncateHash(tx.hash)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    {tx.method ? (
                      <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded font-mono">
                        {tx.method}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-zinc-600 dark:text-zinc-400">
                    {tx.block_number}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-500">
                    {formatRelativeTime(tx.timestamp)}
                  </td>
                  <td className="py-2.5 pr-4 font-mono">
                    <Link
                      to="/accounts/$address"
                      params={{ address: tx.from.hash }}
                      className="text-green-600 dark:text-green-400 hover:underline"
                    >
                      {truncateHash(tx.from.hash)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 font-mono">
                    {tx.to ? (
                      <Link
                        to="/accounts/$address"
                        params={{ address: tx.to.hash }}
                        className="text-green-600 dark:text-green-400 hover:underline"
                      >
                        {truncateHash(tx.to.hash)}
                      </Link>
                    ) : (
                      <span className="text-zinc-400 italic">Contract Create</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono">
                    {formatWei(tx.value)} FLOW
                  </td>
                  <td className="py-2.5">
                    <span className={`text-xs font-medium ${status.color}`}>
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LoadMorePagination
        nextPageParams={nextPage}
        isLoading={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/evm/EVMTransactionList.tsx
git commit -m "feat(frontend): create EVMTransactionList with load-more pagination"
```

### Task 12: Create EVMInternalTxList Component

**Files:**
- Create: `frontend/app/components/evm/EVMInternalTxList.tsx`

- [ ] **Step 1: Create component**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMAddressInternalTxs, getEVMTransactionInternalTxs } from '@/api/evm';
import type { BSInternalTransaction, BSPageParams } from '@/types/blockscout';
import { formatWei, truncateHash, internalTxTypeLabel } from '@/lib/evmUtils';
import { LoadMorePagination } from '@/components/LoadMorePagination';

interface EVMInternalTxListProps {
  address?: string;
  txHash?: string;
}

export function EVMInternalTxList({ address, txHash }: EVMInternalTxListProps) {
  const [items, setItems] = useState<BSInternalTransaction[]>([]);
  const [nextPage, setNextPage] = useState<BSPageParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchFn = address
      ? () => getEVMAddressInternalTxs(address)
      : txHash
      ? () => getEVMTransactionInternalTxs(txHash)
      : null;

    if (!fetchFn) return;

    fetchFn()
      .then((res) => {
        if (!cancelled) {
          setItems(res.items);
          setNextPage(res.next_page_params);
        }
      })
      .catch(() => { if (!cancelled) setError('Failed to load internal transactions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address, txHash]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const fetchFn = address
        ? () => getEVMAddressInternalTxs(address, params)
        : txHash
        ? () => getEVMTransactionInternalTxs(txHash, params)
        : null;
      if (!fetchFn) return;
      const res = await fetchFn();
      setItems((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch {
      setError('Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [address, txHash]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) return <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>;
  if (items.length === 0) return <div className="text-sm text-zinc-500 py-4">No internal transactions found.</div>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700 text-left text-zinc-500 dark:text-zinc-400">
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">From</th>
              <th className="pb-2 pr-4 font-medium">To</th>
              <th className="pb-2 pr-4 font-medium text-right">Value</th>
              <th className="pb-2 pr-4 font-medium text-right">Gas Used</th>
              <th className="pb-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {items.map((itx, idx) => (
              <tr key={idx} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="py-2.5 pr-4">
                  <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded font-mono">
                    {internalTxTypeLabel(itx.type, itx.call_type)}
                  </span>
                </td>
                <td className="py-2.5 pr-4 font-mono">
                  <Link
                    to="/accounts/$address"
                    params={{ address: itx.from.hash }}
                    className="text-green-600 dark:text-green-400 hover:underline"
                  >
                    {truncateHash(itx.from.hash)}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 font-mono">
                  {itx.to ? (
                    <Link
                      to="/accounts/$address"
                      params={{ address: itx.to.hash }}
                      className="text-green-600 dark:text-green-400 hover:underline"
                    >
                      {truncateHash(itx.to.hash)}
                    </Link>
                  ) : itx.created_contract ? (
                    <Link
                      to="/accounts/$address"
                      params={{ address: itx.created_contract.hash }}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {truncateHash(itx.created_contract.hash)} (new)
                    </Link>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono">{formatWei(itx.value)} FLOW</td>
                <td className="py-2.5 pr-4 text-right font-mono text-zinc-500">{Number(itx.gas_used).toLocaleString()}</td>
                <td className="py-2.5">
                  {itx.error ? (
                    <span className="text-xs text-red-600 dark:text-red-400">{itx.error}</span>
                  ) : (
                    <span className="text-xs text-green-600 dark:text-green-400">Success</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMorePagination nextPageParams={nextPage} isLoading={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/evm/EVMInternalTxList.tsx
git commit -m "feat(frontend): create EVMInternalTxList component"
```

### Task 13: Create EVMTokenTransfers + EVMTokenHoldings Components

**Files:**
- Create: `frontend/app/components/evm/EVMTokenTransfers.tsx`
- Create: `frontend/app/components/evm/EVMTokenHoldings.tsx`

- [ ] **Step 1: Create EVMTokenTransfers**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMAddressTokenTransfers, getEVMTransactionTokenTransfers } from '@/api/evm';
import type { BSTokenTransfer, BSPageParams } from '@/types/blockscout';
import { formatWei, truncateHash } from '@/lib/evmUtils';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import { formatRelativeTime } from '@/lib/time';

interface EVMTokenTransfersProps {
  address?: string;
  txHash?: string;
}

export function EVMTokenTransfers({ address, txHash }: EVMTokenTransfersProps) {
  const [items, setItems] = useState<BSTokenTransfer[]>([]);
  const [nextPage, setNextPage] = useState<BSPageParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchFn = address
      ? () => getEVMAddressTokenTransfers(address)
      : txHash
      ? () => getEVMTransactionTokenTransfers(txHash)
      : null;

    if (!fetchFn) return;

    fetchFn()
      .then((res) => {
        if (!cancelled) { setItems(res.items); setNextPage(res.next_page_params); }
      })
      .catch(() => { if (!cancelled) setError('Failed to load token transfers'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address, txHash]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const fetchFn = address
        ? () => getEVMAddressTokenTransfers(address, params)
        : txHash
        ? () => getEVMTransactionTokenTransfers(txHash, params)
        : null;
      if (!fetchFn) return;
      const res = await fetchFn();
      setItems((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch {
      setError('Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [address, txHash]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>;
  if (items.length === 0) return <div className="text-sm text-zinc-500 py-4">No token transfers found.</div>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700 text-left text-zinc-500 dark:text-zinc-400">
              <th className="pb-2 pr-4 font-medium">Tx Hash</th>
              <th className="pb-2 pr-4 font-medium">Age</th>
              <th className="pb-2 pr-4 font-medium">From</th>
              <th className="pb-2 pr-4 font-medium">To</th>
              <th className="pb-2 pr-4 font-medium">Token</th>
              <th className="pb-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((transfer, idx) => {
              const decimals = Number(transfer.token.decimals ?? '18');
              const amount = transfer.total?.value
                ? formatWei(transfer.total.value, decimals, 6)
                : '—';
              return (
                <tr key={`${transfer.tx_hash}-${transfer.log_index}-${idx}`} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="py-2.5 pr-4 font-mono">
                    <Link to="/txs/$txId" params={{ txId: transfer.tx_hash }} className="text-green-600 dark:text-green-400 hover:underline">
                      {truncateHash(transfer.tx_hash)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-500">{formatRelativeTime(transfer.timestamp)}</td>
                  <td className="py-2.5 pr-4 font-mono">
                    <Link to="/accounts/$address" params={{ address: transfer.from.hash }} className="text-green-600 dark:text-green-400 hover:underline">
                      {truncateHash(transfer.from.hash)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 font-mono">
                    <Link to="/accounts/$address" params={{ address: transfer.to.hash }} className="text-green-600 dark:text-green-400 hover:underline">
                      {truncateHash(transfer.to.hash)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      {transfer.token.icon_url && <img src={transfer.token.icon_url} alt="" className="w-4 h-4 rounded-full" />}
                      <span className="font-medium">{transfer.token.symbol ?? transfer.token.name ?? '?'}</span>
                      <span className="text-xs text-zinc-400">{transfer.token.type}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-mono">{amount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LoadMorePagination nextPageParams={nextPage} isLoading={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
```

- [ ] **Step 2: Create EVMTokenHoldings**

```typescript
import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMAddressTokenBalances } from '@/api/evm';
import type { BSTokenBalance } from '@/types/blockscout';
import { formatWei } from '@/lib/evmUtils';

interface EVMTokenHoldingsProps {
  address: string;
}

export function EVMTokenHoldings({ address }: EVMTokenHoldingsProps) {
  const [balances, setBalances] = useState<BSTokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEVMAddressTokenBalances(address)
      .then((data) => { if (!cancelled) setBalances(data); })
      .catch(() => { if (!cancelled) setError('Failed to load token holdings'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>;
  if (balances.length === 0) return <div className="text-sm text-zinc-500 py-4">No token holdings found.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700 text-left text-zinc-500 dark:text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Token</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 font-medium text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((bal, idx) => {
            const decimals = Number(bal.token.decimals ?? '18');
            return (
              <tr key={`${bal.token.address}-${bal.token_id ?? idx}`} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    {bal.token.icon_url && <img src={bal.token.icon_url} alt="" className="w-5 h-5 rounded-full" />}
                    <div>
                      <span className="font-medium">{bal.token.name ?? 'Unknown'}</span>
                      {bal.token.symbol && <span className="ml-1.5 text-zinc-400">({bal.token.symbol})</span>}
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded">
                    {bal.token.type}
                  </span>
                </td>
                <td className="py-2.5 text-right font-mono">
                  {bal.token.type === 'ERC-20'
                    ? formatWei(bal.value, decimals, 6)
                    : bal.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npx tsc --noEmit`
Expected: Pass (or only unrelated errors)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/evm/EVMTokenTransfers.tsx frontend/app/components/evm/EVMTokenHoldings.tsx
git commit -m "feat(frontend): create EVMTokenTransfers and EVMTokenHoldings components"
```

---

## Chunk 5: EVM Transaction Detail Page

### Task 14: Update TX Route to Detect EVM Hashes

**Files:**
- Modify: `frontend/app/routes/txs/$txId.tsx`

- [ ] **Step 1: Add parallel EVM lookup to the loader**

In the `txs/$txId.tsx` loader, after the existing Cadence transaction fetch, add a fallback EVM lookup. The existing loader tries to fetch from the local API. If it returns 404 and the hash looks like an EVM hash (`0x` + 64 hex), try the EVM endpoint.

Find where the loader handles a failed/empty Cadence transaction response and add:

```typescript
// If Cadence lookup failed and this looks like an EVM hash, try Blockscout
if (!transaction && /^0x[0-9a-fA-F]{64}$/.test(txId)) {
  try {
    const baseUrl = await resolveApiBaseUrl();
    const evmRes = await fetch(`${baseUrl}/flow/evm/transaction/${txId}`);
    if (evmRes.ok) {
      const evmTx = await evmRes.json();
      return { transaction: null, evmTransaction: evmTx, isEVM: true, error: null };
    }
  } catch {}
}

// Note: For better performance, consider firing both Cadence and EVM lookups
// in parallel with Promise.allSettled when the hash is 0x-prefixed.
// The sequential approach above is simpler but adds latency for EVM-only txs.
```

- [ ] **Step 2: Add EVM rendering branch in the component**

At the top of the component function, before existing Cadence rendering:

```typescript
if (data.isEVM && data.evmTransaction) {
  return <EVMTxDetail tx={data.evmTransaction} />;
}
```

Add import: `import { EVMTxDetail } from '@/components/evm/EVMTxDetail';`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/routes/txs/\$txId.tsx
git commit -m "feat(frontend): add EVM transaction fallback in tx route loader"
```

### Task 15: Create EVMTxDetail Component

**Files:**
- Create: `frontend/app/components/evm/EVMTxDetail.tsx`

- [ ] **Step 1: Create component**

```typescript
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { BSTransaction } from '@/types/blockscout';
import { formatWei, formatGas, truncateHash, txStatusLabel } from '@/lib/evmUtils';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { formatRelativeTime } from '@/lib/time';
import { EVMInternalTxList } from './EVMInternalTxList';
import { EVMLogsList } from './EVMLogsList';
import { EVMTokenTransfers } from './EVMTokenTransfers';

type TxTab = 'internal' | 'logs' | 'token-transfers';

interface EVMTxDetailProps {
  tx: BSTransaction;
}

export function EVMTxDetail({ tx }: EVMTxDetailProps) {
  const [activeTab, setActiveTab] = useState<TxTab>('internal');
  const status = txStatusLabel(tx.status);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          EVM Transaction
        </h1>
        <div className="flex items-center gap-2 font-mono text-sm text-zinc-600 dark:text-zinc-400">
          <span>{tx.hash}</span>
          <CopyButton content={tx.hash} />
        </div>
      </div>

      {/* Overview */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Status:</span>
            <span className={`font-medium ${status.color}`}>{status.label}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Block:</span>
            <span className="font-mono">{tx.block_number}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Timestamp:</span>
            {formatRelativeTime(tx.timestamp)}
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Type:</span>
            <span>{tx.type === 2 ? 'EIP-1559' : tx.type === 1 ? 'Access List' : 'Legacy'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">From:</span>
            <Link
              to="/accounts/$address"
              params={{ address: tx.from.hash }}
              className="font-mono text-green-600 dark:text-green-400 hover:underline"
            >
              {truncateHash(tx.from.hash, 10, 8)}
            </Link>
            <CopyButton content={tx.from.hash} />
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">To:</span>
            {tx.to ? (
              <>
                <Link
                  to="/accounts/$address"
                  params={{ address: tx.to.hash }}
                  className="font-mono text-green-600 dark:text-green-400 hover:underline"
                >
                  {truncateHash(tx.to.hash, 10, 8)}
                </Link>
                <CopyButton content={tx.to.hash} />
              </>
            ) : (
              <span className="italic text-zinc-400">Contract Creation</span>
            )}
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Value:</span>
            <span className="font-mono">{formatWei(tx.value)} FLOW</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Gas:</span>
            <span className="font-mono">{formatGas(tx.gas_used)} / {formatGas(tx.gas_limit)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Gas Price:</span>
            <span className="font-mono">{formatWei(tx.gas_price, 9, 4)} Gwei</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Nonce:</span>
            <span className="font-mono">{tx.nonce}</span>
          </div>
        </div>

        {/* Decoded Input */}
        {tx.decoded_input && (
          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-sm text-zinc-500 mb-1">Input Data (Decoded):</div>
            <div className="font-mono text-sm bg-zinc-50 dark:bg-zinc-800 rounded p-3 overflow-x-auto">
              <div className="text-green-600 dark:text-green-400">{tx.decoded_input.method_call}</div>
              {tx.decoded_input.parameters.map((p, i) => (
                <div key={i} className="text-zinc-600 dark:text-zinc-400 ml-4">
                  <span className="text-zinc-400">{p.name}</span>: <span>{p.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw Input (when not decoded) */}
        {!tx.decoded_input && tx.raw_input && tx.raw_input !== '0x' && (
          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-sm text-zinc-500 mb-1">Input Data (Raw):</div>
            <div className="font-mono text-xs bg-zinc-50 dark:bg-zinc-800 rounded p-3 overflow-x-auto break-all text-zinc-600 dark:text-zinc-400">
              {tx.raw_input}
            </div>
          </div>
        )}

        {/* Revert Reason */}
        {tx.revert_reason && (
          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">Revert Reason:</div>
            <div className="font-mono text-sm bg-red-50 dark:bg-red-900/20 rounded p-3 text-red-700 dark:text-red-300">
              {tx.revert_reason}
            </div>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="border-b border-zinc-200 dark:border-zinc-700 mb-4">
        <div className="flex gap-0 -mb-px">
          {[
            { key: 'internal' as TxTab, label: 'Internal Transactions' },
            { key: 'logs' as TxTab, label: 'Logs' },
            { key: 'token-transfers' as TxTab, label: 'Token Transfers' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'internal' && <EVMInternalTxList txHash={tx.hash} />}
      {activeTab === 'logs' && <EVMLogsList txHash={tx.hash} />}
      {activeTab === 'token-transfers' && <EVMTokenTransfers txHash={tx.hash} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/evm/EVMTxDetail.tsx
git commit -m "feat(frontend): create EVMTxDetail page with overview, decoded input, and sub-tabs"
```

### Task 16: Create EVMLogsList Component

**Files:**
- Create: `frontend/app/components/evm/EVMLogsList.tsx`

- [ ] **Step 1: Create component**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMTransactionLogs } from '@/api/evm';
import type { BSLog, BSPageParams } from '@/types/blockscout';
import { truncateHash } from '@/lib/evmUtils';
import { LoadMorePagination } from '@/components/LoadMorePagination';

interface EVMLogsListProps {
  txHash: string;
}

export function EVMLogsList({ txHash }: EVMLogsListProps) {
  const [logs, setLogs] = useState<BSLog[]>([]);
  const [nextPage, setNextPage] = useState<BSPageParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEVMTransactionLogs(txHash)
      .then((res) => {
        if (!cancelled) { setLogs(res.items); setNextPage(res.next_page_params); }
      })
      .catch(() => { if (!cancelled) setError('Failed to load logs'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [txHash]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const res = await getEVMTransactionLogs(txHash, params);
      setLogs((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch {
      setError('Failed to load more logs');
    } finally {
      setLoadingMore(false);
    }
  }, [txHash]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>;
  if (logs.length === 0) return <div className="text-sm text-zinc-500 py-4">No logs found.</div>;

  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <div key={log.index} className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 text-sm">
          <div className="flex items-center gap-4 mb-3">
            <span className="text-zinc-500">Log Index: <strong className="text-zinc-900 dark:text-zinc-100">{log.index}</strong></span>
            <span className="text-zinc-500">
              Address:{' '}
              <Link
                to="/accounts/$address"
                params={{ address: log.address.hash }}
                className="font-mono text-green-600 dark:text-green-400 hover:underline"
              >
                {truncateHash(log.address.hash)}
              </Link>
              {log.address.name && <span className="ml-1 text-zinc-400">({log.address.name})</span>}
            </span>
          </div>

          {/* Decoded log */}
          {log.decoded && (
            <div className="mb-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30 rounded p-3">
              <div className="font-mono text-green-700 dark:text-green-400 mb-1">{log.decoded.method_call}</div>
              {log.decoded.parameters.map((p, i) => (
                <div key={i} className="font-mono text-xs text-zinc-600 dark:text-zinc-400 ml-4">
                  <span className="text-zinc-400">{p.name}</span> ({p.type}): {p.value}
                </div>
              ))}
            </div>
          )}

          {/* Topics */}
          <div className="mb-2">
            <span className="text-zinc-500 text-xs">Topics:</span>
            {log.topics.map((topic, i) => (
              <div key={i} className="font-mono text-xs text-zinc-600 dark:text-zinc-400 ml-4 break-all">
                [{i}] {topic}
              </div>
            ))}
          </div>

          {/* Data */}
          {log.data && log.data !== '0x' && (
            <div>
              <span className="text-zinc-500 text-xs">Data:</span>
              <div className="font-mono text-xs text-zinc-600 dark:text-zinc-400 ml-4 break-all">
                {log.data}
              </div>
            </div>
          )}
        </div>
      ))}
      <LoadMorePagination nextPageParams={nextPage} isLoading={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/evm/EVMLogsList.tsx
git commit -m "feat(frontend): create EVMLogsList component with decoded event display"
```

---

## Chunk 6: Search Enhancement

### Task 17: Update Search Hook for EVM

**Files:**
- Modify: `frontend/app/hooks/useSearch.ts`
- Modify: `frontend/app/api.ts` (add EVM search types)

- [ ] **Step 1: Add EVM address pattern to useSearch**

In `useSearch.ts`, add a new pattern after the existing `HEX_40`:

```typescript
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;    // 0x-prefixed EVM address
```

Update the `detectPattern` function. Before the existing `HEX_40` check, add:

```typescript
// EVM address with 0x prefix
if (EVM_ADDR.test(q)) {
  return { mode: 'idle', matches: [{ type: 'evm-addr', label: 'EVM Address', value: q, route: `/accounts/${q}` }] };
}
```

Update the existing `HEX_40` match to label as "EVM Address" instead of "COA Address":

```typescript
if (HEX_40.test(q)) {
  return { mode: 'idle', matches: [{ type: 'evm-addr', label: 'EVM Address', value: q, route: `/accounts/0x${q}` }] };
}
```

- [ ] **Step 2: Add parallel EVM search to fuzzy mode**

In the fuzzy search section of `useSearch.ts`, fire both local and EVM searches in parallel:

```typescript
// Inside the debounced fuzzy search callback:
const [localResults, evmResults] = await Promise.allSettled([
  searchAll(q, 3, controller.signal),
  searchEVM(q, controller.signal),
]);

const fuzzy = localResults.status === 'fulfilled' ? localResults.value : { contracts: [], tokens: [], nft_collections: [] };
const evm = evmResults.status === 'fulfilled' ? evmResults.value : { items: [] };

setState({
  mode: 'fuzzy',
  fuzzyResults: fuzzy,
  evmResults: evm.items ?? [],
  // ...
});
```

Add `searchEVM` import: `import { searchEVM } from '@/api/evm';`

- [ ] **Step 3: Update SearchState type to include EVM results**

```typescript
interface SearchState {
  mode: 'idle' | 'quick-match' | 'fuzzy';
  quickMatches: QuickMatchItem[];
  fuzzyResults: SearchAllResponse | null;
  evmResults: BSSearchItem[];  // NEW
  isLoading: boolean;
  error: string | null;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/hooks/useSearch.ts
git commit -m "feat(frontend): add EVM address pattern and parallel Blockscout search"
```

### Task 18: Update SearchDropdown for EVM Results

**Files:**
- Modify: `frontend/app/components/SearchDropdown.tsx`

- [ ] **Step 1: Add EVM results section to fuzzy mode rendering**

In the fuzzy results rendering section, after the existing sections (Contracts, Tokens, NFT Collections), add:

```typescript
{/* EVM Results */}
{state.evmResults && state.evmResults.length > 0 && (
  <div className="py-2">
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
      EVM
    </div>
    {state.evmResults.map((item, i) => {
      const route = item.type === 'address'
        ? `/accounts/${item.address}`
        : item.type === 'transaction'
        ? `/txs/${item.address}`
        : item.url;  // fallback to Blockscout URL
      return (
        <ResultRow
          key={`evm-${i}`}
          item={{
            type: item.type,
            label: item.name || item.address || '?',
            value: item.address || '',
            route: route || '',
            sublabel: item.type,
            badge: 'EVM',
          }}
          // ... existing ResultRow props
        />
      );
    })}
  </div>
)}
```

- [ ] **Step 2: Update Header.tsx for EVM address handling**

In `Header.tsx`, update the search-result navigation logic for the `coa` / `evm-addr` type. Remove the old COA resolution logic and navigate directly:

```typescript
// Replace the COA resolution block with:
if (match.type === 'evm-addr') {
  navigate({ to: '/accounts/$address', params: { address: match.value.startsWith('0x') ? match.value : `0x${match.value}` } });
  return;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/SearchDropdown.tsx frontend/app/components/Header.tsx
git commit -m "feat(frontend): display EVM search results with badge and update address navigation"
```

---

## Chunk 7: COA Account Page (Dual View)

### Task 19: Create COAAccountPage Component

**Files:**
- Create: `frontend/app/components/evm/COAAccountPage.tsx`

This is the dual-view page for Cadence Owned Accounts — shows both Cadence and EVM tabs.

- [ ] **Step 1: Create component**

```typescript
import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { EVMTransactionList } from './EVMTransactionList';
import { EVMInternalTxList } from './EVMInternalTxList';
import { EVMTokenTransfers } from './EVMTokenTransfers';
import { EVMTokenHoldings } from './EVMTokenHoldings';
import { getEVMAddress } from '@/api/evm';
import type { BSAddress } from '@/types/blockscout';
import { formatWei } from '@/lib/evmUtils';

// Import existing Cadence tab components
import { AccountActivityTab } from '@/components/account/AccountActivityTab';
import { AccountTokensTab } from '@/components/account/AccountTokensTab';
import { AccountNFTsTab } from '@/components/account/AccountNFTsTab';
import { AccountContractsTab } from '@/components/account/AccountContractsTab';

type ViewMode = 'cadence' | 'evm';
type CadenceTab = 'activity' | 'tokens' | 'nfts' | 'contracts';
type EVMTab = 'transactions' | 'internal' | 'token-transfers' | 'holdings';

interface COAAccountPageProps {
  evmAddress: string;
  flowAddress: string;
  cadenceAccount: any;  // existing Cadence account data from loader
}

export function COAAccountPage({ evmAddress, flowAddress, cadenceAccount }: COAAccountPageProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('cadence');
  const [cadenceTab, setCadenceTab] = useState<CadenceTab>('activity');
  const [evmTab, setEVMTab] = useState<EVMTab>('transactions');
  const [evmInfo, setEVMInfo] = useState<BSAddress | null>(null);

  useEffect(() => {
    getEVMAddress(evmAddress)
      .then(setEVMInfo)
      .catch(() => {});
  }, [evmAddress]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Dual Address Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            COA Account
          </h1>
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40 rounded">
            Cadence Owned Account
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 w-16">Flow:</span>
            <Link
              to="/accounts/$address"
              params={{ address: flowAddress }}
              className="font-mono text-green-600 dark:text-green-400 hover:underline"
            >
              {flowAddress}
            </Link>
            <CopyButton content={flowAddress} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 w-16">EVM:</span>
            <span className="font-mono text-zinc-600 dark:text-zinc-400">{evmAddress}</span>
            <CopyButton content={evmAddress} />
          </div>
        </div>

        {evmInfo && (
          <div className="mt-2 text-sm text-zinc-500">
            EVM Balance: <strong className="text-zinc-900 dark:text-zinc-100">{formatWei(evmInfo.coin_balance)} FLOW</strong>
          </div>
        )}
      </div>

      {/* View Mode Switcher */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode('cadence')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            viewMode === 'cadence'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          }`}
        >
          Cadence
        </button>
        <button
          onClick={() => setViewMode('evm')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            viewMode === 'evm'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          }`}
        >
          EVM
        </button>
      </div>

      {/* Cadence View */}
      {viewMode === 'cadence' && (
        <>
          <div className="border-b border-zinc-200 dark:border-zinc-700 mb-4">
            <div className="flex gap-0 -mb-px">
              {(['activity', 'tokens', 'nfts', 'contracts'] as CadenceTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCadenceTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                    cadenceTab === tab
                      ? 'border-green-500 text-green-600 dark:text-green-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          {cadenceTab === 'activity' && <AccountActivityTab address={flowAddress} initialTransactions={[]} initialNextCursor="" />}
          {cadenceTab === 'tokens' && <AccountTokensTab address={flowAddress} />}
          {cadenceTab === 'nfts' && <AccountNFTsTab address={flowAddress} />}
          {cadenceTab === 'contracts' && <AccountContractsTab address={flowAddress} />}
        </>
      )}

      {/* EVM View */}
      {viewMode === 'evm' && (
        <>
          <div className="border-b border-zinc-200 dark:border-zinc-700 mb-4">
            <div className="flex gap-0 -mb-px">
              {([
                { key: 'transactions', label: 'Transactions' },
                { key: 'internal', label: 'Internal Txs' },
                { key: 'token-transfers', label: 'Token Transfers' },
                { key: 'holdings', label: 'Token Holdings' },
              ] as { key: EVMTab; label: string }[]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setEVMTab(tab.key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    evmTab === tab.key
                      ? 'border-green-500 text-green-600 dark:text-green-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {evmTab === 'transactions' && <EVMTransactionList address={evmAddress} />}
          {evmTab === 'internal' && <EVMInternalTxList address={evmAddress} />}
          {evmTab === 'token-transfers' && <EVMTokenTransfers address={evmAddress} />}
          {evmTab === 'holdings' && <EVMTokenHoldings address={evmAddress} />}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire COAAccountPage into the account route**

In `accounts/$address.tsx`, update the EVM rendering branch to use COAAccountPage for COA addresses:

```typescript
if (data.isEVM) {
  if (data.isCOA && data.flowAddress) {
    return (
      <COAAccountPage
        evmAddress={data.evmAddress!}
        flowAddress={data.flowAddress}
        cadenceAccount={data.account}
      />
    );
  }
  return (
    <EVMAccountPage
      address={data.evmAddress!}
      flowAddress={data.flowAddress ?? undefined}
      isCOA={data.isCOA}
    />
  );
}
```

Add import: `import { COAAccountPage } from '@/components/evm/COAAccountPage';`

- [ ] **Step 3: Verify full frontend build**

Run: `cd frontend && NODE_OPTIONS="--max-old-space-size=8192" bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/evm/COAAccountPage.tsx frontend/app/routes/accounts/\$address.tsx
git commit -m "feat(frontend): create COAAccountPage with dual Cadence/EVM view"
```

---

## Chunk 8: Verification & Cleanup

### Task 20: Verify Full Stack Build

- [ ] **Step 1: Backend build**

Run: `cd backend && go build ./...`
Expected: No errors

- [ ] **Step 2: Frontend build**

Run: `cd frontend && NODE_OPTIONS="--max-old-space-size=8192" bun run build`
Expected: Build succeeds

- [ ] **Step 3: Frontend lint**

Run: `cd frontend && bun run lint`
Expected: No new lint errors (fix any that appear)

- [ ] **Step 4: Verify all new files are committed**

```bash
git status
```

Expected: Clean working tree

### Task 21: Manual Smoke Test Checklist

These are manual verification steps for after deployment:

- [ ] Navigate to `/accounts/0x<40-hex EOA address>` → should show EVMAccountPage
- [ ] Navigate to `/accounts/0x<40-hex COA address>` → should show COAAccountPage with dual view
- [ ] Navigate to `/accounts/0x<16-hex Flow address>` → should show existing Cadence page (unchanged)
- [ ] Navigate to `/txs/0x<EVM tx hash>` → should show EVMTxDetail
- [ ] Navigate to `/txs/<Cadence tx ID>` → should show existing Cadence detail (unchanged)
- [ ] Search for an EVM address → should show "EVM Address" quick match
- [ ] Search for free text → should show EVM results with `[EVM]` badge alongside local results
- [ ] Click tabs on EVMAccountPage → each tab loads data
- [ ] Click "Load More" → cursor-based pagination works
- [ ] EVMTxDetail shows internal txs, logs, and token transfers
