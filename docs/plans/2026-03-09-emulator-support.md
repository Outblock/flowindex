# Flow Emulator Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add local Flow Emulator as a third network option in Runner with auto-signing via the emulator service account and standard contract auto-deployment.

**Architecture:** Extend `FlowNetwork` type to include `'emulator'`, add emulator config to `NETWORK_CONFIG`, create an emulator-specific signer that uses the well-known service account private key, add a health check + banner UI, and auto-deploy missing standard contracts on connection.

**Tech Stack:** React 19, @onflow/fcl, @trustwallet/wallet-core (for ECDSA_P256 signing), Vite, TypeScript

---

### Task 1: Add Emulator Network Config

**Files:**
- Modify: `runner/src/flow/networks.ts`

**Step 1: Update FlowNetwork type and NETWORK_CONFIG**

In `runner/src/flow/networks.ts`, change the type and add the emulator entry:

```typescript
export type FlowNetwork = 'mainnet' | 'testnet' | 'emulator';

export const NETWORK_CONFIG: Record<FlowNetwork, Record<string, string>> = {
  // ... existing mainnet and testnet entries unchanged ...
  emulator: {
    'accessNode.api': 'http://localhost:8888',
    'discovery.wallet': '',
    'flow.network': 'emulator',
    '0xFungibleToken': '0xee82856bf20e2aa6',
    '0xFungibleTokenSwitchboard': '0xee82856bf20e2aa6',
    '0xFungibleTokenMetadataViews': '0xee82856bf20e2aa6',
    '0xBurner': '0xf8d6e0586b0a20c7',
    '0xFlowToken': '0x0ae53cb6e3f42a79',
    '0xFlowFees': '0xe5a8b7f23e8b548f',
    '0xNonFungibleToken': '0xf8d6e0586b0a20c7',
    '0xMetadataViews': '0xf8d6e0586b0a20c7',
    '0xViewResolver': '0xf8d6e0586b0a20c7',
    '0xEVM': '0xf8d6e0586b0a20c7',
  },
};
```

Note: The emulator contract addresses above are the defaults when running `flow emulator`. The core contracts (FungibleToken, FlowToken, FlowFees) are deployed to specific addresses by the emulator bootstrap. NonFungibleToken, MetadataViews, ViewResolver, EVM, and Burner are NOT pre-deployed — we will deploy them in Task 5. For now, set their addresses to the service account `0xf8d6e0586b0a20c7` as that's where we'll deploy them.

**Step 2: Verify build**

Run: `cd runner && bun run build 2>&1 | head -20`
Expected: No TypeScript errors related to FlowNetwork type.

**Step 3: Commit**

```bash
git add runner/src/flow/networks.ts
git commit -m "feat(runner): add emulator to FlowNetwork type and config"
```

---

### Task 2: Emulator Service Account Signer

**Files:**
- Create: `runner/src/flow/emulatorSigner.ts`
- Test: `runner/src/flow/emulatorSigner.test.ts`

**Step 1: Write the test**

Create `runner/src/flow/emulatorSigner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EMULATOR_SERVICE_ADDRESS, EMULATOR_SERVICE_KEY, buildEmulatorAuthz } from './emulatorSigner';

describe('emulatorSigner', () => {
  it('exports correct service account address', () => {
    expect(EMULATOR_SERVICE_ADDRESS).toBe('f8d6e0586b0a20c7');
  });

  it('exports correct service private key', () => {
    expect(EMULATOR_SERVICE_KEY).toBe('bf9db4706c2fdb9011ee7e170ccac492f05427b96ab41d8bf2d8c58443704b76');
  });

  it('buildEmulatorAuthz returns correct authorization shape', () => {
    const mockAccount = { tempId: 'x', addr: 'x', keyId: 0 };
    const authz = buildEmulatorAuthz(mockAccount);

    expect(authz.addr).toBe('f8d6e0586b0a20c7');
    expect(authz.keyId).toBe(0);
    expect(authz.signatureAlgorithm).toBe(2); // ECDSA_P256
    expect(authz.hashAlgorithm).toBe(3); // SHA3_256
    expect(typeof authz.signingFunction).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd runner && bun run test -- emulatorSigner`
