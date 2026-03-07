# Monorepo + Shared Packages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the project into an Nx monorepo and extract `@flowindex/flow-passkey`, `@flowindex/auth-core`, `@flowindex/auth-ui`, and `@flowindex/chat-ui` as shared packages.

**Architecture:** Nx workspace with bun workspaces. Four packages under `packages/`. Each package built with tsup (ESM + types). Consumer apps (frontend, runner, ai/chat) import from packages instead of duplicating code.

**Tech Stack:** Nx, bun workspaces, tsup, TypeScript, React 19, @onflow/fcl, @onflow/rlp, sha3

**Design doc:** `docs/plans/2026-03-07-monorepo-passkey-auth-design.md`

---

## Phase 1: Nx Workspace Setup

### Task 1: Initialize Nx workspace at repo root

**Files:**
- Create: `package.json` (root)
- Create: `nx.json`
- Create: `.npmrc`

**Step 1: Create root package.json with bun workspaces**

```json
{
  "name": "flowindex",
  "private": true,
  "workspaces": [
    "packages/*",
    "frontend",
    "runner",
    "ai/chat/web"
  ],
  "devDependencies": {
    "nx": "^21.3.0",
    "tsup": "^8.5.0",
    "typescript": "^5.9.3"
  },
  "scripts": {
    "build:packages": "nx run-many -t build --projects=tag:package",
    "lint:packages": "nx run-many -t lint --projects=tag:package"
  }
}
```

**Step 2: Create nx.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/nrwl/nx/master/packages/nx/schemas/nx-schema.json",
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true
    },
    "lint": {
      "cache": true
    },
    "test": {
      "cache": true
    }
  },
  "defaultBase": "main"
}
```

**Step 3: Create .npmrc for workspace resolution**

```
node-linker=hoisted
shamefully-hoist=true
```

**Step 4: Install Nx**

Run: `cd /Users/hao/clawd/agents/fw-cs/flowscan-clone/.claude/worktrees/polymorphic-spinning-mccarthy && bun install`
Expected: Nx installed, no errors

**Step 5: Verify Nx works**

Run: `bunx nx --version`
Expected: Prints Nx version (21.x)

**Step 6: Commit**

```bash
git add package.json nx.json .npmrc
git commit -m "chore: initialize Nx workspace with bun workspaces"
```

---

## Phase 2: `@flowindex/flow-passkey` Package

### Task 2: Create flow-passkey package scaffold

**Files:**
- Create: `packages/flow-passkey/package.json`
- Create: `packages/flow-passkey/tsconfig.json`
- Create: `packages/flow-passkey/tsup.config.ts`
- Create: `packages/flow-passkey/project.json`

**Step 1: Create package.json**

```json
{
  "name": "@flowindex/flow-passkey",
  "version": "0.1.0",
  "description": "Flow blockchain passkey wallet SDK — WebAuthn + FLIP-264 transaction signing",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@onflow/rlp": "^1.2.2",
    "sha3": "^2.1.4"
  },
  "peerDependencies": {
    "@onflow/fcl": ">=1.0.0"
  },
  "peerDependenciesMeta": {
    "@onflow/fcl": { "optional": true }
  },
  "devDependencies": {
    "tsup": "^8.5.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  },
  "nx": {
    "tags": ["package"]
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

**Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@onflow/fcl'],
});
```

**Step 4: Create project.json**

```json
{
  "name": "flow-passkey",
  "sourceRoot": "packages/flow-passkey/src",
  "tags": ["package"],
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": { "command": "tsup", "cwd": "packages/flow-passkey" }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": { "command": "tsc --noEmit", "cwd": "packages/flow-passkey" }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": { "command": "vitest run", "cwd": "packages/flow-passkey" }
    }
  }
}
```

**Step 5: Commit**

```bash
git add packages/flow-passkey/
git commit -m "chore: scaffold @flowindex/flow-passkey package"
```

### Task 3: Implement flow-passkey types and utils

**Files:**
- Create: `packages/flow-passkey/src/types.ts`
- Create: `packages/flow-passkey/src/utils.ts`

**Source:** Extract from `runner/src/auth/passkeyEncode.ts` (lines 1-25) and `runner/src/auth/usePasskeyWallet.ts` (lines 98-109)

**Step 1: Create types.ts**

```typescript
export type Voucher = {
  cadence: string;
  refBlock: string;
  computeLimit: number;
  arguments: any[];
  proposalKey: { address: string; keyId: number; sequenceNum: number };
  payer: string;
  authorizers: string[];
  payloadSigs: { address: string; keyId: number; sig: string; extensionData?: string }[];
  envelopeSigs: { address: string; keyId: number; sig: string; extensionData?: string }[];
};

