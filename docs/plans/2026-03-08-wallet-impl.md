# Wallet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a passkey-based web wallet at `wallet.flowindex.io` — standalone dashboard + FCL wallet provider for dApps.

**Architecture:** Vite + React SPA. FCL popup protocol for authn/authz. Reuses existing `@flowindex/flow-passkey` (FLIP-264 signing), `@flowindex/auth-core` (passkey client), `@flowindex/auth-ui` (auth hooks). New `@flowindex/flow-ui` shared package extracted from frontend. Backend API already provides all data (FT, NFT, tx history).

**Tech Stack:** Vite, React 19, TypeScript, TailwindCSS, Shadcn/UI, `@onflow/fcl`, `@flowindex/flow-passkey`, `@flowindex/auth-core`, `@flowindex/auth-ui`, React Router (client-side)

---

## Existing Infrastructure (DO NOT rebuild)

These packages are already built and working:

- **`packages/flow-passkey/`** — FLIP-264 signing: `signFlowTransaction()`, `createPasskeyAuthz()`, `encodeMessageFromSignable()`, `derToP256Raw()`, `buildExtensionData()`, WebAuthn credential/assertion wrappers
- **`packages/auth-core/`** — `createPasskeyAuthClient()` with register, login, provisionAccounts, pollProvisionTx, listPasskeys, listAccounts, removePasskey
- **`packages/auth-ui/`** — `AuthProvider`, `useAuth()`, `usePasskeyAuth()`, `LoginModal`
- **`supabase/functions/passkey-auth/`** — Edge function handling all server-side WebAuthn + Lilico provisioning

---

## Phase 1: Shared UI Package (`packages/flow-ui/`)

### Task 1: Scaffold flow-ui package

**Files:**
- Create: `packages/flow-ui/package.json`
- Create: `packages/flow-ui/tsconfig.json`
- Create: `packages/flow-ui/tsup.config.ts`
- Create: `packages/flow-ui/project.json`
- Create: `packages/flow-ui/src/index.ts`
- Create: `packages/flow-ui/tailwind.config.js`

**Step 1: Create package.json**

```json
{
  "name": "@flowindex/flow-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./styles.css": "./dist/styles.css"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.3.0"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "tailwindcss": "^3.4.19",
    "tsup": "^8.5.0",
    "typescript": "^5.9.3"
  },
  "nx": { "tags": ["package"] }
}
```

**Step 2: Create tsup.config.ts**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom'],
  sourcemap: true,
});
```

**Step 3: Create tsconfig.json** — standard React lib TS config with `jsx: "react-jsx"`, `moduleResolution: "bundler"`.

**Step 4: Create project.json** — nx config with build target pointing to `tsup`.

**Step 5: Create src/index.ts** — empty initially, will export components as we add them.

**Step 6: Run `bun install` from monorepo root to link workspace.**

**Step 7: Commit**

```bash
git add packages/flow-ui/
git commit -m "feat(flow-ui): scaffold shared UI component package"
```

---

### Task 2: Extract cn() utility and Shadcn UI primitives

**Files:**
- Read: `frontend/app/lib/utils.ts` (for `cn()` helper)
- Read: `frontend/app/components/ui/` (all Shadcn components)
- Create: `packages/flow-ui/src/lib/utils.ts`
- Create: `packages/flow-ui/src/ui/button.tsx`, `card.tsx`, `badge.tsx`, `dialog.tsx`, `tabs.tsx`, `table.tsx`, `input.tsx`, `select.tsx`, `avatar.tsx`, `separator.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `switch.tsx`

**Step 1:** Copy `cn()` utility from `frontend/app/lib/utils.ts` to `packages/flow-ui/src/lib/utils.ts`.

**Step 2:** Copy all Shadcn UI primitives from `frontend/app/components/ui/` to `packages/flow-ui/src/ui/`. Update import paths for `cn()` to use relative `../lib/utils`.