Expected: FAIL — module not found

**Step 3: Implement emulatorSigner.ts**

Create `runner/src/flow/emulatorSigner.ts`:

```typescript
import { fcl } from './fclConfig';
import { signMessage } from '../auth/localKeyManager';

/**
 * Flow Emulator default service account.
 * These are public, well-known test values — NOT secrets.
 * See: https://developers.flow.com/build/tools/emulator
 */
export const EMULATOR_SERVICE_ADDRESS = 'f8d6e0586b0a20c7';
export const EMULATOR_SERVICE_KEY = 'bf9db4706c2fdb9011ee7e170ccac492f05427b96ab41d8bf2d8c58443704b76';

/**
 * Build an FCL authorization function for the emulator service account.
 * Uses ECDSA_P256 + SHA3_256 (emulator defaults).
 */
export function buildEmulatorAuthz(account: any) {
  return {
    ...account,
    tempId: `${EMULATOR_SERVICE_ADDRESS}-0`,
    addr: fcl.sansPrefix(EMULATOR_SERVICE_ADDRESS),
    keyId: 0,
    signingFunction: async (signable: { message: string }) => {
      const signature = await signMessage(
        EMULATOR_SERVICE_KEY,
        signable.message,
        'ECDSA_P256',
        'SHA3_256',
      );
      return {
        addr: fcl.withPrefix(EMULATOR_SERVICE_ADDRESS),
        keyId: 0,
        signature,
      };
    },
    signatureAlgorithm: 2,  // ECDSA_P256
    hashAlgorithm: 3,       // SHA3_256
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd runner && bun run test -- emulatorSigner`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add runner/src/flow/emulatorSigner.ts runner/src/flow/emulatorSigner.test.ts
git commit -m "feat(runner): add emulator service account signer"
```

---

### Task 3: Emulator Health Check Hook

**Files:**
- Create: `runner/src/flow/useEmulatorStatus.ts`

**Step 1: Implement the hook**

Create `runner/src/flow/useEmulatorStatus.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { FlowNetwork } from './networks';

export type EmulatorStatus = 'connected' | 'disconnected' | 'checking';

/**
 * Poll the emulator REST API to determine if it's running.
 * Only active when network === 'emulator'.
 */