export type Signable = { voucher: Voucher; message?: string };

export interface PasskeySignResult {
  signature: string;        // 64-byte P256 raw hex (r||s)
  extensionData: string;    // FLIP-264: 0x01 + RLP[authData, clientData]
}

export interface PasskeyCredentialResult {
  credentialId: string;
  attestationResponse: {
    attestationObject: string;  // base64url
    clientDataJSON: string;     // base64url
  };
  rawId: string;                // base64url
  type: string;
  publicKeySec1Hex: string;     // P256 uncompressed "04" + x + y
}

export interface PasskeyAssertionResult {
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;        // DER-encoded
  rawId: string;                // base64url
}
```

**Step 2: Create utils.ts**

Copy hex/base64url helpers from `runner/src/auth/passkeyEncode.ts` (bytesToHex, hexToBytes) and `runner/src/auth/usePasskeyWallet.ts` (base64UrlToBytes, bytesToBase64Url).

```typescript
export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '');
  return new Uint8Array((clean.match(/.{1,2}/g) || []).map(b => parseInt(b, 16)));
};

export function base64UrlToBytes(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
```

**Step 3: Commit**

```bash
git add packages/flow-passkey/src/types.ts packages/flow-passkey/src/utils.ts
git commit -m "feat(flow-passkey): add types and utils"
```

### Task 4: Implement flow-passkey encode module

**Files:**
- Create: `packages/flow-passkey/src/encode.ts`

**Source:** Port from `runner/src/auth/passkeyEncode.ts` (lines 26-173). This is the core Flow transaction encoding + FLIP-264 logic.

**Step 1: Create encode.ts**

Port the entire file. Key exports:
- `TRANSACTION_DOMAIN_TAG`
- `sha256(bytes)` — uses `crypto.subtle.digest`
- `sha3_256(hex)` — uses `sha3` library
- `encodeTransactionPayload(voucher)`
- `encodeTransactionEnvelope(voucher)`
- `encodeMessageFromSignable(signable, signerAddress)`
- `derToP256Raw(der)` — DER to raw P256 64-byte signature
- `buildExtensionData(authenticatorData, clientDataJSON)` — FLIP-264

This is a direct port — no changes to logic, just proper imports from local `./types` and `./utils`.

**Step 2: Verify it compiles**

Run: `cd packages/flow-passkey && bun install && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/flow-passkey/src/encode.ts
git commit -m "feat(flow-passkey): add Flow transaction encoding + FLIP-264"
```

### Task 5: Implement flow-passkey webauthn module

**Files:**
- Create: `packages/flow-passkey/src/webauthn.ts`

**Source:** Extract client-side WebAuthn logic from `runner/src/auth/usePasskeyWallet.ts`. Strip out all React hooks, server API calls, and auth context dependencies. Keep only the pure `navigator.credentials.create()` and `navigator.credentials.get()` wrappers.

**Step 1: Create webauthn.ts**

Two functions:
- `createPasskeyCredential(options)` — calls `navigator.credentials.create()`, extracts public key (COSE→SEC1 if available from `getPublicKey()`), returns structured result
- `getPasskeyAssertion(options)` — calls `navigator.credentials.get()`, returns structured assertion data

Note: `createPasskeyCredential` must extract the P256 public key from the attestation response. Use `AuthenticatorAttestationResponse.getPublicKey()` (returns SPKI DER) and convert to SEC1 hex. If `getPublicKey()` is not available (older browsers), return empty string — the server will extract it from COSE.

**Step 2: Verify it compiles**

Run: `cd packages/flow-passkey && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/flow-passkey/src/webauthn.ts
git commit -m "feat(flow-passkey): add WebAuthn credential creation and assertion"
```

### Task 6: Implement flow-passkey signer module + FCL authz

**Files:**
- Create: `packages/flow-passkey/src/signer.ts`

**Source:** Extract signing logic from `runner/src/auth/usePasskeyWallet.ts` `sign()` method (lines 416-453) and add FCL authorization function factory.

**Step 1: Create signer.ts**

Two functions:
- `signFlowTransaction({ messageHex, credentialId, rpId })` — SHA-256 hash message → WebAuthn assertion with hash as challenge → derToP256Raw → buildExtensionData → return `{ signature, extensionData }`
- `createPasskeyAuthz({ address, keyIndex, credentialId, rpId })` — returns an FCL authorization function that internally calls `signFlowTransaction` with the signable message

The FCL authz function must:
1. Return an `account` object with `addr`, `keyId`, `signingFunction`
2. The `signingFunction` receives a `signable`, extracts the message, calls `signFlowTransaction`, returns `{ addr, keyId, signature, extensionData }`

Ref: FCL authorization function spec — `(account) => ({ ...account, addr, keyId, signingFunction })`

**Step 2: Verify it compiles**

Run: `cd packages/flow-passkey && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/flow-passkey/src/signer.ts
git commit -m "feat(flow-passkey): add transaction signing + FCL authz factory"
```

### Task 7: Create index.ts and build

**Files:**
- Create: `packages/flow-passkey/src/index.ts`

**Step 1: Create index.ts — re-export all public API**

```typescript
// Types
export type { Voucher, Signable, PasskeySignResult, PasskeyCredentialResult, PasskeyAssertionResult } from './types';

// WebAuthn
export { createPasskeyCredential, getPasskeyAssertion } from './webauthn';

// Flow signing
export { signFlowTransaction, createPasskeyAuthz } from './signer';

// Encoding utilities
export {
  TRANSACTION_DOMAIN_TAG,
  sha256, sha3_256,
  encodeTransactionPayload, encodeTransactionEnvelope, encodeMessageFromSignable,
  derToP256Raw, buildExtensionData,
} from './encode';

// Helpers
export { bytesToHex, hexToBytes, base64UrlToBytes, bytesToBase64Url } from './utils';
```

**Step 2: Build the package**

Run: `cd packages/flow-passkey && bun run build`
Expected: `dist/index.js` and `dist/index.d.ts` generated

**Step 3: Verify dist output**

Run: `ls packages/flow-passkey/dist/`
Expected: `index.js`, `index.d.ts`, `index.js.map`

**Step 4: Commit**

```bash
git add packages/flow-passkey/
git commit -m "feat(flow-passkey): complete package with build output"
```

---

## Phase 3: `@flowindex/auth-core` Package

### Task 8: Create auth-core package scaffold

**Files:**
- Create: `packages/auth-core/package.json`
- Create: `packages/auth-core/tsconfig.json`
- Create: `packages/auth-core/tsup.config.ts`
- Create: `packages/auth-core/project.json`

**Step 1: Create package.json**

```json
{
  "name": "@flowindex/auth-core",
  "version": "0.1.0",
  "description": "FlowIndex auth core — JWT, cookie, token refresh, GoTrue helpers",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@flowindex/flow-passkey": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.5.0",
    "typescript": "^5.9.3"
  },
  "nx": {
    "tags": ["package"]
  }
}
```

**Step 2: Create tsconfig.json, tsup.config.ts, project.json**

Same structure as flow-passkey. tsup entry: `src/index.ts`. External: `@flowindex/flow-passkey`.

**Step 3: Commit**

```bash
git add packages/auth-core/
git commit -m "chore: scaffold @flowindex/auth-core package"
```

### Task 9: Implement auth-core jwt module

**Files:**
- Create: `packages/auth-core/src/jwt.ts`

**Source:** Extract from `runner/src/auth/AuthContext.tsx` (lines 43-71) and `frontend/app/contexts/AuthContext.tsx` (lines 83-174). Use the frontend's richer `userFromToken` (includes roles/teams parsing) as the canonical implementation.

**Step 1: Create jwt.ts**

Exports:
- `parseJwt(token: string): Record<string, unknown> | null`
- `isExpired(token: string): boolean`
- `secondsUntilExpiry(token: string): number`
- `userFromToken(token: string, options?: { enableRoles?: boolean }): AuthUser | null`
  - When `enableRoles: true`, parse roles/teams from JWT claims (frontend behavior)
  - When false or omitted, return simple `{ id, email }` (runner behavior)
- `AuthUser` type (exported)

**Step 2: Verify it compiles**

Run: `cd packages/auth-core && bunx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/auth-core/src/jwt.ts
git commit -m "feat(auth-core): add JWT parsing with optional roles/teams"
```

### Task 10: Implement auth-core cookie module

**Files:**
- Create: `packages/auth-core/src/cookie.ts`

**Source:** Extract from `runner/src/auth/AuthContext.tsx` (lines 92-144) — identical in frontend.

**Step 1: Create cookie.ts**

Exports:
- `loadTokensFromCookie(): StoredTokens | null`
- `loadStoredTokens(storageKey?: string): StoredTokens | null` — cookie first, localStorage fallback
- `persistTokens(accessToken, refreshToken, options?: { storageKey?: string; cookieDomain?: string }): void`
- `clearTokens(options?: { storageKey?: string; cookieDomain?: string }): void`
- `StoredTokens` type

The `cookieDomain` defaults to `.flowindex.io` but is configurable.

**Step 2: Commit**

```bash
git add packages/auth-core/src/cookie.ts
git commit -m "feat(auth-core): add cross-domain cookie token storage"
```

### Task 11: Implement auth-core gotrue module

**Files:**
- Create: `packages/auth-core/src/gotrue.ts`

**Source:** Extract from `runner/src/auth/AuthContext.tsx` (lines 150-169) and `frontend/app/contexts/AuthContext.tsx` (lines 247-260).

**Step 1: Create gotrue.ts**

Exports:
- `gotruePost(gotrueUrl: string, path: string, body?: Record<string, unknown>): Promise<any>`
- `refreshAccessToken(gotrueUrl: string, refreshToken: string): Promise<TokenData>`
- `buildOAuthRedirectUrl(gotrueUrl: string, provider: string, callbackUrl: string): string`
- `TokenData` type: `{ access_token: string; refresh_token: string }`

Key difference from source: `gotrueUrl` is now a parameter, not a module-level constant.

**Step 2: Commit**

```bash
git add packages/auth-core/src/gotrue.ts
git commit -m "feat(auth-core): add GoTrue API helpers"
```

### Task 12: Implement auth-core passkey client

**Files:**
- Create: `packages/auth-core/src/passkey-client.ts`

**Source:** Extract server API interaction from `runner/src/auth/usePasskeyWallet.ts` (lines 78-96, 124-153, 177-279, 308-387, 456-482). Strip all React hooks — keep only the API functions.

**Step 1: Create passkey-client.ts**

```typescript
import { createPasskeyCredential, getPasskeyAssertion, base64UrlToBytes, bytesToBase64Url } from '@flowindex/flow-passkey';