**Step 3:** Export all UI components from `packages/flow-ui/src/index.ts`:

```ts
export { cn } from './lib/utils';
export { Button } from './ui/button';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
// ... etc for all components
```

**Step 4:** Build and verify: `cd packages/flow-ui && bun run build`

**Step 5: Commit**

```bash
git add packages/flow-ui/
git commit -m "feat(flow-ui): add cn utility and Shadcn UI primitives"
```

---

### Task 3: Extract account utility functions

**Files:**
- Read: `frontend/app/components/account/accountUtils.ts`
- Create: `packages/flow-ui/src/utils/address.ts` — `normalizeAddress()`, `formatShort()`, `isValidFlowAddress()`
- Create: `packages/flow-ui/src/utils/tokens.ts` — `getTokenLogoURL()`, `formatTokenAmount()`, `formatUsdValue()`
- Create: `packages/flow-ui/src/utils/nft.ts` — `getNFTThumbnail()`, `getNFTMedia()`, IPFS URL resolution

**Step 1:** Read `frontend/app/components/account/accountUtils.ts` to identify pure utility functions (no routing/SSR dependencies).

**Step 2:** Extract pure functions into the three files above. Keep the same logic, just update imports.

**Step 3:** Export from `packages/flow-ui/src/index.ts`.

**Step 4:** Build: `cd packages/flow-ui && bun run build`

**Step 5: Commit**

```bash
git add packages/flow-ui/
git commit -m "feat(flow-ui): extract address, token, and NFT utility functions"
```

---

### Task 4: Extract custom components (GlassCard, UsdValue, TokenIcon, badges)

**Files:**
- Read: `frontend/app/components/ui/GlassCard.tsx`
- Read: `frontend/app/components/UsdValue.tsx`
- Read: `frontend/app/components/account/AccountTokensTab.tsx` (for TokenIcon)
- Read: `frontend/app/components/ui/VerifiedBadge.tsx`, `EVMBridgeBadge.tsx`
- Create: `packages/flow-ui/src/components/GlassCard.tsx`
- Create: `packages/flow-ui/src/components/UsdValue.tsx`
- Create: `packages/flow-ui/src/components/TokenIcon.tsx`
- Create: `packages/flow-ui/src/components/VerifiedBadge.tsx`
- Create: `packages/flow-ui/src/components/ImageWithFallback.tsx`

**Step 1:** Copy GlassCard, UsdValue, ImageWithFallback — these are pure display components.

**Step 2:** Extract `TokenIcon` from AccountTokensTab into its own component file. It renders a token logo with fallback gradient — no external dependencies beyond React.

**Step 3:** Copy badge components (VerifiedBadge, EVMBridgeBadge).

**Step 4:** Export all from `packages/flow-ui/src/index.ts`.

**Step 5:** Build + commit.

```bash
git commit -m "feat(flow-ui): add GlassCard, UsdValue, TokenIcon, badge components"
```

---

### Task 5: Extract TransactionRow and activity type derivation

**Files:**
- Read: `frontend/app/components/TransactionRow.tsx`
- Create: `packages/flow-ui/src/components/TransactionRow.tsx`
- Create: `packages/flow-ui/src/types/transaction.ts` — `TokenMetaEntry`, `TransferSummary`, `ActivityType` types

**Step 1:** Read TransactionRow to identify the `deriveActivityType()` function and `ActivityRow` component.

**Step 2:** Extract types (`TokenMetaEntry`, `TransferSummary`) to `types/transaction.ts`.

**Step 3:** Extract `deriveActivityType()` and `ActivityRow` component. The component renders a single transaction row with icon, type badge, counterparties, and transfers. Check for any routing dependencies (e.g., `<Link>` to tx detail page) and make the link component configurable via props or render prop.

**Step 4:** Export + build + commit.

```bash
git commit -m "feat(flow-ui): extract TransactionRow and activity type utils"
```

---

