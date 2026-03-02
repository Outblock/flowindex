# Runner Auth & Key Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Supabase auth and custodial key management to the Cadence Runner, so users can create/import Flow private keys and sign transactions server-side without a wallet extension.

**Architecture:** Runner reuses the main site's Supabase auth (cross-subdomain cookie `fi_auth`). Private keys are AES-256-GCM encrypted and stored in Supabase DB. A new Edge Function handles all key operations (create, import, list, sign, delete). The Runner frontend adds a signer selector that lets users choose between FCL wallet and custodial keys.

**Tech Stack:** Supabase (DB + Edge Functions + Auth), Deno (Edge Functions), @onflow/fcl, Web Crypto API (AES-256-GCM), React, TypeScript

**Reference:** See `docs/plans/2026-03-03-runner-auth-key-management-design.md` for full design doc.

---

### Task 1: Database Migration — `user_keys` Table

**Files:**
- Create: `supabase/migrations/20260303000000_user_keys.sql`

**Step 1: Write the migration SQL**

```sql
-- User custodial keys for Cadence Runner
CREATE TABLE IF NOT EXISTS public.user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  flow_address TEXT NOT NULL,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  key_index INTEGER NOT NULL DEFAULT 0,
  sig_algo TEXT NOT NULL DEFAULT 'ECDSA_P256',
  hash_algo TEXT NOT NULL DEFAULT 'SHA3_256',
  source TEXT NOT NULL CHECK (source IN ('imported', 'created')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: users can only access their own keys
ALTER TABLE public.user_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own keys"
  ON public.user_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own keys"
  ON public.user_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own keys"
  ON public.user_keys FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own keys"
  ON public.user_keys FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups by user
CREATE INDEX idx_user_keys_user_id ON public.user_keys(user_id);
CREATE INDEX idx_user_keys_flow_address ON public.user_keys(flow_address);
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260303000000_user_keys.sql
git commit -m "feat: add user_keys table for custodial key management"
```

---

### Task 2: Edge Function — `flow-keys`

**Files:**
- Create: `supabase/functions/flow-keys/index.ts`

This Edge Function handles all key management operations. It follows the same pattern as the existing `passkey-auth` function (single endpoint, `endpoint` field in request body).

**Step 1: Write the Edge Function**

The function needs these endpoints:
- `POST /keys/create` — generate ECDSA_P256 keypair, call flow-account-creation API, encrypt & store
- `POST /keys/import` — accept private key hex, derive public key, encrypt & store
- `GET /keys/list` — return user's keys (no private key data)
- `POST /keys/sign` — decrypt key, sign message, return signature
- `DELETE /keys/delete` — remove a key

**Key implementation details:**

1. **Encryption (AES-256-GCM via Web Crypto API):**
```typescript
// Encrypt
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await crypto.subtle.importKey(
  'raw', hexToBytes(ENCRYPTION_KEY), 'AES-GCM', false, ['encrypt']
);
const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKeyHex)
);
// Store as base64(iv + ciphertext)  — GCM appends auth tag to ciphertext
const combined = new Uint8Array(iv.length + ciphertext.byteLength);
combined.set(iv);
combined.set(new Uint8Array(ciphertext), iv.length);
return btoa(String.fromCharCode(...combined));
```

2. **ECDSA_P256 key generation (Web Crypto API):**
```typescript
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
);
// Export raw public key (uncompressed, 65 bytes) and private key (PKCS8)
const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
// Remove 0x04 prefix to get 64-byte Flow-compatible public key
const publicKeyHex = bytesToHex(new Uint8Array(publicKeyRaw).slice(1));
const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
// Extract raw 32-byte private key from PKCS8 (last 32 bytes of the DER)
```

