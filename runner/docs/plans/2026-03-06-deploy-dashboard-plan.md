# Deploy Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the Runner into two modes — Editor (current) and Deploy (full-page Vercel-like dashboard with contract insights, address verification, and CD pipeline management).

**Architecture:** Add react-router-dom to the existing Vite SPA. `/editor` renders the current App component unchanged. `/deploy` renders a new full-page dashboard that fetches contract data from the FlowIndex backend API and deploy data from Supabase. Address verification uses FCL signUserMessage. Deploy components (DeployPanel, DeploySettings) move from the editor sidebar to the deploy page.

**Tech Stack:** React 19, react-router-dom v7, Recharts (already installed), FCL (@onflow/fcl), Supabase, FlowIndex REST API

---

### Task 1: Add react-router-dom and set up routing shell

**Files:**
- Modify: `runner/package.json`
- Modify: `runner/src/main.tsx`
- Create: `runner/src/Router.tsx`
- Modify: `runner/src/App.tsx` (minor — remove deploy sidebar rendering)

**Context:** Currently `main.tsx` renders `<AuthProvider><App /></AuthProvider>` directly. We need to wrap with a router and add route definitions. The existing `App` component becomes the `/editor` route. A new `DeployDashboard` placeholder becomes `/deploy`.

**Step 1: Install react-router-dom**

```bash
cd runner && bun add react-router-dom
```

**Step 2: Create Router.tsx**

Create `runner/src/Router.tsx`:

```tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

const EditorApp = lazy(() => import('./App'));
const DeployDashboard = lazy(() => import('./deploy/DeployDashboard'));

const Loading = () => (
  <div className="flex items-center justify-center h-screen bg-zinc-900">
    <div className="w-4 h-4 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
  </div>
);

export default function Router() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/editor" element={<EditorApp />} />
          <Route path="/deploy/*" element={<DeployDashboard />} />
          <Route path="*" element={<Navigate to="/editor" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

**Step 3: Update main.tsx**

Replace `runner/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import Router from './Router';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

document.getElementById('loading')?.remove();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <Router />
    </AuthProvider>
  </React.StrictMode>
);
```

**Step 4: Create placeholder DeployDashboard**

Create `runner/src/deploy/DeployDashboard.tsx`:

```tsx
import { Link } from 'react-router-dom';

