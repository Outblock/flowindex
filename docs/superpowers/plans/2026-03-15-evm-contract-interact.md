# EVM Contract Interact Page — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/interact` page where users can load any deployed EVM contract by address, fetch its ABI from Blockscout, and call read/write methods.

**Architecture:** New route `/interact` with lazy-loaded `InteractPage` component. Reuses existing `ContractInteraction` + `SolidityParamInput` for method execution. Backend Blockscout proxy extended to return ABI and support testnet. Recent contracts persisted in localStorage.

**Tech Stack:** React, viem, wagmi, react-router-dom, Express (server proxy)

---

## Chunk 1: Backend + Type Changes

### Task 1: Extend Blockscout proxy to return ABI and support testnet

**Files:**
- Modify: `runner/server/src/http.ts:37-87`

- [ ] **Step 1: Add testnet Blockscout URL constant**

In `runner/server/src/http.ts`, after line 38 (`const BLOCKSCOUT_BASE = ...`), add:

```typescript
const BLOCKSCOUT_TESTNET_BASE = process.env.BLOCKSCOUT_TESTNET_URL || 'https://evm-testnet.flowscan.io';
```

- [ ] **Step 2: Update the endpoint handler to accept `?network` and return `abi`**

Replace the handler body of `app.get('/api/evm-contracts/:address', ...)` to:

```typescript
app.get('/api/evm-contracts/:address', async (req, res) => {
  const { address } = req.params;
  const network = req.query.network === 'testnet' ? 'testnet' : 'mainnet';
  const base = network === 'testnet' ? BLOCKSCOUT_TESTNET_BASE : BLOCKSCOUT_BASE;

  try {
    const addrRes = await fetch(`${base}/api/v2/addresses/${address}`);
    if (!addrRes.ok) {
      res.json({ verified: false });
      return;
    }
    const addrData = await addrRes.json() as Record<string, unknown>;
    if (!addrData.is_verified) {
      res.json({ verified: false });
      return;
    }

    const scRes = await fetch(`${base}/api/v2/smart-contracts/${address}`);
    if (!scRes.ok) {
      res.json({ verified: false });
      return;
    }
    const scData = await scRes.json() as {
      name?: string;
      abi?: unknown[];
      source_code?: string;
      file_path?: string;
      additional_sources?: { file_path: string; source_code: string }[];
    };

    const files: { path: string; content: string }[] = [];
    const mainName = scData.file_path || `${scData.name || 'Contract'}.sol`;
    if (scData.source_code) {
      files.push({ path: mainName.split('/').pop() || mainName, content: scData.source_code });
    }
    if (scData.additional_sources) {
      for (const src of scData.additional_sources) {
        files.push({
          path: src.file_path.split('/').pop() || src.file_path,
          content: src.source_code,
        });
      }
    }

    res.json({
      verified: true,
      name: scData.name || 'Contract',
      abi: scData.abi || null,
      files,
    });
  } catch (e) {
    console.error('Blockscout proxy error:', e);
    res.status(500).json({ error: 'Failed to fetch from Blockscout' });
  }
});
```

- [ ] **Step 3: Verify server compiles**

Run: `cd runner/server && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add runner/server/src/http.ts
git commit -m "feat(runner): extend Blockscout proxy with ABI and testnet support"
```

---

### Task 2: Make `DeployedContract.deployTxHash` optional

**Files:**
- Modify: `runner/src/flow/evmContract.ts:17-23`
- Modify: `runner/src/components/ContractInteraction.tsx:45-49`

- [ ] **Step 1: Make `deployTxHash` optional in the interface**

In `runner/src/flow/evmContract.ts`, change:

```typescript
  deployTxHash: string;
```

to:

```typescript
  deployTxHash?: string;
```

- [ ] **Step 2: Guard the tx hash display in ResultDisplay**

In `runner/src/components/ContractInteraction.tsx`, the `ResultDisplay` already conditionally renders `{result.txHash && (...)}` so no change needed there. But verify with:

Run: `cd runner && npx tsc --noEmit 2>&1 | grep -i deployTxHash`

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add runner/src/flow/evmContract.ts
git commit -m "feat(runner): make DeployedContract.deployTxHash optional"
```

---

### Task 1.5: Add Vite dev proxy and nginx location for `/api/evm-contracts`

**Files:**
- Modify: `runner/vite.config.ts:27-47`
- Modify: `runner/nginx.conf`

- [ ] **Step 1: Add Vite dev proxy**

In `runner/vite.config.ts`, inside the `proxy` object, add before the closing `}`:

```typescript
      '/api/evm-contracts': {
        target: 'http://localhost:3003',
      },
```

- [ ] **Step 2: Add nginx location for production**

In `runner/nginx.conf`, add this block **before** the catch-all `location /api/` block (before line 73):

```nginx
    # EVM contract proxy — Node.js server (Blockscout ABI fetch)
    location /api/evm-contracts/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

- [ ] **Step 3: Commit**

```bash
git add runner/vite.config.ts runner/nginx.conf
git commit -m "fix(runner): add proxy rules for /api/evm-contracts endpoint"
```

---

## Chunk 2: Routing + Sidebar Entry

### Task 3: Add `interact` to ActivityBar

**Files:**
- Modify: `runner/src/components/ActivityBar.tsx`
- Modify: `runner/src/App.tsx:2083-2085`

- [ ] **Step 1: Add the tab to ActivityBar**

In `runner/src/components/ActivityBar.tsx`:

1. Update import to include `Terminal`:
```typescript
import { Files, Search, GitBranch, Rocket, Terminal, Settings } from 'lucide-react';
```

2. Add `'interact'` to the union type:
```typescript
export type SidebarTab = 'files' | 'search' | 'github' | 'deploy' | 'interact' | 'settings';
```

3. Add the tab entry after deploy (before settings):
```typescript
  { id: 'deploy', icon: Rocket, label: 'Deploy' },
  { id: 'interact', icon: Terminal, label: 'Interact' },
  { id: 'settings', icon: Settings, label: 'Settings' },
```

- [ ] **Step 2: Intercept `interact` tab click in App.tsx**

In `runner/src/App.tsx`, find the `onTabChange` handler (around line 2083):

```typescript
if (tab === 'deploy') { window.location.href = '/deploy'; return; }
```

Add after it:

```typescript
if (tab === 'interact') { window.location.href = '/interact'; return; }
```

- [ ] **Step 3: Add route to Router.tsx**

In `runner/src/Router.tsx`:

1. Add lazy import:
```typescript
const InteractPage = lazy(() => import('./interact/InteractPage'));
```

2. Add route before the catch-all:
```typescript
<Route path="/interact" element={<InteractPage />} />
```

- [ ] **Step 4: Verify TypeScript compiles (will fail — InteractPage doesn't exist yet, that's OK)**

Run: `cd runner && npx tsc --noEmit 2>&1 | grep InteractPage`