### Task 6: Extract Tailwind config preset

**Files:**
- Read: `frontend/tailwind.config.js`
- Create: `packages/flow-ui/src/tailwind-preset.ts`

**Step 1:** Create a Tailwind preset with the shared config (nothing-green colors, font families, animations). Both `frontend/` and `wallet/` will extend from this preset.

**Step 2:** Export from package.json as a separate entry: `"./tailwind-preset": "./src/tailwind-preset.ts"`.

**Step 3:** Commit.

```bash
git commit -m "feat(flow-ui): add shared Tailwind config preset"
```

---

## Phase 2: Wallet App Scaffold

### Task 7: Scaffold wallet Vite + React app

**Files:**
- Create: `wallet/package.json`
- Create: `wallet/vite.config.ts`
- Create: `wallet/tsconfig.json`
- Create: `wallet/tailwind.config.js`
- Create: `wallet/postcss.config.js`
- Create: `wallet/index.html`
- Create: `wallet/src/main.tsx`
- Create: `wallet/src/App.tsx`
- Create: `wallet/src/index.css`
- Modify: root `package.json` — add `"wallet"` to `workspaces`

**Step 1: Create package.json**

```json
{
  "name": "@flowindex/wallet",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@flowindex/auth-core": "workspace:*",
    "@flowindex/auth-ui": "workspace:*",
    "@flowindex/flow-passkey": "workspace:*",
    "@flowindex/flow-ui": "workspace:*",
    "@onflow/fcl": "^1.21.9",
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-tabs": "^1.1.12",
    "@supabase/supabase-js": "^2.98.0",
    "lucide-react": "^0.563.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.5.2",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.4",
    "tailwindcss": "^3.4.19",
    "typescript": "^5.9.3",
    "vite": "^6.3.5"
  }
}
```

**Step 2: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: { outDir: 'dist' },
});
```

**Step 3: Create index.html** — standard Vite HTML with `<div id="root">` and script tag pointing to `src/main.tsx`.

**Step 4: Create src/main.tsx** — mounts `<App />` into `#root`.