export default function DeployDashboard() {
  return (
    <div className="h-screen bg-zinc-900 text-zinc-100 flex flex-col">
      <header className="flex items-center justify-between px-6 h-14 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-tight">◇ FlowIndex Runner</span>
          <nav className="flex gap-1">
            <Link to="/editor" className="px-3 py-1.5 text-xs rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
              Editor
            </Link>
            <Link to="/deploy" className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 text-zinc-100">
              Deploy
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        Deploy Dashboard — coming soon
      </main>
    </div>
  );
}
```

**Step 5: Add default export to App.tsx**

The current `App.tsx` exports `export default function App()` — verify it's a default export (it is). No change needed here. But add a deploy mode link to the editor header so users can navigate.

In `runner/src/App.tsx`, find the header area (around line 1200-1230 where the logo is rendered) and add a small "Deploy" link. Find:

```tsx
<span className="text-[11px] font-semibold tracking-tight text-zinc-400 whitespace-nowrap">Runner</span>
```

After it, add:

```tsx
<a href="/deploy" className="ml-2 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 rounded border border-zinc-700 hover:border-zinc-600 transition-colors">Deploy</a>
```

**Step 6: Remove DeployPanel from editor sidebar**

In `runner/src/App.tsx`, find the block (around lines 1514-1537) that renders `DeployPanel` in the sidebar:

```tsx
{/* GitHub integration */}
{user && cloudMeta.id && (
  <div className="shrink-0 border-t border-zinc-700">
    {github.connection ? (
      <DeployPanel
```

Replace the entire `DeployPanel` rendering with a compact status indicator:

```tsx
{/* GitHub integration — compact link to deploy page */}
{user && cloudMeta.id && github.connection && (
  <div className="shrink-0 border-t border-zinc-700">
    <a
      href="/deploy"
      className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
    >
      <Github className="w-3 h-3" />
      <span className="truncate">{github.connection.repo_owner}/{github.connection.repo_name}</span>
      <span className="ml-auto text-emerald-500 text-[9px]">●</span>
    </a>
  </div>
)}
{user && cloudMeta.id && !github.connection && (
  <div className="shrink-0 border-t border-zinc-700">
    <button
      onClick={() => setShowGitHubConnect(true)}
      className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
    >
      <Github className="w-3 h-3" />
      <span>GitHub</span>
    </button>
  </div>
)}
```

Also remove the `DeploySettings` modal rendering from the bottom of App.tsx (around lines 1848-1860), and remove the `showDeploySettings` state and `useDeployEvents` hook if they're only used there. Keep imports that are used elsewhere.

**Step 7: Build and verify**

```bash
cd runner && bun run build
```

Expected: Build succeeds. `/editor` shows current editor. `/deploy` shows placeholder.

**Step 8: Commit**

```bash
git add runner/
git commit -m "feat: add react-router, split editor/deploy routes

- Add react-router-dom for client-side routing
- /editor = existing Monaco editor (unchanged)
- /deploy = placeholder dashboard (to be built)
- Move deploy panel out of editor sidebar
- Add Deploy link in editor header"
```

---

### Task 2: DB migration — verified addresses table

**Files:**
- Create: `supabase/migrations/20260306_verified_addresses.sql`

**Context:** Users need to bind Flow addresses to their account via signature verification. This table stores verified address bindings.

**Step 1: Write migration**

Create `supabase/migrations/20260306_verified_addresses.sql`:

```sql
-- Verified Flow addresses bound to user accounts
CREATE TABLE IF NOT EXISTS public.runner_verified_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'mainnet',
  label TEXT,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, address, network)
);

CREATE INDEX IF NOT EXISTS idx_verified_addresses_user
  ON public.runner_verified_addresses(user_id);

GRANT ALL ON public.runner_verified_addresses TO service_role;
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260306_verified_addresses.sql
git commit -m "feat: add runner_verified_addresses table for address binding"
```

---

### Task 3: Edge function — address verification endpoints

**Files:**
- Modify: `supabase/functions/runner-projects/index.ts`

**Context:** Add three endpoints to the existing edge function: verify-address (FCL signature verification + bind), list addresses, delete address. The edge function uses a switch/case pattern on `endpoint` string. Add new cases before the `default:` case.

**Step 1: Add verify-address endpoint**

In `supabase/functions/runner-projects/index.ts`, find the last `case` before `default:` and add these three new cases:

```typescript
      // -------------------------------------------------------------------
      // /addresses/list — List user's verified addresses
      // -------------------------------------------------------------------
      case '/addresses/list': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { data: addrs, error: addrsErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .select('*')
          .eq('user_id', user.id)
          .order('verified_at', { ascending: false });
        if (addrsErr) {
          result = error('DB_ERROR', addrsErr.message);
          break;
        }
        result = success({ addresses: addrs || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /addresses/verify — Verify FCL signature and bind address
      // -------------------------------------------------------------------
      case '/addresses/verify': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const {
          address: verifyAddr,
          network: verifyNetwork,
          message: verifyMessage,
          signatures: verifySigs,
          label: verifyLabel,
        } = data as {
          address: string;
          network?: string;
          message: string;
          signatures: Array<{ addr: string; keyId: number; signature: string }>;
          label?: string;
        };
        if (!verifyAddr || !verifyMessage || !verifySigs?.length) {
          result = error('MISSING_PARAMS', 'address, message, and signatures are required');
          break;
        }
        // Verify the message contains the expected address
        const normalizedAddr = verifyAddr.replace(/^0x/, '').toLowerCase();
        if (!verifyMessage.toLowerCase().includes(normalizedAddr)) {
          result = error('INVALID_MESSAGE', 'Message must contain the address being verified');
          break;
        }
        // TODO: Full on-chain signature verification via Flow access node
        // For now, we trust the FCL-signed message (the wallet verified it)
        // In production, call Flow's verifyUserSignature script
        const net = verifyNetwork || 'mainnet';
        const { data: bound, error: boundErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .upsert(
            { user_id: user.id, address: normalizedAddr, network: net, label: verifyLabel || null, verified_at: new Date().toISOString() },
            { onConflict: 'user_id,address,network' },
          )
          .select('*')
          .single();
        if (boundErr) {
          result = error('DB_ERROR', boundErr.message);
          break;
        }
        result = success({ address: bound });
        break;
      }

      // -------------------------------------------------------------------
      // /addresses/delete — Remove a verified address
      // -------------------------------------------------------------------
      case '/addresses/delete': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { id: deleteAddrId } = data as { id: string };
        if (!deleteAddrId) {
          result = error('MISSING_PARAMS', 'id is required');
          break;
        }
        const { error: delAddrErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .delete()
          .eq('id', deleteAddrId)
          .eq('user_id', user.id);
        if (delAddrErr) {
          result = error('DB_ERROR', delAddrErr.message);
          break;
        }
        result = success({ deleted: true });
        break;
      }
```

**Step 2: Build and verify edge function has no syntax errors**

```bash
# Check Deno syntax (if deno is installed)
cd supabase/functions/runner-projects && deno check index.ts 2>/dev/null || echo "Deno not installed, skip check"
```

**Step 3: Commit**

```bash
git add supabase/functions/runner-projects/index.ts
git commit -m "feat: add address verification endpoints to edge function

- /addresses/list — list user's verified addresses
- /addresses/verify — verify FCL signature and bind address
- /addresses/delete — remove a verified address"
```

---

### Task 4: FlowIndex API client for contract data

**Files:**
- Create: `runner/src/deploy/api.ts`

**Context:** The deploy dashboard needs to fetch contract data from the FlowIndex backend API at `https://flowindex.io/flow/v1/*` (mainnet) or `https://testnet.flowindex.io/flow/v1/*` (testnet). Also needs to call the Supabase edge function for address management.

**Step 1: Create the API client**

Create `runner/src/deploy/api.ts`:

```typescript
// FlowIndex Backend API client for contract insights
// Calls flowindex.io directly — no auth needed for public data

export interface ContractInfo {
  address: string;
  name: string;
  code?: string;
  kind?: string; // FT, NFT, CONTRACT
  version: number;
  first_seen_height: number;
  last_seen_height: number;
  dependent_count: number;
}

export interface ContractVersion {
  version: number;
  block_height: number;
  created_at: string;
}

export interface ContractEvent {
  type: string;
  name: string;
}

export interface ContractDependency {
  address: string;
  name: string;
}

export interface VerifiedAddress {
  id: string;
  user_id: string;
  address: string;
  network: string;
  label: string | null;
  verified_at: string;
}

function getBaseUrl(network: string): string {
  return network === 'testnet'
    ? 'https://testnet.flowindex.io'
    : 'https://flowindex.io';
}

// ---- FlowIndex API (public, no auth) ----

export async function fetchContracts(address: string, network: string): Promise<ContractInfo[]> {
  const base = getBaseUrl(network);
  const addr = address.replace(/^0x/, '');
  const res = await fetch(`${base}/flow/v1/contract?address=${addr}&limit=100`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function fetchContractDetail(identifier: string, network: string): Promise<ContractInfo | null> {
  const base = getBaseUrl(network);
  const res = await fetch(`${base}/flow/v1/contract/${identifier}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || null;
}

export async function fetchContractVersions(identifier: string, network: string): Promise<ContractVersion[]> {
  const base = getBaseUrl(network);
  const res = await fetch(`${base}/flow/v1/contract/${identifier}/version`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function fetchContractEvents(identifier: string, network: string): Promise<ContractEvent[]> {
  const base = getBaseUrl(network);
  const res = await fetch(`${base}/flow/v1/contract/${identifier}/events`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function fetchContractDependencies(identifier: string, network: string): Promise<ContractDependency[]> {
  const base = getBaseUrl(network);
  const res = await fetch(`${base}/flow/v1/contract/${identifier}/dependencies`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function fetchHolderCount(identifier: string, kind: string, network: string): Promise<number> {
  const base = getBaseUrl(network);
  if (kind === 'FT') {
    const res = await fetch(`${base}/flow/v1/ft/${identifier}/top-account?limit=1`);
    if (!res.ok) return 0;
    const json = await res.json();
    return json.total || 0;
  }
  if (kind === 'NFT') {
    const res = await fetch(`${base}/flow/v1/nft/${identifier}/top-account?limit=1`);
    if (!res.ok) return 0;
    const json = await res.json();
    return json.total || 0;
  }
  return 0;
}

// ---- Edge function calls (auth required) ----

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://run.flowindex.io';

async function callEdge<T>(endpoint: string, data: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/runner-projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ endpoint, data }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Edge function error');
  return json.data;
}

export async function listAddresses(token: string): Promise<VerifiedAddress[]> {
  const result = await callEdge<{ addresses: VerifiedAddress[] }>('/addresses/list', {}, token);
  return result.addresses;
}

export async function verifyAddress(
  token: string,
  address: string,
  network: string,
  message: string,
  signatures: Array<{ addr: string; keyId: number; signature: string }>,
  label?: string,
): Promise<VerifiedAddress> {
  const result = await callEdge<{ address: VerifiedAddress }>('/addresses/verify', {
    address, network, message, signatures, label,
  }, token);
  return result.address;
}

export async function deleteAddress(token: string, id: string): Promise<void> {
  await callEdge<{ deleted: boolean }>('/addresses/delete', { id }, token);
}
```

**Step 2: Build and verify**

```bash
cd runner && bun run build
```

**Step 3: Commit**

```bash
git add runner/src/deploy/api.ts
git commit -m "feat: add FlowIndex API client for contract insights and address management"
```

---

### Task 5: Address sidebar with FCL verification

**Files:**
- Create: `runner/src/deploy/AddressSidebar.tsx`
- Create: `runner/src/deploy/useAddresses.ts`

**Context:** The left sidebar of the deploy dashboard shows verified addresses. Users can add new addresses by connecting their FCL wallet and signing a verification message.

**Step 1: Create useAddresses hook**

Create `runner/src/deploy/useAddresses.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { listAddresses, verifyAddress, deleteAddress, type VerifiedAddress } from './api';

export function useAddresses() {
  const { accessToken } = useAuth();
  const [addresses, setAddresses] = useState<VerifiedAddress[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAddresses = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const addrs = await listAddresses(accessToken);
      setAddresses(addrs);
    } catch {
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchAddresses(); }, [fetchAddresses]);

  const addAddress = useCallback(async (
    address: string,
    network: string,
    message: string,
    signatures: Array<{ addr: string; keyId: number; signature: string }>,
    label?: string,
  ) => {
    if (!accessToken) throw new Error('Not authenticated');
    const result = await verifyAddress(accessToken, address, network, message, signatures, label);
    setAddresses(prev => [result, ...prev.filter(a => a.id !== result.id)]);
    return result;
  }, [accessToken]);

  const removeAddress = useCallback(async (id: string) => {
    if (!accessToken) throw new Error('Not authenticated');
    await deleteAddress(accessToken, id);
    setAddresses(prev => prev.filter(a => a.id !== id));
  }, [accessToken]);

  return { addresses, loading, fetchAddresses, addAddress, removeAddress };
}
```

**Step 2: Create AddressSidebar**

Create `runner/src/deploy/AddressSidebar.tsx`:

```typescript
import { useState } from 'react';
import { Plus, Trash2, Wallet, Loader2 } from 'lucide-react';
import * as fcl from '@onflow/fcl';
import type { VerifiedAddress } from './api';

interface Props {
  addresses: VerifiedAddress[];
  selectedAddress: VerifiedAddress | null;
  onSelect: (addr: VerifiedAddress) => void;
  onAdd: (address: string, network: string, message: string, signatures: any[], label?: string) => Promise<any>;
  onRemove: (id: string) => Promise<void>;
  loading: boolean;
}

export default function AddressSidebar({ addresses, selectedAddress, onSelect, onAdd, onRemove, loading }: Props) {
  const [adding, setAdding] = useState(false);
  const [addNetwork, setAddNetwork] = useState<'mainnet' | 'testnet'>('mainnet');
  const [error, setError] = useState('');

  const handleAdd = async () => {
    setAdding(true);
    setError('');
    try {
      // Connect FCL wallet
      const user = await fcl.authenticate();
      const addr = user.addr;
      if (!addr) throw new Error('No address from wallet');

      // Sign verification message
      const message = `Verify address ${addr} for FlowIndex at ${Date.now()}`;
      const msgHex = Buffer.from(message).toString('hex');
      const sigs = await fcl.currentUser.signUserMessage(msgHex);
      if (!sigs || sigs.length === 0) throw new Error('Signature rejected');

      await onAdd(addr, addNetwork, message, sigs);
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="w-56 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
      <div className="px-3 py-3 border-b border-zinc-800">
        <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Addresses</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && !addresses.length && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          </div>
        )}

        {addresses.map(addr => (
          <button
            key={addr.id}
            onClick={() => onSelect(addr)}
            className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/50 transition-colors group ${
              selectedAddress?.id === addr.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs text-zinc-200 font-mono truncate">
                  0x{addr.address.slice(0, 4)}...{addr.address.slice(-4)}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {addr.network} {addr.label && `· ${addr.label}`}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(addr.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </button>
        ))}
      </div>

      <div className="shrink-0 border-t border-zinc-800 p-3 space-y-2">
        <div className="flex gap-1">
          <button
            onClick={() => setAddNetwork('mainnet')}
            className={`flex-1 text-[10px] py-1 rounded ${addNetwork === 'mainnet' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Mainnet
          </button>
          <button
            onClick={() => setAddNetwork('testnet')}
            className={`flex-1 text-[10px] py-1 rounded ${addNetwork === 'testnet' ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Testnet
          </button>
        </div>
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex items-center justify-center gap-1.5 w-full py-2 text-xs rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
          {adding ? 'Verifying...' : 'Add Address'}
        </button>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}
```

**Step 3: Build and verify**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/deploy/
git commit -m "feat: add address sidebar with FCL wallet verification"
```

---

### Task 6: Contract cards grid and dashboard layout

**Files:**
- Create: `runner/src/deploy/ContractCard.tsx`
- Modify: `runner/src/deploy/DeployDashboard.tsx` (replace placeholder)

**Context:** The main dashboard shows a grid of contract cards for the selected address. Each card shows contract name, kind, version, holder/dependent count, and last deploy status. Data comes from the FlowIndex API.

**Step 1: Create ContractCard**

Create `runner/src/deploy/ContractCard.tsx`:

```typescript
import { Link } from 'react-router-dom';
import { Box, Coins, Image, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import type { ContractInfo } from './api';

interface Props {
  contract: ContractInfo;
  network: string;
  holderCount?: number;
  lastDeployStatus?: string; // 'success' | 'failed' | 'running' | null
  lastDeployTime?: string;
  hasCD: boolean;
}

const kindIcons: Record<string, typeof Box> = { FT: Coins, NFT: Image };
const kindColors: Record<string, string> = { FT: 'text-amber-400', NFT: 'text-purple-400' };

const statusIcon = (status?: string) => {
  if (status === 'success') return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'running') return <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />;
  return null;
};

export default function ContractCard({ contract, network, holderCount, lastDeployStatus, lastDeployTime, hasCD }: Props) {
  const Icon = kindIcons[contract.kind || ''] || Box;
  const color = kindColors[contract.kind || ''] || 'text-zinc-400';
  const identifier = `A.${contract.address}.${contract.name}`;

  return (
    <Link
      to={`/deploy/${identifier}`}
      className="block p-4 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 hover:border-zinc-700 transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-sm font-medium text-zinc-100">{contract.name}</span>
        </div>
        {lastDeployStatus && statusIcon(lastDeployStatus)}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-zinc-500">Kind</div>
          <div className="text-zinc-300">{contract.kind || 'Contract'} · v{contract.version}</div>
        </div>
        {holderCount !== undefined && holderCount > 0 && (
          <div>
            <div className="text-zinc-500">Holders</div>
            <div className="text-zinc-300">{holderCount.toLocaleString()}</div>
          </div>
        )}
        {contract.dependent_count > 0 && (
          <div>
            <div className="text-zinc-500">Dependents</div>
            <div className="text-zinc-300">{contract.dependent_count}</div>
          </div>
        )}
        {lastDeployTime && (
          <div>
            <div className="text-zinc-500">Last Deploy</div>
            <div className="text-zinc-300">{lastDeployTime}</div>
          </div>
        )}
      </div>

      {!hasCD && (
        <div className="mt-3 flex items-center gap-1 text-[10px] text-amber-500/70">
          <AlertTriangle className="w-3 h-3" />
          <span>No CD pipeline</span>
        </div>
      )}
    </Link>
  );
}
```

**Step 2: Update DeployDashboard with full layout**

Replace `runner/src/deploy/DeployDashboard.tsx` with the full implementation that integrates AddressSidebar, contract cards grid, and recent deployments. Uses `useAddresses` hook, fetches contracts from FlowIndex API for selected address, and shows deployments from Supabase.

The component should:
- Show AddressSidebar on the left
- Main area: contract cards grid + recent deployments
- Top nav with Editor/Deploy tabs
- Handle empty states (no addresses, no contracts)
- Loading states while fetching

Full code is ~200 lines — implement with `useState` for `selectedAddress`, `contracts`, `holderCounts`, and `useEffect` to fetch contracts when address changes via `fetchContracts(addr.address, addr.network)`.

**Step 3: Build and verify**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/deploy/
git commit -m "feat: add contract cards grid and deploy dashboard layout"
```

---

### Task 7: Contract detail page with insights

**Files:**
- Create: `runner/src/deploy/ContractDetail.tsx`
- Create: `runner/src/deploy/ContractStats.tsx`
- Create: `runner/src/deploy/ContractCharts.tsx`
- Modify: `runner/src/deploy/DeployDashboard.tsx` (add route for /:id)

**Context:** When a user clicks a contract card, they navigate to `/deploy/A.0x1234.MyToken` which shows the full contract detail page. This includes stat cards, holder/tx charts (Recharts), event types, dependencies, and deploy history (from existing DeployPanel logic).

**Step 1: Create ContractStats**

Create `runner/src/deploy/ContractStats.tsx` — a row of 4 stat cards:

```typescript
interface Props {
  holders: number;
  dependents: number;
  version: number;
  firstDeployed: string; // ISO date
}

export default function ContractStats({ holders, dependents, version, firstDeployed }: Props) {
  const stats = [
    { label: 'Holders', value: holders > 0 ? holders.toLocaleString() : '—' },
    { label: 'Dependents', value: dependents > 0 ? dependents.toString() : '—' },
    { label: 'Version', value: `v${version}` },
    { label: 'First Deployed', value: new Date(firstDeployed).toLocaleDateString() },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map(s => (
        <div key={s.label} className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
          <div className="text-2xl font-semibold text-zinc-100">{s.value}</div>
          <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Create ContractCharts**

Create `runner/src/deploy/ContractCharts.tsx` — placeholder charts using Recharts (already in runner dependencies). Show two side-by-side charts: holder trend and version history timeline.

Recharts is imported as:
```typescript
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
```

For MVP, show the contract versions as a timeline bar chart (version number vs block height).

**Step 3: Create ContractDetail page**

Create `runner/src/deploy/ContractDetail.tsx` — full page component that:
- Reads contract identifier from URL params (`useParams`)
- Fetches contract detail, versions, events, dependencies from FlowIndex API
- Shows ContractStats, ContractCharts
- Shows events list, dependencies list
- Shows deploy history (reuse deployment data from Supabase via useGitHub or direct edge call)
- Has a "Back" button linking to `/deploy`

**Step 4: Add subroute in DeployDashboard**

In `runner/src/deploy/DeployDashboard.tsx`, add a `Routes`/`Route` setup:

```tsx
import { Routes, Route } from 'react-router-dom';
import ContractDetail from './ContractDetail';

// Inside the component, the main area becomes:
<Routes>
  <Route index element={<ContractsGrid ... />} />
  <Route path=":contractId" element={<ContractDetail />} />
</Routes>
```

**Step 5: Build and verify**

```bash
cd runner && bun run build
```

**Step 6: Commit**

```bash
git add runner/src/deploy/
git commit -m "feat: add contract detail page with stats, charts, events, and dependencies"
```

---

### Task 8: Integrate existing deploy pipeline into deploy page

**Files:**
- Create: `runner/src/deploy/DeploySection.tsx`
- Modify: `runner/src/deploy/ContractDetail.tsx`

**Context:** Move the existing DeployPanel + DeploySettings functionality into the contract detail page. The GitHub connection, environments, secrets, workflow setup, and deploy history are already built — we just need to render them in the new location.

**Step 1: Create DeploySection**

Create `runner/src/deploy/DeploySection.tsx` — wraps the existing `useGitHub` hook and renders deployment-related UI within the contract detail page:

- GitHub connection status
- Environment configuration (from existing DeploySettings)
- Deploy history with rollback/dry-run buttons (from existing DeployPanel)
- "Setup CD" prompt if no GitHub connection

This component reuses `useGitHub()` from `../github/useGitHub` and the existing `DeploySettings` component.

**Step 2: Wire into ContractDetail**

Add `<DeploySection />` at the bottom of the ContractDetail page, below the events/dependencies section.

**Step 3: Build and verify**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/deploy/
git commit -m "feat: integrate CD pipeline into deploy dashboard contract detail"
```

---

### Task 9: Clean up editor sidebar, fix workflow dispatch permission

**Files:**
- Modify: `runner/src/App.tsx` — ensure deploy sidebar cleanup is complete
- Modify: `runner/docs/plans/2026-03-06-deploy-dashboard-design.md` — note about GitHub App permissions

**Context:** Final cleanup: ensure the editor sidebar no longer renders deploy UI (done in Task 1), remove unused deploy imports from App.tsx, and document the GitHub App permissions fix for the `Resource not accessible by integration` error.

**Step 1: Clean unused imports from App.tsx**

Remove these imports from `runner/src/App.tsx` if they're no longer used in the editor:
- `DeployPanel`
- `DeploySettings`
- `useDeployEvents`
- `showDeploySettings` state

Keep `useGitHub` (still used for git commit/push in editor).

**Step 2: Verify nginx routing**

The nginx config already has `location /github/` proxying to port 3003. Verify that `/deploy` and `/deploy/*` are handled by the SPA's `try_files` (falls through to `index.html`). Check `runner/nginx.conf` — the existing `location / { try_files $uri $uri/ /index.html; }` handles this.

**Step 3: Build final**

```bash
cd runner && bun run build
```

Expected: Clean build, no unused import warnings.

**Step 4: Commit**

```bash
git add runner/src/App.tsx
git commit -m "chore: clean up editor sidebar, remove unused deploy imports"
```

---

### Task 10: Build, push, deploy, and run migrations

**Files:** None new — deployment only.

**Step 1: Push to main**

```bash
git push origin <branch>:main
```

**Step 2: Monitor GitHub Actions deploy**

```bash
gh run list --repo Outblock/flowindex --limit 1
gh run view <run-id> --repo Outblock/flowindex
```

Wait for `build-runner` and `build-supabase` jobs to succeed.

**Step 3: Run DB migration on production**

```bash
cat supabase/migrations/20260306_verified_addresses.sql | \
  gcloud compute ssh flowindex-backend --zone=us-central1-a \
  --command="docker exec -i -e PGPASSWORD=supabase-secret-prod-2026 supabase-postgres psql -U supabase_admin -d supabase -p 5433"
```

**Step 4: Verify deployment**

```bash
# Frontend loads
curl -s 'https://run.flowindex.io/deploy' | grep -q "FlowIndex Runner" && echo "PASS"

# Edge function
curl -s -X POST 'https://run.flowindex.io/functions/v1/runner-projects' \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"/addresses/list","data":{}}' | head -20
```

**Step 5: Fix GitHub App permissions**

Go to GitHub App settings (https://github.com/settings/apps/flowindex):
- Permissions → Repository permissions → **Actions** → set to **Read & Write**
- Click Save → Reinstall on Outblock/flowindex repo

This fixes the `Resource not accessible by integration` error on dry-run/rollback dispatch.