export interface PasskeyClientConfig {
  passkeyAuthUrl: string;  // e.g. https://run.flowindex.io/functions/v1/passkey-auth
  rpId: string;
  rpName: string;
}

export function createPasskeyAuthClient(config: PasskeyClientConfig) {
  // Internal: passkeyApi(endpoint, data, accessToken?)
  // Uses fetch to call config.passkeyAuthUrl

  return {
    // register(accessToken, walletName?) — calls /register/start, then createPasskeyCredential, then /register/finish
    // login(options?) — calls /login/start, then getPasskeyAssertion, then /login/finish → returns tokenHash
    // provisionAccounts(accessToken, credentialId) — calls /wallet/provision-start
    // pollProvisionTx(txId, network) — polls Flow REST API for sealed tx
    // saveProvisionedAddress(accessToken, credentialId, network, address) — calls /wallet/provision-save
    // listPasskeys(accessToken) — calls /passkeys/list
    // listAccounts(accessToken) — calls /wallet/accounts
    // removePasskey(accessToken, credentialId) — calls /passkeys/remove
    // updatePasskey(accessToken, credentialId, name) — calls /passkeys/update
  };
}
```

Port each method from `usePasskeyWallet.ts`, converting from React hook callbacks to plain async functions. Each function takes `accessToken` as parameter instead of reading from context.

The `login()` method must use `getPasskeyAssertion()` from `@flowindex/flow-passkey` instead of inline `navigator.credentials.get()`.

The `register()` method must use `createPasskeyCredential()` from `@flowindex/flow-passkey` instead of inline `navigator.credentials.create()`.

**Step 2: Verify it compiles**

Run: `cd packages/auth-core && bun install && bunx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/auth-core/src/passkey-client.ts
git commit -m "feat(auth-core): add passkey-auth edge function client"
```

### Task 13: Create auth-core index and build

**Files:**
- Create: `packages/auth-core/src/index.ts`

**Step 1: Create index.ts**

```typescript
// JWT
export { parseJwt, isExpired, secondsUntilExpiry, userFromToken } from './jwt';
export type { AuthUser } from './jwt';