3. **Signing (for `/keys/sign`):**
```typescript
// Decrypt the private key
// Import as ECDSA P-256
// Sign the message (Flow uses SHA3_256 hash externally, so we sign raw bytes)
const signature = await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' }, privateKey, messageBytes
);
```

   **Important note on Flow signing:** Flow transactions use a specific signing scheme. The message passed to `/keys/sign` should be the **RLP-encoded envelope** already hashed with the user's chosen hash algorithm. The Edge Function signs the raw hash bytes. The Runner frontend will handle RLP encoding and hashing before calling this endpoint, matching what FCL does internally.

   **Alternative approach (simpler):** Use `@onflow/fcl` or `@onflow/transport-grpc` in the Edge Function to handle the full transaction authorization. This avoids reimplementing Flow's signing scheme. Check if FCL works in Deno — if not, use the raw crypto approach with proper Flow envelope hashing.

4. **Flow account creation API call:**
```typescript
const res = await fetch('https://<your-api>/v1/address', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${FLOW_ACCOUNT_CREATION_API_KEY}`
  },
  body: JSON.stringify({
    publicKey: publicKeyHex,
    signatureAlgorithm: 'ECDSA_P256',
    hashAlgorithm: 'SHA3_256',
    weight: 1000
  })
});
```

5. **Auth pattern (same as passkey-auth):**
```typescript
// For authenticated endpoints, extract user from JWT
const authHeader = req.headers.get('Authorization');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const userClient = createClient(supabaseUrl, supabaseAnonKey, {
  global: { headers: { Authorization: authHeader || '' } }
});
const { data: { user } } = await userClient.auth.getUser();
if (!user) return error('UNAUTHORIZED', 'Authentication required');
```

**Env vars needed:**
- `ENCRYPTION_KEY` — 32-byte hex string for AES-256 master key
- `FLOW_ACCOUNT_CREATION_API_URL` — URL of flow-account-creation service
- `FLOW_ACCOUNT_CREATION_API_KEY` — API key for the service
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (already available)

**Step 2: Commit**

```bash
git add supabase/functions/flow-keys/index.ts
git commit -m "feat: add flow-keys edge function for custodial key management"
```

---

### Task 3: Runner — Add Supabase Auth Context

**Files:**
- Modify: `runner/package.json` (add `@supabase/supabase-js`)
- Create: `runner/src/auth/AuthContext.tsx`
- Create: `runner/src/auth/supabaseClient.ts`
- Modify: `runner/src/main.tsx` (wrap App with AuthProvider)

The Runner needs to read the cross-subdomain `fi_auth` cookie and/or accept tokens from the main site. We'll reuse the same token parsing logic from `frontend/app/contexts/AuthContext.tsx` but simplified — the Runner only needs to **consume** auth, not provide login UI (users log in on the main site).

**Step 1: Add dependency**

```bash
cd runner && bun add @supabase/supabase-js
```

**Step 2: Create `runner/src/auth/supabaseClient.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;
```

**Step 3: Create `runner/src/auth/AuthContext.tsx`**

Simplified version of `frontend/app/contexts/AuthContext.tsx`:
- Reads `fi_auth` cookie on mount
- Parses JWT to extract user info
- Provides `user`, `accessToken`, `loading`, `signOut`
- Auto-refreshes token before expiry
- No login methods (user logs in on main site, gets redirected)
- Shows "Sign in at flowindex.io" prompt if not authenticated

Key exports:
```typescript
export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  signOut: () => void;
}

export function AuthProvider({ children }: { children: React.ReactNode }) { ... }
export function useAuth(): AuthContextValue { ... }
```

**Step 4: Wrap App in `runner/src/main.tsx`**

```typescript
import { AuthProvider } from './auth/AuthContext';

// Wrap <App /> with <AuthProvider>
```

**Step 5: Add env vars to Runner's Vite config**

Add to `runner/.env.example`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOTRUE_URL=
```

**Step 6: Commit**

```bash
git add runner/package.json runner/bun.lockb runner/src/auth/ runner/src/main.tsx
git commit -m "feat: add Supabase auth context to Runner"
```

---

### Task 4: Runner — `useKeys()` Hook

**Files:**
- Create: `runner/src/auth/useKeys.ts`

This hook provides the interface between Runner frontend and the `flow-keys` Edge Function.

**Step 1: Implement the hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

export interface UserKey {
  id: string;
  label: string;
  flow_address: string;
  public_key: string;
  key_index: number;
  sig_algo: string;
  hash_algo: string;
  source: 'imported' | 'created';
  created_at: string;
}