**Step 5: Create src/App.tsx** — React Router setup with placeholder routes:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>Dashboard</div>} />
        <Route path="/authn" element={<div>Authn</div>} />
        <Route path="/authz" element={<div>Authz</div>} />
        <Route path="/sign-message" element={<div>Sign Message</div>} />
        <Route path="/send" element={<div>Send</div>} />
        <Route path="/nfts" element={<div>NFTs</div>} />
        <Route path="/activity" element={<div>Activity</div>} />
        <Route path="/settings" element={<div>Settings</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 6: Create Tailwind + PostCSS config** extending `@flowindex/flow-ui` preset.

**Step 7:** Add `"wallet"` to root `package.json` workspaces array.

**Step 8:** Run `bun install`, verify `bun run dev` from `wallet/` starts Vite on port 5174.

**Step 9: Commit**

```bash
git commit -m "feat(wallet): scaffold Vite + React SPA with routing"
```

---

### Task 8: Add auth context and wallet state management

**Files:**
- Create: `wallet/src/providers/AuthProvider.tsx` — wraps `@flowindex/auth-ui` AuthProvider with wallet-specific config
- Create: `wallet/src/providers/WalletProvider.tsx` — manages active Flow account, credential, network
- Create: `wallet/src/hooks/useWallet.ts` — access wallet state (activeAccount, network, etc.)
- Modify: `wallet/src/App.tsx` — wrap with providers

**Step 1: Create AuthProvider wrapper**

Wraps `@flowindex/auth-ui`'s AuthProvider with config:
```ts
const config = {
  gotrueUrl: import.meta.env.VITE_SUPABASE_URL + '/auth/v1',
  passkeyAuthUrl: import.meta.env.VITE_SUPABASE_URL + '/functions/v1/passkey-auth',
  rpId: 'flowindex.io',
  rpName: 'FlowIndex Wallet',
};
```

**Step 2: Create WalletProvider**

React context managing:
- `activeAccount: PasskeyAccount | null` (from auth-core types)
- `accounts: PasskeyAccount[]` (loaded from passkey-auth /wallet/accounts)
- `network: 'mainnet' | 'testnet'`
- `credentialId: string | null`
- `switchAccount(credentialId)`, `switchNetwork(network)`

Loads accounts from `passkeyAuthClient.listAccounts(accessToken)` on auth.

**Step 3: Create useWallet hook** — `useContext(WalletContext)` with error if not in provider.

**Step 4:** Wrap App with `<AuthProvider><WalletProvider>`.

**Step 5: Commit**

```bash
git commit -m "feat(wallet): add auth and wallet state providers"
```

---

## Phase 3: FCL Popup Protocol

### Task 9: FCL messaging utilities

**Files:**
- Create: `wallet/src/fcl/messaging.ts`
- Create: `wallet/src/fcl/types.ts`

**Step 1: Create types.ts**

```ts
export interface FclService {
  f_type: 'Service';
  f_vsn: '1.0.0';
  type: 'authn' | 'authz' | 'user-signature' | 'pre-authz';
  method: 'POP/RPC';
  uid: string;
  endpoint: string;
  id: string;
  identity?: { f_type: 'Identity'; f_vsn: '1.0.0'; address: string; keyId?: number };
  provider?: { f_type: 'ServiceProvider'; address: string; name?: string; icon?: string };
}

export interface FclAuthnResponse {
  f_type: 'AuthnResponse';
  f_vsn: '1.0.0';
  addr: string;
  services: FclService[];
}

export interface FclCompositeSignature {
  f_type: 'CompositeSignature';
  f_vsn: '1.0.0';
  addr: string;
  keyId: number;
  signature: string;
  extensionData?: string;
}

export interface FclSignable {
  f_type: 'Signable';
  f_vsn: '1.0.1';
  addr: string;
  keyId: number;
  voucher: {
    cadence: string;
    refBlock: string;
    computeLimit: number;
    arguments: any[];
    proposalKey: { address: string; keyId: number; sequenceNum: number };
    payer: string;
    authorizers: string[];
    payloadSigs: any[];
    envelopeSigs: any[];
  };
}
```

**Step 2: Create messaging.ts**

Based on `onflow/passkey-wallet-tech` `src/wallet/messaging.ts`:

```ts
type MessageTarget = Window | null;

function getTarget(): MessageTarget {
  return window.opener || window.parent;
}

export function sendReady() {
  getTarget()?.postMessage({ type: 'FCL:VIEW:READY' }, '*');
}

export function approve(data: unknown) {
  getTarget()?.postMessage({
    type: 'FCL:VIEW:RESPONSE',
    f_type: 'PollingResponse',
    f_vsn: '1.0.0',
    status: 'APPROVED',
    reason: null,
    data,
  }, '*');
}

export function decline(reason: string) {
  getTarget()?.postMessage({
    type: 'FCL:VIEW:RESPONSE',
    f_type: 'PollingResponse',
    f_vsn: '1.0.0',
    status: 'DECLINED',
    reason,
    data: null,
  }, '*');
}

export function close() {
  getTarget()?.postMessage({ type: 'FCL:VIEW:CLOSE' }, '*');
}

export interface ReadyResponseData {
  type: string;
  body?: any;
  data?: any;
  config?: any;
}

export function onReadyResponse(callback: (data: ReadyResponseData) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'FCL:VIEW:READY:RESPONSE') {
      callback(event.data);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
```

**Step 3: Commit**

```bash
git commit -m "feat(wallet): add FCL popup messaging utilities"
```

---

### Task 10: Authn popup page

**Files:**
- Create: `wallet/src/pages/Authn.tsx`

**Step 1: Build authn page**

Based on `passkey-wallet-tech` authn flow:

1. On mount, calls `sendReady()`
2. Listens for `FCL:VIEW:READY:RESPONSE` via `onReadyResponse()`
3. If user not logged in → shows passkey login prompt (use `@flowindex/auth-ui` LoginModal or inline)
4. If logged in → shows account selector (list from WalletProvider)
5. On approval, builds `FclAuthnResponse` with services array:
   - `authn` service → `${origin}/authn`
   - `authz` service → `${origin}/authz`
   - `user-signature` service → `${origin}/sign-message`
6. Calls `approve(authnResponse)`
7. Closes popup: `window.close()`

Key: `identity.address` uses the selected account's `flowAddress` (without 0x prefix).

**Step 2:** Add route in App.tsx: `<Route path="/authn" element={<Authn />} />`

**Step 3: Test manually** — open `http://localhost:5174/authn` in a popup from a test host page.

**Step 4: Commit**

```bash
git commit -m "feat(wallet): implement FCL authn popup page"
```

---

### Task 11: Authz popup page

**Files:**
- Create: `wallet/src/pages/Authz.tsx`

**Step 1: Build authz page**

Based on `passkey-wallet-tech` authz flow:

1. On mount, calls `sendReady()`
2. Listens for `FCL:VIEW:READY:RESPONSE` — receives signable with `voucher`
3. Displays transaction details for user review:
   - Cadence script (truncated preview)
   - Payer, proposer, authorizers
   - Compute limit, argument count
4. On "Approve":
   - Get `messageHex` via `encodeMessageFromSignable(signable, address)` from `@flowindex/flow-passkey`
   - Sign via `signFlowTransaction({ messageHex, credentialId, rpId })` from `@flowindex/flow-passkey`
   - Build `FclCompositeSignature` with addr, keyId, signature, extensionData
   - Call `approve(compositeSignature)`
5. On "Decline" → `decline('User rejected')`
6. Close popup

**Step 2:** Add route in App.tsx.

**Step 3: Commit**

```bash
git commit -m "feat(wallet): implement FCL authz popup page with FLIP-264 signing"
```

---

### Task 12: Sign-message popup page

**Files:**
- Create: `wallet/src/pages/SignMessage.tsx`

**Step 1: Build sign-message page**

Similar to authz but for arbitrary message signing:

1. Mount → `sendReady()`
2. Receive message hex from `FCL:VIEW:READY:RESPONSE`
3. Display decoded message to user
4. On approve: sign with passkey using user-message domain tag (`FLOW-V0.0-user` padded to 32 bytes + message)
5. Return `CompositeSignature`

**Step 2:** Add route in App.tsx.

**Step 3: Commit**

```bash
git commit -m "feat(wallet): implement FCL sign-message popup page"
```

---

### Task 13: Test FCL integration end-to-end

**Files:**
- Create: `wallet/src/pages/TestHost.tsx` — development-only test page

**Step 1:** Create a test host page (only in dev) that:
- Configures FCL with `discovery.wallet` pointing to `http://localhost:5174/authn`
- Has "Connect" button that calls `fcl.authenticate()`
- Has "Send Transaction" button that calls `fcl.mutate()` with a simple Cadence script
- Displays connected address and transaction status

**Step 2:** Test the full flow: connect → get address → sign transaction.

**Step 3: Commit**

```bash
git commit -m "feat(wallet): add FCL integration test host page"
```

---

## Phase 4: Wallet Dashboard

### Task 14: Dashboard layout shell

**Files:**
- Create: `wallet/src/layouts/WalletLayout.tsx` — sidebar/header nav + main content area
- Create: `wallet/src/components/Sidebar.tsx` — nav links (Dashboard, NFTs, Send, Activity, Settings)
- Create: `wallet/src/components/AccountSwitcher.tsx` — dropdown to switch active account
- Create: `wallet/src/components/NetworkBadge.tsx` — shows mainnet/testnet

**Step 1:** Build responsive layout: sidebar on desktop, bottom nav on mobile.

**Step 2:** AccountSwitcher shows all Flow accounts from WalletProvider, allows switching.

**Step 3:** Wrap dashboard routes with `<WalletLayout>` in App.tsx.

**Step 4: Commit**

```bash
git commit -m "feat(wallet): add dashboard layout with sidebar and account switcher"
```

---

### Task 15: API client for wallet

**Files:**
- Create: `wallet/src/api/client.ts` — configured axios/fetch client pointing to backend API
- Create: `wallet/src/api/flow.ts` — Flow account data, FT holdings, NFT collections, tx history

**Step 1:** Set up API client with `VITE_API_URL` (same backend as frontend).

**Step 2:** Create typed API functions:
- `getAccount(address)` — account metadata
- `getAccountFtHoldings(address)` — FT balances (from backend `/flow/v1/account/{address}/ft`)
- `getNftCollections(address)` — NFT collections
- `getAccountTransactions(address, params)` — tx history
- `getTokenPrices()` — prices from `/status/prices`

**Step 3: Commit**

```bash
git commit -m "feat(wallet): add API client for backend data"
```

---

### Task 16: Dashboard home page (balance overview)

**Files:**
- Create: `wallet/src/pages/Dashboard.tsx`

**Step 1:** Build dashboard showing:
- Total portfolio value (USD)
- FLOW balance (from on-chain via FCL `fcl.account()`)
- FT holdings list using `TokenIcon` and `UsdValue` from `@flowindex/flow-ui`
- Recent transactions (last 5) using `TransactionRow` from `@flowindex/flow-ui`

**Step 2:** Fetches data from wallet API client on mount / when activeAccount changes.

**Step 3: Commit**

```bash
git commit -m "feat(wallet): implement dashboard home page with balance overview"
```

---

### Task 17: NFT gallery page

**Files:**
- Create: `wallet/src/pages/NFTs.tsx`

**Step 1:** Build NFT gallery:
- Fetch NFT collections for active account
- Grid layout showing collection thumbnails with counts
- Click collection → expand to show individual NFTs
- NFT detail modal (reuse patterns from frontend's `NFTDetailModal`)
- Use `getNFTThumbnail()`, `getNFTMedia()` from `@flowindex/flow-ui`

**Step 2: Commit**

```bash
git commit -m "feat(wallet): implement NFT gallery page"
```

---

### Task 18: Activity (transaction history) page

**Files:**
- Create: `wallet/src/pages/Activity.tsx`

**Step 1:** Build activity page:
- Paginated transaction list using `TransactionRow` from `@flowindex/flow-ui`
- Filter tabs: All, FT Transfers, NFT Transfers
- Each row links to flowindex.io transaction detail page (external link)

**Step 2: Commit**

```bash
git commit -m "feat(wallet): implement transaction history page"
```

---

### Task 19: Send tokens page

**Files:**
- Create: `wallet/src/pages/Send.tsx`
- Create: `wallet/src/cadence/transfer-flow.ts` — FLOW transfer Cadence script
- Create: `wallet/src/cadence/transfer-ft.ts` — generic FT transfer Cadence script

**Step 1:** Build send page:
- Token selector (FLOW + FT holdings)
- Recipient address input (with validation)
- Amount input (with max button)
- USD value display
- Review step showing transaction details
- Sign with passkey via `createPasskeyAuthz()` from `@flowindex/flow-passkey`
- Submit via `fcl.mutate()` with the passkey authz function
- Transaction status polling

**Step 2:** Add Cadence scripts for FLOW transfer and generic FT transfer (using `FungibleToken.Vault`).

**Step 3: Commit**

```bash
git commit -m "feat(wallet): implement send tokens page with passkey signing"
```

---

### Task 20: Settings page

**Files:**
- Create: `wallet/src/pages/Settings.tsx`

**Step 1:** Build settings page:
- **Passkeys section**: List registered passkeys (from `listPasskeys()`), add new, remove, rename
- **Accounts section**: List Flow accounts with addresses, provision new account
- **Network section**: Switch between mainnet/testnet
- **Security section**: View public keys

**Step 2:** Uses `usePasskeyAuth()` from `@flowindex/auth-ui` for passkey operations.

**Step 3: Commit**

```bash
git commit -m "feat(wallet): implement settings page with passkey management"
```

---

## Phase 5: Update Frontend to Use Shared Package

### Task 21: Migrate frontend to use @flowindex/flow-ui

**Files:**
- Modify: `frontend/package.json` — add `@flowindex/flow-ui` dependency
- Modify: `frontend/app/components/` — update imports for extracted components
- Modify: `frontend/tailwind.config.js` — extend from shared preset

**Step 1:** Add `"@flowindex/flow-ui": "workspace:*"` to frontend dependencies.

**Step 2:** Update imports in frontend components to use `@flowindex/flow-ui` for:
- `cn()` utility
- Shadcn UI primitives (button, card, etc.)
- GlassCard, UsdValue, TokenIcon, badges
- TransactionRow, deriveActivityType
- Utility functions (address formatting, token logos, NFT media)

**Step 3:** Remove duplicated files from `frontend/app/components/ui/` that are now in flow-ui.

**Step 4:** Verify frontend builds: `cd frontend && bun run build`

**Step 5: Commit**

```bash
git commit -m "refactor(frontend): migrate to @flowindex/flow-ui shared package"
```

---

## Phase 6: Deployment

### Task 22: Docker + deployment config

**Files:**
- Create: `wallet/Dockerfile` — multi-stage: bun install + vite build → nginx serve
- Create: `wallet/nginx.conf` — SPA fallback to index.html
- Modify: `docker-compose.yml` — add wallet service
- Modify: `.github/workflows/deploy.yml` — add wallet build + deploy

**Step 1: Create Dockerfile**

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ packages/
COPY wallet/ wallet/
RUN bun install --frozen-lockfile
RUN cd packages/flow-passkey && bun run build
RUN cd packages/auth-core && bun run build
RUN cd packages/auth-ui && bun run build
RUN cd packages/flow-ui && bun run build
RUN cd wallet && bun run build

FROM nginx:alpine
COPY wallet/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/wallet/dist /usr/share/nginx/html
EXPOSE 80
```

**Step 2: Create nginx.conf** — serve static files, SPA fallback (`try_files $uri $uri/ /index.html`).

**Step 3:** Add to docker-compose.yml:
```yaml
wallet:
  build:
    context: .
    dockerfile: wallet/Dockerfile
  ports:
    - "5174:80"
  environment:
    - VITE_API_URL=https://flowindex.io
    - VITE_SUPABASE_URL=https://run.flowindex.io
```

**Step 4:** Add wallet to GitHub Actions deploy workflow with Caddy routing for `wallet.flowindex.io`.

**Step 5: Commit**

```bash
git commit -m "feat(wallet): add Docker and deployment configuration"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-6 | Shared UI package (`@flowindex/flow-ui`) |
| 2 | 7-8 | Wallet app scaffold + providers |
| 3 | 9-13 | FCL popup protocol (authn, authz, sign-message) |
| 4 | 14-20 | Wallet dashboard (balance, NFTs, activity, send, settings) |
| 5 | 21 | Migrate frontend to shared package |
| 6 | 22 | Docker + deployment |

**Critical path:** Phase 1 (shared package) → Phase 2 (scaffold) → Phase 3 (FCL protocol) — this gets the core wallet working. Phases 4-6 can proceed in parallel after Phase 2.

**Key packages already built (no work needed):**
- `@flowindex/flow-passkey` — FLIP-264 signing, DER conversion, WebAuthn
- `@flowindex/auth-core` — passkey auth client, account provisioning
- `@flowindex/auth-ui` — React auth hooks and components