// Cookie/storage
export { loadTokensFromCookie, loadStoredTokens, persistTokens, clearTokens } from './cookie';
export type { StoredTokens } from './cookie';

// GoTrue
export { gotruePost, refreshAccessToken, buildOAuthRedirectUrl } from './gotrue';
export type { TokenData } from './gotrue';

// Passkey client
export { createPasskeyAuthClient } from './passkey-client';
export type { PasskeyClientConfig } from './passkey-client';
```

**Step 2: Build**

Run: `cd packages/auth-core && bun run build`
Expected: `dist/` generated successfully

**Step 3: Commit**

```bash
git add packages/auth-core/
git commit -m "feat(auth-core): complete package with build"
```

---

## Phase 4: `@flowindex/auth-ui` Package

### Task 14: Create auth-ui package scaffold

**Files:**
- Create: `packages/auth-ui/package.json`
- Create: `packages/auth-ui/tsconfig.json`
- Create: `packages/auth-ui/tsup.config.ts`
- Create: `packages/auth-ui/project.json`

**Step 1: Create package.json**

```json
{
  "name": "@flowindex/auth-ui",
  "version": "0.1.0",
  "description": "FlowIndex auth React components — AuthProvider, useAuth, LoginModal",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@flowindex/auth-core": "workspace:*",
    "@flowindex/flow-passkey": "workspace:*"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0",
    "framer-motion": ">=11.0.0",
    "lucide-react": ">=0.300.0",
    "input-otp": ">=1.0.0"
  },
  "peerDependenciesMeta": {
    "framer-motion": { "optional": true },
    "input-otp": { "optional": true }
  },
  "devDependencies": {
    "@types/react": "^19.2.13",
    "@types/react-dom": "^19.2.3",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "framer-motion": "^12.34.3",
    "lucide-react": "^0.563.0",
    "input-otp": "^1.4.2",
    "tsup": "^8.5.0",
    "typescript": "^5.9.3"
  },
  "nx": {
    "tags": ["package"]
  }
}
```

**Step 2: Create tsconfig.json**

Same as flow-passkey but add `"jsx": "react-jsx"` to compilerOptions.

**Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    'react', 'react-dom', 'framer-motion', 'lucide-react', 'input-otp',
    '@flowindex/auth-core', '@flowindex/flow-passkey',
  ],
  jsx: 'automatic',
});
```