Expected: error about missing module (this is expected; we'll create it in the next task)

- [ ] **Step 5: Commit**

```bash
git add runner/src/components/ActivityBar.tsx runner/src/App.tsx runner/src/Router.tsx
git commit -m "feat(runner): add interact tab to sidebar and /interact route"
```

---

## Chunk 3: InteractPage + ContractLoader

### Task 4: Create the InteractPage component

**Files:**
- Create: `runner/src/interact/InteractPage.tsx`

This is the main page component. It orchestrates: header, ContractLoader, ContractInteraction, and RecentContracts.

- [ ] **Step 1: Create the file**

```tsx
// runner/src/interact/InteractPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Terminal } from 'lucide-react';
import type { Abi } from 'viem';
import type { Chain } from 'viem/chains';
import type { DeployedContract } from '../flow/evmContract';
import { flowEvmMainnet, flowEvmTestnet } from '../flow/evmChains';
import ContractInteraction from '../components/ContractInteraction';
import ContractLoader from './ContractLoader';
import RecentContracts, { type RecentContract, loadRecentContracts, saveRecentContract, removeRecentContract } from './RecentContracts';

function getChain(network: string): Chain {
  return network === 'testnet' ? flowEvmTestnet : flowEvmMainnet;
}

export default function InteractPage() {
  // Read URL params
  const params = new URLSearchParams(window.location.search);
  const initialAddress = params.get('address') || '';
  const initialNetwork = params.get('network') || localStorage.getItem('runner:network') || 'mainnet';

  const [network, setNetwork] = useState<'mainnet' | 'testnet'>(
    initialNetwork === 'testnet' ? 'testnet' : 'mainnet',
  );
  const [contract, setContract] = useState<DeployedContract | null>(null);
  const [recentContracts, setRecentContracts] = useState<RecentContract[]>(loadRecentContracts);

  // Sync URL when contract loads
  useEffect(() => {
    if (contract) {
      const url = new URL(window.location.href);
      url.searchParams.set('address', contract.address);
      url.searchParams.set('network', network);
      window.history.replaceState({}, '', url.toString());
    }
  }, [contract, network]);

  const handleContractLoaded = useCallback((address: `0x${string}`, name: string, abi: Abi) => {
    setContract({
      address,
      name,
      abi,
      chainId: network === 'testnet' ? 545 : 747,
    });
    const entry = saveRecentContract({ address, network, name, timestamp: Date.now() });
    setRecentContracts(entry);
  }, [network]);

  // Navigate with URL params so ContractLoader auto-fetches on page load
  const handleSelectRecent = useCallback((recent: RecentContract) => {
    const url = new URL(window.location.href);
    url.searchParams.set('address', recent.address);
    url.searchParams.set('network', recent.network);
    window.location.href = url.toString();
  }, []);

  const handleRemoveRecent = useCallback((c: RecentContract) => {
    const updated = removeRecentContract(c.address, c.network);
    setRecentContracts(updated);
  }, []);

  const chain = getChain(network);

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-200">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-700 bg-zinc-900 shrink-0">
        <Link
          to="/editor"
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          onClick={(e) => { e.preventDefault(); window.location.href = '/editor'; }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Editor
        </Link>
        <div className="w-px h-4 bg-zinc-700" />
        <Terminal className="w-4 h-4 text-purple-400" />
        <h1 className="text-sm font-medium">Contract Interact</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {/* Contract Loader */}
          <ContractLoader
            initialAddress={initialAddress}
            network={network}
            onNetworkChange={setNetwork}
            onContractLoaded={handleContractLoaded}
          />

          {/* Recent Contracts (only shown when no contract loaded) */}
          {!contract && recentContracts.length > 0 && (
            <RecentContracts
              contracts={recentContracts}
              onSelect={handleSelectRecent}
              onRemove={handleRemoveRecent}
            />
          )}

          {/* Contract Interaction */}
          {contract && (
            <ContractInteraction contract={contract} chain={chain} />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify file exists**

Run: `ls runner/src/interact/InteractPage.tsx`

- [ ] **Step 3: Commit (will not compile yet — dependencies missing)**

```bash
git add runner/src/interact/InteractPage.tsx
git commit -m "feat(runner): add InteractPage shell component"
```

---

### Task 5: Create the ContractLoader component

**Files:**
- Create: `runner/src/interact/ContractLoader.tsx`

Handles address input, network selector, Blockscout fetch, and manual ABI paste fallback.

- [ ] **Step 1: Create the file**

```tsx
// runner/src/interact/ContractLoader.tsx
import { useState, useCallback, useEffect } from 'react';
import { Loader2, Download, AlertCircle, ChevronDown } from 'lucide-react';
import type { Abi } from 'viem';

interface ContractLoaderProps {
  initialAddress: string;
  network: 'mainnet' | 'testnet';
  onNetworkChange: (n: 'mainnet' | 'testnet') => void;
  onContractLoaded: (address: `0x${string}`, name: string, abi: Abi) => void;
}

const SERVER_BASE = ''; // Same-origin proxy

function validateAbi(json: unknown): json is Abi {
  if (!Array.isArray(json)) return false;
  return json.every((item: any) => item && typeof item.type === 'string');
}

export default function ContractLoader({
  initialAddress,
  network,
  onNetworkChange,
  onContractLoaded,
}: ContractLoaderProps) {
  const [address, setAddress] = useState(initialAddress);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showManualAbi, setShowManualAbi] = useState(false);
  const [manualAbi, setManualAbi] = useState('');

  // Auto-fetch if initialAddress is provided
  useEffect(() => {
    if (initialAddress) {
      handleFetch(initialAddress);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetch = useCallback(async (addr?: string) => {
    const target = (addr || address).trim();
    if (!target) return;

    // Validate address format (40 hex chars)
    const clean = target.startsWith('0x') ? target.slice(2) : target;
    if (clean.length !== 40 || !/^[0-9a-fA-F]+$/.test(clean)) {
      setError('Invalid EVM address. Must be 40 hex characters.');
      return;
    }

    const fullAddr = target.startsWith('0x') ? target : `0x${target}`;

    setLoading(true);
    setError('');
    setShowManualAbi(false);

    try {
      const res = await fetch(`${SERVER_BASE}/api/evm-contracts/${fullAddr}?network=${network}`);
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();

      if (data.verified && data.abi) {
        onContractLoaded(fullAddr as `0x${string}`, data.name || 'Contract', data.abi);
      } else if (data.verified && !data.abi) {
        setError('Contract is verified but ABI not available. Paste ABI manually.');
        setShowManualAbi(true);
      } else {
        setError('No verified contract found at this address. You can paste an ABI manually.');
        setShowManualAbi(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch contract');
    } finally {
      setLoading(false);
    }
  }, [address, network, onContractLoaded]);

  const handleManualAbiSubmit = useCallback(() => {
    try {
      const parsed = JSON.parse(manualAbi);
      if (!validateAbi(parsed)) {
        setError('Invalid ABI format. Paste a valid JSON ABI array.');
        return;
      }
      const fullAddr = address.trim().startsWith('0x') ? address.trim() : `0x${address.trim()}`;
      onContractLoaded(fullAddr as `0x${string}`, 'Custom Contract', parsed);
    } catch {
      setError('Invalid JSON. Please check your ABI.');
    }
  }, [manualAbi, address, onContractLoaded]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {/* Address input */}
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
          placeholder="0x... (EVM contract address)"
          className="flex-1 bg-zinc-800 text-sm text-zinc-200 px-3 py-2.5 rounded-lg border border-zinc-600 focus:border-zinc-500 focus:outline-none placeholder:text-zinc-600 font-mono"
          autoFocus
        />

        {/* Network selector */}
        <div className="relative">
          <select
            value={network}
            onChange={(e) => onNetworkChange(e.target.value as 'mainnet' | 'testnet')}
            className="appearance-none bg-zinc-800 text-xs text-zinc-300 pl-3 pr-7 py-2.5 rounded-lg border border-zinc-600 focus:border-zinc-500 focus:outline-none cursor-pointer"
          >
            <option value="mainnet">Mainnet</option>
            <option value="testnet">Testnet</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
        </div>

        {/* Load button */}
        <button
          onClick={() => handleFetch()}
          disabled={loading || !address.trim()}
          className="px-4 py-2.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Load
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-900/20 px-3 py-2 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Manual ABI input */}
      {showManualAbi && (
        <div className="space-y-2">
          <textarea
            value={manualAbi}
            onChange={(e) => setManualAbi(e.target.value)}
            placeholder='Paste ABI JSON array here...\n[\n  { "type": "function", "name": "balanceOf", ... }\n]'
            className="w-full h-32 bg-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded-lg border border-zinc-600 focus:border-zinc-500 focus:outline-none font-mono resize-y placeholder:text-zinc-600"
          />
          <button
            onClick={handleManualAbiSubmit}
            disabled={!manualAbi.trim()}
            className="px-4 py-2 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
          >
            Load with ABI
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/interact/ContractLoader.tsx
git commit -m "feat(runner): add ContractLoader component for address input and ABI fetch"
```

---

### Task 6: Create the RecentContracts component

**Files:**
- Create: `runner/src/interact/RecentContracts.tsx`

Handles localStorage persistence and displays recent contract list.

- [ ] **Step 1: Create the file**

```tsx
// runner/src/interact/RecentContracts.tsx
import { Clock, Trash2 } from 'lucide-react';

export interface RecentContract {
  address: string;
  network: 'mainnet' | 'testnet';
  name: string;
  timestamp: number;
}

const STORAGE_KEY = 'runner:recent-contracts';
const MAX_RECENT = 10;

export function loadRecentContracts(): RecentContract[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecentContract(entry: RecentContract): RecentContract[] {
  const existing = loadRecentContracts();
  // Remove duplicate (same address + network)
  const filtered = existing.filter(
    (c) => !(c.address.toLowerCase() === entry.address.toLowerCase() && c.network === entry.network),
  );
  const updated = [entry, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function removeRecentContract(address: string, network: string): RecentContract[] {
  const existing = loadRecentContracts();
  const updated = existing.filter(
    (c) => !(c.address.toLowerCase() === address.toLowerCase() && c.network === network),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface RecentContractsProps {
  contracts: RecentContract[];
  onSelect: (c: RecentContract) => void;
  onRemove?: (c: RecentContract) => void;
}

export default function RecentContracts({ contracts, onSelect, onRemove }: RecentContractsProps) {
  if (contracts.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="w-3 h-3 text-zinc-500" />
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Recent</span>
      </div>
      <div className="space-y-1">
        {contracts.map((c) => (
          <button
            key={`${c.address}-${c.network}`}
            onClick={() => onSelect(c)}
            className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-200 font-medium">{c.name}</span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  c.network === 'mainnet' ? 'bg-emerald-500' : 'bg-amber-500'
                }`} />
                <span className="text-[10px] text-zinc-500">{c.network}</span>
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">{c.address}</span>
            </div>
            <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(c.timestamp)}</span>
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(c); }}
                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-0.5"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/interact/RecentContracts.tsx
git commit -m "feat(runner): add RecentContracts component with localStorage persistence"
```

---

## Chunk 4: Integration + Polish

### Task 7: Add testnet-aware tx hash links to FlowIndex in ContractInteraction

**Files:**
- Modify: `runner/src/components/ContractInteraction.tsx`

- [ ] **Step 1: Add `explorerBaseUrl` prop to ResultDisplay**

In `ContractInteraction.tsx`, update `ResultDisplay` to accept an optional explorer URL:

```tsx
function ResultDisplay({ result, explorerBaseUrl }: { result: ContractCallResult; explorerBaseUrl?: string }) {
```

Replace the txHash section:

```tsx
      {result.txHash && (
        <div className="mt-1 text-zinc-500">
          tx: <span className="text-blue-400">{result.txHash}</span>
        </div>
      )}
```

with:

```tsx
      {result.txHash && (
        <div className="mt-1 text-zinc-500">
          tx:{' '}
          {explorerBaseUrl ? (
            <a
              href={`${explorerBaseUrl}/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              {result.txHash}
            </a>
          ) : (
            <span className="text-blue-400">{result.txHash}</span>
          )}
        </div>
      )}
```

- [ ] **Step 2: Compute explorer URL in FunctionCard and pass it down**

In `FunctionCard`, compute the explorer URL from the chain and pass to `ResultDisplay`:

After the `const { data: walletClient } = useWalletClient();` line, add:

```typescript
  const explorerBaseUrl = contract.chainId === 545
    ? 'https://evm-testnet.flowindex.io'
    : 'https://evm.flowindex.io';
```

Then update both places where `<ResultDisplay result={result} />` is rendered to:

```tsx
<ResultDisplay result={result} explorerBaseUrl={explorerBaseUrl} />
```

(There are two instances: one inside `{expanded && hasInputs && (...)}` and one inside `{!hasInputs && result && (...)}`.)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd runner && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add runner/src/components/ContractInteraction.tsx
git commit -m "feat(runner): link tx hashes to FlowIndex with testnet support"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run TypeScript check**

Run: `cd runner && npx tsc --noEmit`

Expected: no new errors (pre-existing errors are OK)

- [ ] **Step 2: Run dev server and verify**

Run: `cd runner && bun run dev`

1. Open `http://localhost:5173/interact` — page should load
2. Sidebar "Interact" tab should show Terminal icon
3. Enter an EVM address and click Load
4. Recent contracts should appear after first load
5. Back to editor link works

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(runner): polish interact page"
```