export function useKeys() {
  const { accessToken, user } = useAuth();
  const [keys, setKeys] = useState<UserKey[]>([]);
  const [loading, setLoading] = useState(false);

  // Call edge function helper
  async function callEdgeFunction(endpoint: string, data: Record<string, unknown> = {}) {
    if (!supabase || !accessToken) throw new Error('Not authenticated');
    const { data: result, error } = await supabase.functions.invoke('flow-keys', {
      body: { endpoint, data },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) throw error;
    if (!result.success) throw new Error(result.error?.message || 'Unknown error');
    return result.data;
  }

  const fetchKeys = useCallback(async () => { ... }, [accessToken]);
  const createKey = useCallback(async (label: string, network: 'mainnet' | 'testnet') => { ... }, [accessToken]);
  const importKey = useCallback(async (privateKeyHex: string, label: string) => { ... }, [accessToken]);
  const signMessage = useCallback(async (keyId: string, message: string) => { ... }, [accessToken]);
  const deleteKey = useCallback(async (keyId: string) => { ... }, [accessToken]);

  // Auto-fetch keys when user is authenticated
  useEffect(() => {
    if (user) fetchKeys();
  }, [user, fetchKeys]);

  return { keys, loading, fetchKeys, createKey, importKey, signMessage, deleteKey };
}
```

**Step 2: Commit**

```bash
git add runner/src/auth/useKeys.ts
git commit -m "feat: add useKeys hook for custodial key management"
```

---

### Task 5: Runner UI — Key Management Panel

**Files:**
- Create: `runner/src/components/KeyManager.tsx`
- Modify: `runner/src/App.tsx` (add key manager access)

A settings/modal panel where users can:
- See list of saved keys (label, address, source badge)
- Create a new Flow address (label input + "Create" button)
- Import an existing private key (paste hex + label)
- Delete a key (with confirmation)

**Step 1: Build `KeyManager.tsx`**

Component structure:
```
KeyManager
├── Header: "My Keys" + Close button
├── Key list (or empty state)
│   └── KeyRow: label, address (truncated), source badge, delete icon
├── Create section: label input + network select + "Create Address" button
└── Import section: private key textarea + label input + "Import" button
```

Style: match Runner's existing dark theme (`bg-zinc-900`, `text-zinc-100`, `border-zinc-700`).

**Step 2: Add key manager toggle to `App.tsx` header**

Add a `Key` icon button next to the wallet button in the header (line ~467-477 area).
When clicked, show KeyManager as a slide-out panel or modal overlay.

Only show the key icon when user is authenticated (`useAuth().user` is not null).

**Step 3: Commit**

```bash
git add runner/src/components/KeyManager.tsx runner/src/App.tsx
git commit -m "feat: add key management UI to Runner"
```

---

### Task 6: Runner — Signer Selector + Custodial Execution

**Files:**
- Modify: `runner/src/flow/execute.ts` (add `executeCustodialTransaction`)
- Create: `runner/src/components/SignerSelector.tsx`
- Modify: `runner/src/App.tsx` (integrate signer selector + custodial flow)

**Step 1: Add `executeCustodialTransaction` to `execute.ts`**

This function:
1. Takes the Cadence code, params, selected key ID, and signMessage callback
2. Builds the transaction envelope
3. Calls the Edge Function to sign it
4. Submits the signed transaction to Flow Access Node
5. Waits for sealing, calls onResult callbacks

```typescript
export async function executeCustodialTransaction(
  code: string,
  paramValues: Record<string, string>,
  signerAddress: string,
  keyIndex: number,
  signFn: (message: string) => Promise<string>,
  onResult: (result: ExecutionResult) => void,
): Promise<void> {
  // Use FCL's SDK send with custom authorization function
  // The authz function returns the signer address + key index + signFn
}
```

**FCL custom authorization pattern:**
```typescript
const authz = (account: any) => ({
  ...account,
  addr: signerAddress,
  keyId: keyIndex,
  signingFunction: async (signable: { message: string }) => ({
    addr: signerAddress,
    keyId: keyIndex,
    signature: await signFn(signable.message),
  }),
});

const txId = await fcl.mutate({
  cadence: code,
  args,
  proposer: authz,
  payer: authz,
  authorizations: [authz],
  limit: 9999,
});
```

**Step 2: Create `SignerSelector.tsx`**

A dropdown/toggle in the header area that lets the user choose:
- **FCL Wallet** (default, existing behavior)
- **[Key Label] (0xABC...DEF)** — one option per saved custodial key

When "Send Transaction" is clicked:
- If FCL selected → existing `executeTransaction()` path
- If custodial key selected → `executeCustodialTransaction()` path

The component:
```
SignerSelector
├── Dropdown trigger: shows current signer (icon + label)
└── Dropdown menu:
    ├── "FCL Wallet" option (with wallet icon)
    └── Map of user's custodial keys (with key icon + label + truncated address)
```

Only shows if `codeType === 'transaction'` and user has at least one custodial key OR a connected FCL wallet.

**Step 3: Update `App.tsx` `handleRun`**

Modify the transaction branch in `handleRun` (line 232-247) to check the selected signer:

```typescript
if (codeType === 'script') {
  const result = await executeScript(activeCode, paramValues);
  setResults([result]);
} else if (selectedSigner.type === 'fcl') {
  await executeTransaction(activeCode, paramValues, (result) => {
    setResults((prev) => [...prev, result]);
  });
} else {
  // Custodial signer
  await executeCustodialTransaction(
    activeCode, paramValues,
    selectedSigner.address, selectedSigner.keyIndex,
    (message) => signMessage(selectedSigner.keyId, message),
    (result) => { setResults((prev) => [...prev, result]); },
  );
}
```

**Step 4: Commit**

```bash
git add runner/src/flow/execute.ts runner/src/components/SignerSelector.tsx runner/src/App.tsx
git commit -m "feat: add signer selector with custodial transaction support"
```

---

### Task 7: Auth Prompt + Polish

**Files:**
- Create: `runner/src/components/AuthPrompt.tsx`
- Modify: `runner/src/App.tsx` (show auth prompt for key features)

**Step 1: Create auth prompt component**

A subtle banner or inline prompt that appears when unauthenticated users try to access key management:
- "Sign in at developer.flowindex.io to manage custodial keys"
- Optional: Link button that opens the main site login in a new tab

**Step 2: Add `.env.example` for Runner**

Document all new env vars:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_GOTRUE_URL=https://auth.flowindex.io
```

**Step 3: Update Runner Dockerfile**

Add build args for Supabase env vars if needed (check if they're already passed through Vite).

**Step 4: Final commit**

```bash
git add runner/src/components/AuthPrompt.tsx runner/.env.example runner/Dockerfile
git commit -m "feat: add auth prompt and env config for Runner key management"
```

---

### Task 8: Build Verification

**Step 1: Run Runner build**

```bash
cd runner && bun run build
```

Fix any TypeScript or build errors.

**Step 2: Run frontend lint**

```bash
cd runner && bun run lint
```

Fix any lint errors.

**Step 3: Manual smoke test checklist**

- [ ] Runner loads without errors when Supabase not configured (graceful fallback)
- [ ] Cross-subdomain cookie is read when available
- [ ] Key manager opens/closes correctly
- [ ] Create key flow works (requires live Supabase + flow-account-creation API)
- [ ] Import key flow works
- [ ] Signer selector shows FCL + custodial options
- [ ] FCL transaction path still works unchanged
- [ ] Custodial transaction signing works
- [ ] Key deletion works with confirmation

**Step 4: Commit any fixes**

---

## Dependency Order

```
Task 1 (DB migration)
    └── Task 2 (Edge Function) — needs table
         └── Task 4 (useKeys hook) — needs edge function API shape
              └── Task 5 (Key Manager UI) — needs hook
              └── Task 6 (Signer + Execute) — needs hook
Task 3 (Auth Context) — independent, can parallel with Task 1-2
    └── Task 4 (useKeys hook) — needs auth context
    └── Task 7 (Auth Prompt) — needs auth context
Task 8 (Build verification) — after all tasks
```

**Parallelizable:** Tasks 1+3 can run in parallel. Tasks 5+6 can run in parallel after Task 4.