**Step 4: Commit**

```bash
git add packages/auth-ui/
git commit -m "chore: scaffold @flowindex/auth-ui package"
```

### Task 15: Implement AuthProvider

**Files:**
- Create: `packages/auth-ui/src/AuthProvider.tsx`
- Create: `packages/auth-ui/src/useAuth.ts`
- Create: `packages/auth-ui/src/types.ts`

**Source:** Unify `runner/src/auth/AuthContext.tsx` and `frontend/app/contexts/AuthContext.tsx`. Use config object to control feature flags.

**Step 1: Create types.ts**

Export `AuthConfig`, `AuthContextValue`, `OAuthProvider` types as defined in the design doc.

**Step 2: Create AuthProvider.tsx**

Unified provider that:
- Reads from `config.gotrueUrl` (not module-level constant)
- Uses `@flowindex/auth-core` functions: `loadStoredTokens`, `persistTokens`, `clearTokens`, `userFromToken`, `refreshAccessToken`, `gotruePost`, `secondsUntilExpiry`, `isExpired`
- When `config.cookieDomain` is set, passes it to `persistTokens`/`clearTokens`
- When `config.enableLogoutDetection` is true, adds the visibility+polling check (from runner)
- When `config.enableRoles` is true, passes to `userFromToken`
- When `config.passkeyAuthUrl` is set, creates passkey client from `@flowindex/auth-core`'s `createPasskeyAuthClient` and exposes `passkey` on context
- `signInWithProvider` builds redirect URL using `config.gotrueUrl` + callback path