export function useEmulatorStatus(network: FlowNetwork) {
  const [status, setStatus] = useState<EmulatorStatus>('checking');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    if (network !== 'emulator') return;
    try {
      const res = await fetch('http://localhost:8888/v1/blocks?height=sealed', {
        signal: AbortSignal.timeout(3000),
      });
      setStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    }
  }, [network]);

  useEffect(() => {
    if (network !== 'emulator') {
      setStatus('checking');
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    // Initial check
    check();

    // Poll every 5 seconds
    timerRef.current = setInterval(check, 5000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [network, check]);

  return { status, recheck: check };
}
```

**Step 2: Verify build**

Run: `cd runner && bun run build 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add runner/src/flow/useEmulatorStatus.ts
git commit -m "feat(runner): add emulator health check hook"
```

---

### Task 4: UI — Network Selector, Signer Lock, and Banner

**Files:**
- Modify: `runner/src/App.tsx`
- Modify: `runner/src/components/SignerSelector.tsx`

**Step 1: Update App.tsx — imports and state**

Add imports at the top of `runner/src/App.tsx`:

```typescript
import { useEmulatorStatus } from './flow/useEmulatorStatus';
import { buildEmulatorAuthz, EMULATOR_SERVICE_ADDRESS } from './flow/emulatorSigner';
import { Terminal } from 'lucide-react';  // add to existing lucide import
```

Add hook near other hooks (after the `network` state):

```typescript
const { status: emulatorStatus, recheck: recheckEmulator } = useEmulatorStatus(network);
```

**Step 2: Update network selector dropdown**

In `runner/src/App.tsx`, find the network selector section (~line 1396-1422). Replace the hardcoded `['mainnet', 'testnet']` array:

Change:
```typescript
<span>{network === 'testnet' ? 'Testnet' : 'Mainnet'}</span>
```
To:
```typescript
<span>{network === 'emulator' ? 'Emulator' : network === 'testnet' ? 'Testnet' : 'Mainnet'}</span>
```

Also add a connection status dot before the network name when on emulator:
```typescript
{network === 'emulator' && (
  <span className={`w-1.5 h-1.5 rounded-full ${emulatorStatus === 'connected' ? 'bg-emerald-400' : emulatorStatus === 'disconnected' ? 'bg-red-400' : 'bg-yellow-400'}`} />
)}
```

Change the menu items from `['mainnet', 'testnet']` to `['mainnet', 'testnet', 'emulator']`:

```typescript
{(['mainnet', 'testnet', 'emulator'] as const).map((n) => (
  <button
    key={n}
    onClick={() => { setNetwork(n); setShowNetworkMenu(false); }}
    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
      network === n
        ? 'text-emerald-400 bg-emerald-600/10'
        : 'text-zinc-300 hover:bg-zinc-700'
    }`}
  >
    {n === 'emulator' && <Terminal className="w-3 h-3" />}
    {n === 'emulator' ? 'Emulator' : n === 'testnet' ? 'Testnet' : 'Mainnet'}
  </button>
))}
```

**Step 3: Add emulator disconnected banner**

Add this just inside the main editor area (above the CadenceEditor), after the TabBar:

```typescript
{network === 'emulator' && emulatorStatus === 'disconnected' && (
  <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/30 border-b border-amber-700/50 text-amber-300 text-xs">
    <Terminal className="w-3.5 h-3.5 shrink-0" />
    <span>Emulator not running.</span>
    <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-amber-200 font-mono">flow emulator</code>
    <button onClick={recheckEmulator} className="ml-auto text-amber-400 hover:text-amber-200 underline">
      Retry
    </button>
  </div>
)}
```

**Step 4: Update handleRun for emulator signer**

In `handleRun` (~line 757-828), add emulator handling. After the script execution block (`if (codeType === 'script')`) and before the existing transaction/contract blocks, add an emulator-specific path:

```typescript
if (codeType === 'script') {
  const result = await executeScript(activeCode, paramValues);
  setResults([result]);
} else if (network === 'emulator') {
  // Emulator: always use service account signer
  const onResult = (result: any) => setResults((prev: any) => [...prev, result]);
  if (codeType === 'contract') {
    await deployContract(
      activeCode, EMULATOR_SERVICE_ADDRESS, 0,
      async (msg) => {
        const { signMessage } = await import('./auth/localKeyManager');
        return signMessage(
          'bf9db4706c2fdb9011ee7e170ccac492f05427b96ab41d8bf2d8c58443704b76',
          msg, 'ECDSA_P256', 'SHA3_256',
        );
      },
      onResult, 'ECDSA_P256', 'SHA3_256',
    );
  } else {
    await executeCustodialTransaction(
      activeCode, paramValues, EMULATOR_SERVICE_ADDRESS, 0,
      async (msg) => {
        const { signMessage } = await import('./auth/localKeyManager');
        return signMessage(
          'bf9db4706c2fdb9011ee7e170ccac492f05427b96ab41d8bf2d8c58443704b76',
          msg, 'ECDSA_P256', 'SHA3_256',
        );
      },
      onResult, 'ECDSA_P256', 'SHA3_256',
    );
  }
} else if (codeType === 'contract') {
  // ... existing contract deploy code ...
```

Actually, it's cleaner to use `buildEmulatorAuthz` via `executeCustodialTransaction`. Keep the inline sign function approach above since `executeCustodialTransaction` already takes `signerAddress`, `keyIndex`, and `signFn` params.

Alternatively, extract a helper to avoid duplication:

```typescript
// Near top of handleRun, after existing buildLocalSignFn:
const buildEmulatorSignFn = () => async (message: string) => {
  const { signMessage } = await import('./auth/localKeyManager');
  const { EMULATOR_SERVICE_KEY } = await import('./flow/emulatorSigner');
  return signMessage(EMULATOR_SERVICE_KEY, message, 'ECDSA_P256', 'SHA3_256');
};
```

Then use it:
```typescript
} else if (network === 'emulator') {
  const emulatorSign = buildEmulatorSignFn();
  if (codeType === 'contract') {
    await deployContract(activeCode, EMULATOR_SERVICE_ADDRESS, 0, emulatorSign, onResult, 'ECDSA_P256', 'SHA3_256');
  } else {
    await executeCustodialTransaction(activeCode, paramValues, EMULATOR_SERVICE_ADDRESS, 0, emulatorSign, onResult, 'ECDSA_P256', 'SHA3_256');
  }
}
```

**Step 5: Update SignerSelector for emulator mode**

In `runner/src/components/SignerSelector.tsx`:

1. Update the `network` prop type:
```typescript
network: FlowNetwork;
```
And add the import:
```typescript
import type { FlowNetwork } from '../flow/networks';
```

2. When `network === 'emulator'`, show "Service Account" locked state instead of the full dropdown. Add this early return at the top of the component render:

```typescript
if (network === 'emulator') {
  return (
    <div className="flex items-center gap-1.5 bg-zinc-800 text-xs px-2 py-1 rounded border border-zinc-700 text-emerald-400">
      <Terminal className="w-3.5 h-3.5" />
      <span>Service Account</span>
    </div>
  );
}
```

Add `Terminal` to the lucide-react import.

**Step 6: Skip wallet connect for emulator**

In `handleRun`, the first check opens connect modal for non-script code when signer is 'none'. The emulator path is now before this check (since we check `network === 'emulator'` early), so no change needed — scripts run directly, and emulator transactions use the service account path.

However, make sure the emulator branch is checked BEFORE the signer check:

```typescript
const handleRun = useCallback(async () => {
  if (loading) return;

  // Scripts always run directly (no signer needed)
  if (codeType === 'script') {
    // ... existing script code ...
    setLoading(false);
    return;
  }

  // Emulator: always use service account (no signer needed)
  if (network === 'emulator') {
    // ... emulator code from Step 4 ...
    setLoading(false);
    return;
  }

  // Existing: If no signer and this requires signing, open connect modal
  if (selectedSigner.type === 'none' && codeType !== 'script') {
    // ... existing code ...
  }
  // ... rest of existing code ...
```

**Step 7: Verify build**

Run: `cd runner && bun run build 2>&1 | head -20`
Expected: No errors.

**Step 8: Commit**

```bash
git add runner/src/App.tsx runner/src/components/SignerSelector.tsx
git commit -m "feat(runner): integrate emulator in UI — network selector, signer lock, banner"
```

---

### Task 5: Standard Contract Auto-Deploy

**Files:**
- Create: `runner/src/flow/emulatorBootstrap.ts`

This task auto-deploys NonFungibleToken, MetadataViews, ViewResolver, and Burner to the emulator service account when they're missing. FungibleToken, FlowToken, and FlowFees are pre-deployed by the emulator bootstrap.

**Step 1: Implement emulatorBootstrap.ts**

Create `runner/src/flow/emulatorBootstrap.ts`:

```typescript
import { fcl } from './fclConfig';
import { EMULATOR_SERVICE_ADDRESS, EMULATOR_SERVICE_KEY } from './emulatorSigner';
import { signMessage } from '../auth/localKeyManager';
import type { ExecutionResult } from './execute';

/**
 * Contracts to auto-deploy on the emulator service account.
 * FungibleToken, FlowToken, FlowFees are already deployed by the emulator bootstrap.
 * We only deploy contracts that are commonly imported but not pre-deployed.
 */
const CONTRACTS_TO_DEPLOY: { name: string; source: string }[] = [
  {
    name: 'ViewResolver',
    source: `
/// ViewResolver
///
access(all) contract interface ViewResolver {
    access(all) resource interface Resolver {
        access(all) view fun getViews(): [Type]
        access(all) fun resolveView(_ view: Type): AnyStruct?
    }
    access(all) resource interface ResolverCollection {
        access(all) view fun getIDs(): [UInt64]
        access(all) view fun borrowViewResolver(id: UInt64): &{Resolver}?
    }
}`,
  },
  {
    name: 'Burner',
    source: `
/// Burner
///
access(all) contract Burner {
    access(all) event Burned(type: Type, id: UInt64?)
    access(all) fun burn(_ r: @AnyResource) {
        if let b <- r as? @{Burnable} {
            b.burnCallback()
            emit Burned(type: b.getType(), id: nil)
            destroy b
        } else {
            destroy r
        }
    }
    access(all) resource interface Burnable {
        access(contract) fun burnCallback()
    }
}`,
  },
  {
    name: 'NonFungibleToken',
    source: `
/// NonFungibleToken — minimal v2 interface for emulator
///
import ViewResolver from 0xf8d6e0586b0a20c7
import Burner from 0xf8d6e0586b0a20c7

access(all) contract interface NonFungibleToken {
    access(all) var totalSupply: UInt64
    access(all) event Withdrawn(type: String, id: UInt64, uuid: UInt64, from: Address?, providerUUID: UInt64)
    access(all) event Deposited(type: String, id: UInt64, uuid: UInt64, to: Address?, collectionUUID: UInt64)
    access(all) resource interface NFT: ViewResolver.Resolver {
        access(all) let id: UInt64
    }
    access(all) resource interface Collection: ViewResolver.ResolverCollection {
        access(all) fun deposit(token: @{NFT})
        access(all) view fun getIDs(): [UInt64]
        access(all) view fun borrowNFT(_ id: UInt64): &{NFT}?
        access(all) view fun getLength(): Int
    }
}`,
  },
  {
    name: 'MetadataViews',
    source: `
/// MetadataViews — minimal for emulator
///
import NonFungibleToken from 0xf8d6e0586b0a20c7
import ViewResolver from 0xf8d6e0586b0a20c7

access(all) contract MetadataViews {
    access(all) struct Display {
        access(all) let name: String
        access(all) let description: String
        access(all) let thumbnail: AnyStruct
        init(name: String, description: String, thumbnail: AnyStruct) {
            self.name = name
            self.description = description
            self.thumbnail = thumbnail
        }
    }
    access(all) struct HTTPFile {
        access(all) let url: String
        init(url: String) { self.url = url }
    }
    access(all) struct NFTCollectionDisplay {
        access(all) let name: String
        access(all) let description: String
        init(name: String, description: String) {
            self.name = name
            self.description = description
        }
    }
}`,
  },
];

const signFn = async (message: string) => {
  return signMessage(EMULATOR_SERVICE_KEY, message, 'ECDSA_P256', 'SHA3_256');
};

/**
 * Check which standard contracts are missing from the emulator and deploy them.
 * Returns results for each deployed contract.
 */
export async function bootstrapEmulatorContracts(
  onResult?: (result: ExecutionResult) => void,
): Promise<void> {
  const log = (msg: string) => onResult?.({ type: 'log', data: msg });

  // Fetch service account to see which contracts exist
  let existingContracts: Record<string, string> = {};
  try {
    const account = await fcl.account(`0x${EMULATOR_SERVICE_ADDRESS}`);
    existingContracts = account.contracts || {};
  } catch (err) {
    log('Failed to fetch emulator service account — is the emulator running?');
    return;
  }

  const missing = CONTRACTS_TO_DEPLOY.filter((c) => !(c.name in existingContracts));
  if (missing.length === 0) {
    return; // All contracts already deployed
  }

  log(`Deploying ${missing.length} standard contract(s) to emulator...`);

  for (const contract of missing) {
    try {
      const codeHex = Array.from(new TextEncoder().encode(contract.source))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const deployTx = `
transaction(name: String, code: String) {
  prepare(signer: auth(AddContract) &Account) {
    signer.contracts.add(name: name, code: code.decodeHex())
  }
}`;

      const authz = (account: any) => ({
        ...account,
        tempId: `${EMULATOR_SERVICE_ADDRESS}-0`,
        addr: fcl.sansPrefix(EMULATOR_SERVICE_ADDRESS),
        keyId: 0,
        signingFunction: async (signable: { message: string }) => {
          const sig = await signFn(signable.message);
          return {
            addr: fcl.withPrefix(EMULATOR_SERVICE_ADDRESS),
            keyId: 0,
            signature: sig,
          };
        },
        signatureAlgorithm: 2,
        hashAlgorithm: 3,
      });

      const txId = await fcl.mutate({
        cadence: deployTx,
        args: (arg: any, t: any) => [
          arg(contract.name, t.String),
          arg(codeHex, t.String),
        ],
        proposer: authz,
        payer: authz,
        authorizations: [authz],
        limit: 9999,
      });

      await fcl.tx(txId).onceSealed();
      log(`✓ Deployed ${contract.name}`);
    } catch (err: any) {
      log(`✗ Failed to deploy ${contract.name}: ${err.message}`);
    }
  }
}
```

**Step 2: Integrate bootstrap into App.tsx**

In `runner/src/App.tsx`, add an effect that triggers bootstrap when emulator connects:

```typescript
import { bootstrapEmulatorContracts } from './flow/emulatorBootstrap';
```

Add this effect near other network-related effects:

```typescript
// Auto-deploy standard contracts when emulator connects
const emulatorBootstrapped = useRef(false);
useEffect(() => {
  if (network !== 'emulator' || emulatorStatus !== 'connected') {
    emulatorBootstrapped.current = false;
    return;
  }
  if (emulatorBootstrapped.current) return;
  emulatorBootstrapped.current = true;

  bootstrapEmulatorContracts((result) => {
    setResults((prev) => [...prev, result]);
  });
}, [network, emulatorStatus]);
```

**Step 3: Verify build**

Run: `cd runner && bun run build 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit**

```bash
git add runner/src/flow/emulatorBootstrap.ts runner/src/App.tsx
git commit -m "feat(runner): auto-deploy standard contracts on emulator connect"
```

---

### Task 6: Update Network-Dependent Components

**Files:**
- Modify: `runner/src/components/SettingsPanel.tsx` (if it has network references)
- Modify: `runner/src/components/ResultPanel.tsx` (transaction links)

**Step 1: Check and update ResultPanel transaction links**

In `runner/src/components/ResultPanel.tsx`, transaction result links likely point to flowscan explorer. For emulator, these links should be hidden or point to localhost. Find any `flowscan` or `flowdiver` or explorer URL references and wrap them with a network check:

```typescript
// Only show explorer link for mainnet/testnet
{network !== 'emulator' && txId && (
  <a href={`https://.../${txId}`} ...>View on Explorer</a>
)}
```

**Step 2: Update any `'mainnet' | 'testnet'` type annotations**

Search the codebase for hardcoded `'mainnet' | 'testnet'` union types that should now be `FlowNetwork`. Key files to check:
- `runner/src/components/SignerSelector.tsx` — already updated in Task 4
- `runner/src/auth/useLocalKeys.ts` — `refreshAccounts` might take network param
- `runner/src/auth/localKeyManager.ts` — `createFlowAccount` takes network param (can stay as-is, emulator won't use this)

Only update types where the function will actually receive `'emulator'` as a value.

**Step 3: Verify build**

Run: `cd runner && bun run build 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit**

```bash
git add -u runner/src/
git commit -m "feat(runner): update network-dependent components for emulator support"
```

---

### Task 7: Manual Testing Checklist

**No code changes — manual verification.**

1. Start the emulator: `flow emulator`
2. Start the runner: `cd runner && bun run dev`
3. Verify:
   - [ ] Network selector shows "Emulator" option
   - [ ] Selecting Emulator shows green dot when emulator is running
   - [ ] Signer selector shows locked "Service Account"
   - [ ] Running a simple script works: `access(all) fun main(): String { return "hello" }`
   - [ ] Running a transaction works: `transaction { prepare(signer: &Account) { log("hi") } }`
   - [ ] Deploying a contract works
   - [ ] Stop emulator → banner appears "Emulator not running"
   - [ ] Click Retry → banner dismisses when emulator restarts
   - [ ] Standard contracts are auto-deployed (check logs in result panel)
   - [ ] Switching back to mainnet/testnet works normally