**Step 3: Create useAuth.ts**

```typescript
import { useContext } from 'react';
import { AuthContext } from './AuthProvider';
import type { AuthContextValue } from './types';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

**Step 4: Verify it compiles**

Run: `cd packages/auth-ui && bun install && bunx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/auth-ui/src/
git commit -m "feat(auth-ui): add unified AuthProvider with config-driven features"
```

### Task 16: Implement LoginModal

**Files:**
- Create: `packages/auth-ui/src/LoginModal.tsx`

**Source:** Port from `runner/src/components/LoginModal.tsx`. Make it theme-agnostic by using CSS variables instead of hardcoded Tailwind colors.

**Step 1: Create LoginModal.tsx**

Key changes from runner's version:
- Use `useAuth()` from local package instead of direct import
- Replace hardcoded `emerald-400` with `var(--auth-accent, #10b981)` CSS variable
- Replace hardcoded `zinc-900` with `var(--auth-bg, #18181b)` CSS variable
- Accept `showPasskey` prop — when true and passkey configured, show "Sign in with passkey" button
- Accept `className` prop for outer container customization
- InputOTP imported from `input-otp` peer dependency
- Icons from `lucide-react` peer dependency
- Animations from `framer-motion` peer dependency (graceful fallback if not installed)

**Step 2: Verify it compiles**

Run: `cd packages/auth-ui && bunx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/auth-ui/src/LoginModal.tsx
git commit -m "feat(auth-ui): add shared LoginModal with CSS variable theming"
```

### Task 17: Create auth-ui index and build

**Files:**
- Create: `packages/auth-ui/src/index.ts`

**Step 1: Create index.ts**

```typescript
export { AuthProvider } from './AuthProvider';
export { useAuth } from './useAuth';
export { default as LoginModal } from './LoginModal';
export type { AuthConfig, AuthContextValue, OAuthProvider } from './types';

// Re-export core types consumers commonly need
export type { AuthUser, StoredTokens, TokenData } from '@flowindex/auth-core';
```

**Step 2: Build**

Run: `cd packages/auth-ui && bun run build`
Expected: `dist/` generated

**Step 3: Commit**

```bash
git add packages/auth-ui/
git commit -m "feat(auth-ui): complete package with build"
```

---

## Phase 5: Migrate Consumer Apps

### Task 18: Migrate runner to use shared packages

**Files:**
- Modify: `runner/package.json` — add workspace deps, remove `sha3`
- Delete: `runner/src/auth/passkeyEncode.ts` — replaced by `@flowindex/flow-passkey`
- Modify: `runner/src/auth/AuthContext.tsx` — replace with import from `@flowindex/auth-ui`
- Modify: `runner/src/auth/usePasskeyWallet.ts` — rewrite to use `@flowindex/flow-passkey` + `@flowindex/auth-core`
- Modify: `runner/src/components/LoginModal.tsx` — replace with import from `@flowindex/auth-ui`
- Modify: `runner/src/components/SignerSelector.tsx` — update imports
- Modify: `runner/src/components/ConnectModal.tsx` — update imports
- Modify: `runner/src/App.tsx` — wrap with new `<AuthProvider config={...}>`

**Step 1: Add workspace dependencies to runner/package.json**

```json
"dependencies": {
  "@flowindex/flow-passkey": "workspace:*",
  "@flowindex/auth-core": "workspace:*",
  "@flowindex/auth-ui": "workspace:*",
  ...
}
```

Remove: `sha3` (now in flow-passkey).

**Step 2: Delete passkeyEncode.ts**

This file is now `@flowindex/flow-passkey/encode`.

**Step 3: Rewrite runner AuthContext.tsx**

Replace entire file with:
```typescript
export { AuthProvider, useAuth } from '@flowindex/auth-ui';
export type { AuthContextValue, AuthUser } from '@flowindex/auth-ui';
```

**Step 4: Rewrite runner usePasskeyWallet.ts**

Keep as a React hook but delegate to:
- `createPasskeyAuthClient` from `@flowindex/auth-core` for server API calls
- `signFlowTransaction` from `@flowindex/flow-passkey` for signing
- `useAuth()` from `@flowindex/auth-ui` for access token

The hook becomes a thin React wrapper around the headless functions.

**Step 5: Replace LoginModal**

```typescript
export { LoginModal as default } from '@flowindex/auth-ui';
```

Or update imports where used.

**Step 6: Update App.tsx**

Replace `<AuthProvider>` with:
```tsx
import { AuthProvider } from '@flowindex/auth-ui';

<AuthProvider config={{
  gotrueUrl: import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999',
  passkeyAuthUrl: `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/passkey-auth`,
  cookieDomain: '.flowindex.io',
  enableLogoutDetection: true,
  rpId: 'flowindex.io',
  rpName: 'FlowIndex',
}}>
```

**Step 7: Run bun install and verify build**

Run: `cd runner && bun install && bun run build`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add runner/
git commit -m "refactor(runner): migrate to @flowindex/auth-ui + @flowindex/flow-passkey"
```

### Task 19: Migrate frontend to use shared packages

**Files:**
- Modify: `frontend/package.json` — add workspace deps, remove `supakeys`
- Modify: `frontend/app/contexts/AuthContext.tsx` — replace with import from `@flowindex/auth-ui`
- Modify: `frontend/app/client.tsx` or root layout — update `<AuthProvider>` config

**Step 1: Add workspace deps, remove supakeys**

```json
"dependencies": {
  "@flowindex/auth-core": "workspace:*",
  "@flowindex/auth-ui": "workspace:*",
  ...
}
```

Remove: `supakeys`.

**Step 2: Replace AuthContext.tsx**

```typescript
export { AuthProvider, useAuth } from '@flowindex/auth-ui';
export type { AuthContextValue, AuthUser } from '@flowindex/auth-ui';
```

**Step 3: Update AuthProvider config in root**

```tsx
<AuthProvider config={{
  gotrueUrl: import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999',
  passkeyAuthUrl: `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/passkey-auth`,
  cookieDomain: '.flowindex.io',
  enableRoles: true,
  rpId: import.meta.env.VITE_PASSKEY_RP_ID || window.location.hostname,
  rpName: import.meta.env.VITE_PASSKEY_RP_NAME || 'FlowIndex Developer Portal',
}}>
```

**Step 4: Run build**

Run: `cd frontend && bun install && bun run build`
Expected: Build succeeds (may need `NODE_OPTIONS="--max-old-space-size=8192"`)

**Step 5: Commit**

```bash
git add frontend/
git commit -m "refactor(frontend): migrate to @flowindex/auth-ui, remove supakeys"
```

### Task 20: Migrate ai/chat to use auth-core

**Files:**
- Modify: `ai/chat/web/package.json` — add `@flowindex/auth-core` workspace dep
- Modify: `ai/chat/web/middleware.ts` — use `loadTokensFromCookie` from auth-core
- Modify: `ai/chat/web/app/page.tsx` — use `persistTokens` from auth-core for cookie sync
- Modify: `ai/chat/web/components/sidebar.tsx` — update auth state management

**Step 1: Add workspace dep**

```json
"dependencies": {
  "@flowindex/auth-core": "workspace:*",
  ...
}
```

**Step 2: Update middleware.ts**

Replace inline cookie parsing with:
```typescript
import { loadTokensFromCookie } from '@flowindex/auth-core';
```

**Step 3: Update page.tsx auth sync**

Replace inline cookie writing with:
```typescript
import { persistTokens, clearTokens } from '@flowindex/auth-core';
```

**Step 4: Build and verify**

Run: `cd ai/chat/web && bun install && bun run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add ai/chat/web/
git commit -m "refactor(ai-chat): use @flowindex/auth-core for cookie/token management"
```

---

## Phase 6: `@flowindex/chat-ui` Package (outline — implement after Phase 5 verified)

### Task 21: Create chat-ui package scaffold

Same pattern as other packages. Key contents:

```
packages/chat-ui/
  src/
    MessageBubble.tsx      # User/AI message layout
    MarkdownRenderer.tsx   # ReactMarkdown + AnimatedMarkdown + code blocks
    SqlResultTable.tsx     # Search/filter/CSV export table
    ChartRenderer.tsx      # Recharts wrapper with shared color palette
    FlowLogo.tsx           # Flow logo SVG
    ChatModeSelector.tsx   # fast/balanced/deep mode picker
    ChatTransport.tsx      # DefaultChatTransport config wrapper
    utils.ts               # classifyHex, autoLinkHex
    index.ts
  package.json             # peerDeps: react, @ai-sdk/react, react-markdown, recharts, etc.
```

Peer deps: `react`, `@ai-sdk/react`, `react-markdown`, `remark-gfm`, `react-syntax-highlighter`, `recharts`, `@outblock/flowtoken`, `lucide-react`

### Task 22-26: Implement chat-ui components

Extract from all three projects. The ai/chat version is the cleanest (most modular). Use that as base, add the SQL table and chart renderer from runner/frontend.

Details to be planned after Phase 5 is verified working.

---

## Phase 7: CI/CD Updates

### Task 27: Update deploy workflow for Nx

**Files:**
- Modify: `.github/workflows/deploy.yml`

Add a step before building any app:
```yaml
- name: Build shared packages
  run: bunx nx run-many -t build --projects=tag:package
```

Update `dorny/paths-filter` to trigger app rebuilds when packages change:
```yaml
filters:
  frontend:
    - 'frontend/**'
    - 'packages/**'        # rebuild if packages change
  runner:
    - 'runner/**'
    - 'packages/**'
  ai-chat:
    - 'ai/chat/**'
    - 'packages/**'
```

### Task 28: Final cleanup and commit

- Remove dead code from all three apps
- Run `bun run lint` in each app
- Run full build of all apps
- Commit cleanup

```bash
git add -A
git commit -m "chore: cleanup after monorepo migration"
```
