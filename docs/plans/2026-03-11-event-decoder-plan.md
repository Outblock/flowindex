# Event Decoder Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `@flowindex/event-decoder` — a shared pure-TS package that decodes raw Flow blockchain events into structured, human-readable results for both the frontend explorer and runner simulation dialog.

**Architecture:** Extract existing event parsing from `frontend/app/lib/deriveFromEvents.ts` and `TransactionRow.tsx`, port DeFi/staking logic from Go backend workers, add new system event decoding (account, contract, capability). Package lives at `packages/event-decoder/` in the monorepo workspace, built with tsup, zero external deps.

**Tech Stack:** TypeScript, tsup, vitest

**Design doc:** `docs/plans/2026-03-11-event-decoder-design.md`

---

## Task 1: Package Scaffold

**Files:**
- Create: `packages/event-decoder/package.json`
- Create: `packages/event-decoder/tsconfig.json`
- Create: `packages/event-decoder/tsup.config.ts`
- Create: `packages/event-decoder/project.json`
- Create: `packages/event-decoder/src/index.ts` (empty barrel export)
- Create: `packages/event-decoder/src/types.ts`

**Step 1: Create package.json**

```json
{
  "name": "@flowindex/event-decoder",
  "version": "0.1.0",
  "description": "Decode raw Flow blockchain events into structured, human-readable results",
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
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "tsup": "^8.5.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
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
    "lib": ["ES2022"],
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

Note: No `"DOM"` in lib — this package is pure logic, no browser APIs.

**Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

**Step 4: Create project.json**

```json
{
  "name": "event-decoder",
  "sourceRoot": "packages/event-decoder/src",
  "tags": ["package"],
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": { "command": "tsup", "cwd": "packages/event-decoder" }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": { "command": "tsc --noEmit", "cwd": "packages/event-decoder" }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": { "command": "vitest run", "cwd": "packages/event-decoder" }
    }
  }
}
```

**Step 5: Create `src/types.ts`** with all type definitions from the design doc (RawEvent, DecodedEvents, FTTransfer, NFTTransfer, EVMExecution, DefiEvent, StakingEvent, SystemEvent, TransferType).

**Step 6: Create `src/index.ts`** — empty barrel, just re-exports types for now:

```typescript
export type * from './types.js';
```

**Step 7: Install deps and verify build**

Run: `cd packages/event-decoder && bun install && bun run build`
Expected: Build succeeds, `dist/` created with `index.js` and `index.d.ts`

**Step 8: Commit**

```
feat(event-decoder): scaffold package with types
```

---

## Task 2: Cadence Helpers + Constants

**Files:**
- Create: `packages/event-decoder/src/cadence.ts`
- Create: `packages/event-decoder/src/constants.ts`
- Create: `packages/event-decoder/src/__tests__/cadence.test.ts`

**What:** Extract the Cadence value parsing and address normalization helpers from `frontend/app/lib/deriveFromEvents.ts` lines 67-160. These are used by every other module.

**Source to port:**
- `parseCadenceValue()` (lines 67-100) — recursive Cadence JSON-CDC value unwrapper
- `parseCadenceEventFields()` (lines 102-121) — top-level event payload flattener
- `normalizeFlowAddress()` (lines 125-131) — strip 0x, lowercase, validate hex
- `extractAddress()` (lines 133-145) — extract address from nested Cadence value
- `extractAddressFromFields()` (lines 147-155) — try multiple field keys
- `formatAddr()` (lines 157-160) — prepend 0x if missing
- `parseContractAddress()` (lines 213-219) — extract address from event type `A.{addr}.{name}.{event}`
- `parseContractName()` (lines 221-227) — extract contract name from event type

Constants to extract from lines 164-170:
- `WRAPPER_CONTRACTS` — Set of `['FungibleToken', 'NonFungibleToken']`
- `FEE_VAULT_ADDRESS` — `'f919ee77447b7497'`
- `STAKING_CONTRACTS` — Set of staking contract names

**Step 1: Write tests for cadence helpers**

```typescript
// __tests__/cadence.test.ts
import { describe, it, expect } from 'vitest';
import { parseCadenceEventFields, normalizeFlowAddress, extractAddress, formatAddr, parseContractAddress, parseContractName } from '../cadence.js';

describe('parseCadenceEventFields', () => {
  it('flattens JSON-CDC event payload', () => {
    const payload = {
      value: {
        id: 'A.1654653399040a61.FlowToken.TokensWithdrawn',
        fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
          { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0x1654653399040a61' } } },
        ],
      },
    };
    const fields = parseCadenceEventFields(payload);
    expect(fields).toEqual({ amount: '0.00100000', from: '0x1654653399040a61' });
  });

  it('returns already-flat payload as-is', () => {
    expect(parseCadenceEventFields({ amount: '1.0', from: '0xabc' })).toEqual({ amount: '1.0', from: '0xabc' });
  });

  it('returns null for null input', () => {
    expect(parseCadenceEventFields(null)).toBeNull();
  });
});

describe('normalizeFlowAddress', () => {
  it('strips 0x prefix and lowercases', () => {
    expect(normalizeFlowAddress('0x1654653399040A61')).toBe('1654653399040a61');
  });
  it('returns empty for invalid', () => {
    expect(normalizeFlowAddress('')).toBe('');
    expect(normalizeFlowAddress(null)).toBe('');
  });
});

describe('parseContractAddress / parseContractName', () => {
  it('extracts from event type', () => {
    expect(parseContractAddress('A.1654653399040a61.FlowToken.TokensWithdrawn')).toBe('1654653399040a61');
    expect(parseContractName('A.1654653399040a61.FlowToken.TokensWithdrawn')).toBe('FlowToken');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/event-decoder && bun run test`
Expected: FAIL — modules not found

**Step 3: Implement `cadence.ts` and `constants.ts`**

Port the functions listed above from `frontend/app/lib/deriveFromEvents.ts`. Export all functions.

**Step 4: Run tests to verify pass**

Run: `cd packages/event-decoder && bun run test`
Expected: All PASS

**Step 5: Commit**

```
feat(event-decoder): add cadence helpers and constants
```

---

## Task 3: Token Transfer Parsing

**Files:**
- Create: `packages/event-decoder/src/tokens.ts`
- Create: `packages/event-decoder/src/__tests__/tokens.test.ts`

**What:** Port FT/NFT transfer parsing from `frontend/app/lib/deriveFromEvents.ts` lines 162-813. This is the largest module — event classification, token leg parsing, withdraw/deposit pairing, mint/burn detection, cross-VM enrichment.

**Source to port:**
- `classifyTokenEvent()` (lines 172-206)
- `isEVMBridgeEvent()` (lines 208-211)
- `inferDirection()` (lines 229-239)
- `parseTokenLeg()` (lines 257-304)
- `makeTransferKey()` (lines 308-313)
- `buildTokenTransfers()` (lines 325-408)
- The main loop from `deriveEnrichments()` lines 601-813 that collects legs, handles wrapper events, EVM bridge events, staking context, pairs legs, and produces FTTransfer/NFTTransfer arrays

Split into exported functions:
- `parseTokenEvents(events: RawEvent[]): { transfers: FTTransfer[]; nftTransfers: NFTTransfer[]; hasStakingEvents: boolean }`
- Internal helpers stay unexported

**Step 1: Write tests**

Test cases:
1. Simple FLOW transfer (TokensWithdrawn + TokensDeposited pair) → one FTTransfer with type 'transfer'
2. FT mint (deposit only, no withdrawal) → transfer_type 'mint'
3. FT burn (withdrawal only, no deposit) → transfer_type 'burn'
4. NFT transfer (NonFungibleToken.Deposited/Withdrawn pair)
5. Staking context suppresses FlowToken mint/burn classification
6. Fee vault transfers filtered out
7. EVM bridge event enrichment (EVM.FLOWTokensWithdrawn fills evm_from_address)

Use realistic JSON-CDC payloads. Model test events after the simulation screenshot (FlowToken.TokensWithdrawn, FungibleToken.Withdrawn, FlowToken.TokensDeposited, FungibleToken.Deposited).

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `tokens.ts`**

Port from `deriveFromEvents.ts`. Import helpers from `cadence.ts` and constants from `constants.ts`.

Key change: the original `deriveEnrichments()` does everything in one function. We split token logic into `parseTokenEvents()` that only handles token/NFT/bridge events, returns structured results. EVM and fee extraction will be separate modules.

**Step 4: Run tests — expect PASS**

**Step 5: Verify build**

Run: `cd packages/event-decoder && bun run build`

**Step 6: Commit**

```
feat(event-decoder): add token transfer parsing (FT/NFT)
```

---

## Task 4: EVM Decoding

**Files:**
- Create: `packages/event-decoder/src/evm.ts`
- Create: `packages/event-decoder/src/__tests__/evm.test.ts`

**What:** Port EVM event parsing from `deriveFromEvents.ts` lines 410-565.

**Source to port:**
- `decodeDirectCallPayload()` (lines 415-454) — RLP decoder for 0xff-prefixed direct call payloads
- `extractPayloadHex()` (lines 457-469)
- `extractEVMHash()` (lines 471-479)
- `normalizeHexValue()` (lines 481-495)
- `extractHexField()` (lines 497-505)
- `extractStringField()` (lines 507-514)
- `extractNumField()` (lines 516-523)
- `parseEVMExecution()` (lines 525-565) — main entry: raw event → EVMExecution

Export:
- `parseEVMEvents(events: RawEvent[]): EVMExecution[]`
- `decodeDirectCallPayload()` — useful standalone

**Step 1: Write tests**

Test cases:
1. Parse `EVM.TransactionExecuted` with hash, from, to, gas, value in payload fields
2. Decode direct call RLP payload (0xff prefix) → extract from/to/value from bytes
3. Skip events without valid hash
4. Handle byte array payload (numbers → hex)

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `evm.ts`**

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(event-decoder): add EVM event decoding
```

---

## Task 5: System Events (Account, Contract, Capability, Inbox)

**Files:**
- Create: `packages/event-decoder/src/system.ts`
- Create: `packages/event-decoder/src/__tests__/system.test.ts`

**What:** New module — decode all 16 Flow core events into SystemEvent objects with human-readable `detail` strings.

**Step 1: Write tests**

Test cases for each core event type:

```typescript
describe('parseSystemEvents', () => {
  it('decodes flow.AccountCreated', () => {
    const events = [{ type: 'flow.AccountCreated', payload: { value: { fields: [{ name: 'address', value: { type: 'Address', value: '0xabc123' } }] } } }];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('account');
    expect(result[0].action).toBe('created');
    expect(result[0].detail).toBe('Created account 0xabc123');
  });

  it('decodes flow.AccountKeyAdded', () => {
    const events = [{ type: 'flow.AccountKeyAdded', payload: { value: { fields: [
      { name: 'address', value: { type: 'Address', value: '0xabc' } },
      { name: 'keyIndex', value: { type: 'Int', value: '0' } },
      { name: 'weight', value: { type: 'UFix64', value: '1000.00000000' } },
      { name: 'hashAlgorithm', value: { type: 'Enum', value: { fields: [{ name: 'rawValue', value: { type: 'UInt8', value: '3' } }] } } },
    ] } } }];
    const result = parseSystemEvents(events);
    expect(result[0].category).toBe('key');
    expect(result[0].action).toBe('key_added');
    expect(result[0].keyIndex).toBe(0);
  });

  it('decodes flow.AccountContractAdded', () => {
    const events = [{ type: 'flow.AccountContractAdded', payload: { value: { fields: [
      { name: 'address', value: { type: 'Address', value: '0xabc' } },
      { name: 'contract', value: { type: 'String', value: 'MyToken' } },
      { name: 'codeHash', value: { type: 'Array', value: [] } },
    ] } } }];
    const result = parseSystemEvents(events);
    expect(result[0].category).toBe('contract');
    expect(result[0].action).toBe('contract_deployed');
    expect(result[0].contractName).toBe('MyToken');
    expect(result[0].detail).toContain('Deployed MyToken');
  });

  it('decodes flow.StorageCapabilityControllerIssued', () => {
    const events = [{ type: 'flow.StorageCapabilityControllerIssued', payload: { value: { fields: [
      { name: 'id', value: { type: 'UInt64', value: '1' } },
      { name: 'address', value: { type: 'Address', value: '0xabc' } },
      { name: 'type', value: { type: 'Type', value: { staticType: { typeID: 'A.xxx.FungibleToken.Vault' } } } },
      { name: 'path', value: { type: 'Path', value: { domain: 'storage', identifier: 'usdcVault' } } },
    ] } } }];
    const result = parseSystemEvents(events);
    expect(result[0].category).toBe('capability');
    expect(result[0].action).toBe('storage_capability_issued');
    expect(result[0].capabilityType).toContain('FungibleToken.Vault');
    expect(result[0].path).toContain('usdcVault');
  });

  it('decodes flow.CapabilityPublished', () => { /* address + path */ });
  it('decodes flow.CapabilityUnpublished', () => { /* address + path */ });
  it('decodes flow.AccountCapabilityControllerIssued', () => { /* id + address + type */ });
  it('decodes flow.StorageCapabilityControllerDeleted', () => { /* id + address */ });
  it('decodes flow.AccountCapabilityControllerDeleted', () => { /* id + address */ });
  it('decodes flow.StorageCapabilityControllerTargetChanged', () => { /* id + address + path */ });
  it('decodes flow.InboxValuePublished', () => { /* provider + recipient + name + type */ });
  it('decodes flow.InboxValueClaimed', () => { /* provider + recipient + name */ });
  it('decodes flow.InboxValueUnpublished', () => { /* provider + name */ });
  it('ignores non-system events', () => {
    const events = [{ type: 'A.xxx.FlowToken.TokensWithdrawn', payload: {} }];
    expect(parseSystemEvents(events)).toHaveLength(0);
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `system.ts`**

Export: `parseSystemEvents(events: RawEvent[]): SystemEvent[]`

Implementation approach:
- Check if `event.type` starts with `flow.` (system events have no address prefix)
- Switch on event type suffix
- Parse fields using `parseCadenceEventFields()` from cadence.ts
- Build human-readable `detail` string
- Handle Path values: could be `{ domain: 'storage', identifier: 'usdcVault' }` or string `/storage/usdcVault`
- Handle Type values: could be `{ staticType: { typeID: '...' } }` or string

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(event-decoder): add system event decoding (account, contract, capability, inbox)
```

---

## Task 6: DeFi Event Parsing

**Files:**
- Create: `packages/event-decoder/src/defi.ts`
- Create: `packages/event-decoder/src/__tests__/defi.test.ts`

**What:** Port DEX event parsing from `backend/internal/ingester/defi_worker.go` lines 27-174.

**Source reference (Go → TS):**
- `knownDEXPatterns` (lines 27-41) → DEX_PATTERNS constant
- `matchDEX()` (lines 43-50) → pattern matching
- Field extraction: `amount0In`, `amount1Out`, `amountIn`, `amountOut`, `token0Symbol`, `token1Symbol`, `token0Key`, `token1Key`, `price`, `reserve0`, `reserve1`
- `derivePairID()` (lines 167-174) → first 3 parts of event type

Export: `parseDefiEvents(events: RawEvent[]): DefiEvent[]`

**Step 1: Write tests**

```typescript
describe('parseDefiEvents', () => {
  it('parses IncrementFi swap', () => {
    const events = [{
      type: 'A.b063c16cac85dbd1.SwapPair.Swap',
      payload: { value: { fields: [
        { name: 'amount0In', value: { type: 'UFix64', value: '10.50000000' } },
        { name: 'amount1Out', value: { type: 'UFix64', value: '25.30000000' } },
        { name: 'token0Symbol', value: { type: 'String', value: 'FLOW' } },
        { name: 'token1Symbol', value: { type: 'String', value: 'USDC' } },
      ] } },
    }];
    const result = parseDefiEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].dex).toBe('incrementfi');
    expect(result[0].action).toBe('Swap');
    expect(result[0].amountIn).toBe('10.50000000');
    expect(result[0].amountOut).toBe('25.30000000');
    expect(result[0].tokenIn).toBe('FLOW');
    expect(result[0].tokenOut).toBe('USDC');
    expect(result[0].pairId).toBe('A.b063c16cac85dbd1.SwapPair');
  });

  it('parses BloctoSwap swap', () => { /* .BloctoSwapPair.Swap */ });
  it('parses AddLiquidity', () => { /* .SwapPair.AddLiquidity */ });
  it('parses RemoveLiquidity', () => { /* .SwapPair.RemoveLiquidity */ });
  it('ignores non-DEX events', () => {
    expect(parseDefiEvents([{ type: 'A.xxx.FlowToken.TokensWithdrawn', payload: {} }])).toHaveLength(0);
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `defi.ts`**

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(event-decoder): add DeFi event parsing (swap, liquidity)
```

---

## Task 7: Staking Event Parsing

**Files:**
- Create: `packages/event-decoder/src/staking.ts`
- Create: `packages/event-decoder/src/__tests__/staking.test.ts`

**What:** Port staking event parsing from `backend/internal/ingester/staking_worker.go` lines 45-170.

**Source reference (Go → TS):**
- `isStakingEvent()` — match `.FlowIDTableStaking.` or `.FlowEpoch.`
- Field extraction: `nodeID`, `amount`, `delegatorID`, `role`
- Event name extraction from last segment
- Also handle `FlowStakingCollection.*`, `LiquidStaking.*`, `stFlowToken.*`

Export: `parseStakingEvents(events: RawEvent[]): StakingEvent[]`

**Step 1: Write tests**

```typescript
describe('parseStakingEvents', () => {
  it('parses TokensStaked', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.TokensStaked',
      payload: { value: { fields: [
        { name: 'nodeID', value: { type: 'String', value: 'abc123' } },
        { name: 'amount', value: { type: 'UFix64', value: '100.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('TokensStaked');
    expect(result[0].nodeId).toBe('abc123');
    expect(result[0].amount).toBe('100.00000000');
  });

  it('parses DelegatorRewardsPaid with delegatorID', () => { /* delegatorID field */ });
  it('parses NewNodeCreated with role', () => { /* role field */ });
  it('parses FlowStakingCollection events', () => { /* same pattern */ });
  it('parses LiquidStaking events', () => { /* LiquidStaking.* */ });
  it('ignores non-staking events', () => { /* returns [] */ });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `staking.ts`**

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(event-decoder): add staking event parsing
```

---

## Task 8: Tag Derivation

**Files:**
- Create: `packages/event-decoder/src/tags.ts`
- Create: `packages/event-decoder/src/__tests__/tags.test.ts`

**What:** Port tag derivation from `backend/internal/ingester/tx_contracts_worker.go` lines 221-263. Pure event-type-based classification, no payload parsing needed.

**Source reference (Go → TS):**
Tags derived from event type substrings:
- `EVM.TransactionExecuted` → `'EVM'`
- `EVM.FLOWTokens*` / `FlowEVMBridge` → `'EVM_BRIDGE'`
- `NFTStorefront` → `'MARKETPLACE'`
- `AccountContractAdded` / `AccountContractUpdated` → `'CONTRACT_DEPLOY'`
- `flow.AccountCreated` → `'ACCOUNT_CREATED'`
- `AccountKeyAdded` / `AccountKeyRemoved` → `'KEY_UPDATE'`
- `FlowTransactionScheduler` → `'SCHEDULED_TX'`
- `.SwapPair.Swap` etc. → `'SWAP'`
- `.SwapPair.AddLiquidity` / `.RemoveLiquidity` → `'LIQUIDITY'`
- `FlowIDTableStaking.Tokens*` etc. → `'STAKING'`
- `LiquidStaking` / `stFlowToken` → `'LIQUID_STAKING'`
- `.TokensMinted` (not FlowToken) → `'TOKEN_MINT'`
- `.TokensBurned` (not FlowToken) → `'TOKEN_BURN'`

Export: `deriveTags(events: RawEvent[]): string[]`

**Step 1: Write tests**

```typescript
describe('deriveTags', () => {
  it('tags EVM transaction', () => {
    expect(deriveTags([{ type: 'A.xxx.EVM.TransactionExecuted', payload: {} }])).toContain('EVM');
  });
  it('tags swap', () => {
    expect(deriveTags([{ type: 'A.xxx.SwapPair.Swap', payload: {} }])).toContain('SWAP');
  });
  it('tags account creation', () => {
    expect(deriveTags([{ type: 'flow.AccountCreated', payload: {} }])).toContain('ACCOUNT_CREATED');
  });
  it('tags staking', () => {
    expect(deriveTags([{ type: 'A.xxx.FlowIDTableStaking.TokensStaked', payload: {} }])).toContain('STAKING');
  });
  it('returns unique tags', () => {
    const tags = deriveTags([
      { type: 'A.xxx.SwapPair.Swap', payload: {} },
      { type: 'A.yyy.SwapPair.Swap', payload: {} },
    ]);
    expect(tags.filter(t => t === 'SWAP')).toHaveLength(1);
  });
  it('returns empty for unknown events', () => {
    expect(deriveTags([{ type: 'A.xxx.SomeRandom.Event', payload: {} }])).toEqual([]);
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `tags.ts`**

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(event-decoder): add tag derivation from event types
```

---

## Task 9: Summary Builder

**Files:**
- Create: `packages/event-decoder/src/summary.ts`
- Create: `packages/event-decoder/src/__tests__/summary.test.ts`

**What:** Port and enhance `buildSummaryLine()` from `frontend/app/components/TransactionRow.tsx` lines 255-318. This version works from `DecodedEvents` (not backend tx object).

**Source reference:**
- Priority order: system events (account created, key update, contract deploy) → defi (swap) → staking → FT transfers → NFT transfers → contract imports → empty string
- Pattern detection: vault/collection setup from capability events
- Format amounts with `toLocaleString(undefined, { maximumFractionDigits: 4 })`
- Token name extraction: last segment of `A.addr.ContractName` → `ContractName`

Export: `buildSummary(decoded: DecodedEvents): string`

Also export: `buildSummaryItems(decoded: DecodedEvents): DecodedSummaryItem[]` — returns all summary lines (not just the first), useful for multi-action transactions.

```typescript
interface DecodedSummaryItem {
  icon: 'transfer' | 'swap' | 'stake' | 'account' | 'contract' | 'capability' | 'nft' | 'evm';
  text: string;
}
```

**Step 1: Write tests**

```typescript
describe('buildSummary', () => {
  it('summarizes FT transfer', () => {
    const decoded: DecodedEvents = {
      transfers: [{ token: 'A.1654653399040a61.FlowToken', from_address: '0xabc', to_address: '0xdef', amount: '0.001', event_index: 0, transfer_type: 'transfer' }],
      nftTransfers: [], evmExecutions: [], defiEvents: [], stakingEvents: [], systemEvents: [], fee: 0, tags: [], contractImports: [],
    };
    expect(buildSummary(decoded)).toBe('Transferred 0.001 FlowToken');
  });

  it('summarizes swap over transfer', () => {
    const decoded = {
      transfers: [{ token: 'A.xxx.FlowToken', amount: '10.5', transfer_type: 'transfer', from_address: '', to_address: '', event_index: 0 }],
      defiEvents: [{ dex: 'incrementfi', action: 'Swap', pairId: '', amountIn: '10.5', amountOut: '25.3', tokenIn: 'FLOW', tokenOut: 'USDC', event_index: 0 }],
      nftTransfers: [], evmExecutions: [], stakingEvents: [], systemEvents: [], fee: 0, tags: [], contractImports: [],
    };
    expect(buildSummary(decoded)).toContain('Swapped');
    expect(buildSummary(decoded)).toContain('FLOW');
    expect(buildSummary(decoded)).toContain('USDC');
  });

  it('summarizes account creation', () => {
    const decoded = {
      systemEvents: [{ category: 'account', action: 'created', address: '0xabc', detail: 'Created account 0xabc', event_index: 0 }],
      transfers: [], nftTransfers: [], evmExecutions: [], defiEvents: [], stakingEvents: [], fee: 0, tags: [], contractImports: [],
    };
    expect(buildSummary(decoded)).toBe('Created account 0xabc');
  });

  it('summarizes vault setup from capability pattern', () => {
    const decoded = {
      systemEvents: [
        { category: 'capability', action: 'storage_capability_issued', address: '0xabc', detail: '', event_index: 0, capabilityType: 'A.xxx.FungibleToken.Vault', path: '/storage/usdcVault' },
        { category: 'capability', action: 'capability_published', address: '0xabc', detail: '', event_index: 1, path: '/public/usdcReceiver' },
      ],
      transfers: [], nftTransfers: [], evmExecutions: [], defiEvents: [], stakingEvents: [], fee: 0, tags: [], contractImports: [],
    };
    expect(buildSummary(decoded)).toContain('Enabled');
  });

  it('summarizes staking', () => {
    const decoded = {
      stakingEvents: [{ action: 'TokensStaked', nodeId: 'abc', amount: '100.0', event_index: 0 }],
      transfers: [], nftTransfers: [], evmExecutions: [], defiEvents: [], systemEvents: [], fee: 0, tags: [], contractImports: [],
    };
    expect(buildSummary(decoded)).toContain('Staked');
    expect(buildSummary(decoded)).toContain('100');
  });

  it('falls back to contract imports', () => {
    const decoded = {
      contractImports: ['A.xxx.SomeContract', 'A.yyy.OtherContract'],
      transfers: [], nftTransfers: [], evmExecutions: [], defiEvents: [], stakingEvents: [], systemEvents: [], fee: 0, tags: [],
    };
    expect(buildSummary(decoded)).toContain('SomeContract');
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `summary.ts`**

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(event-decoder): add summary builder
```

---

## Task 10: Main Orchestrator + Fee/Import Extraction

**Files:**
- Create: `packages/event-decoder/src/decode.ts`
- Create: `packages/event-decoder/src/__tests__/decode.test.ts`
- Modify: `packages/event-decoder/src/index.ts` — wire up all exports

**What:** The main `decodeEvents()` function that orchestrates all modules and extracts fee + contract imports.

**Source reference for fee/imports:**
- `extractFee()` from `deriveFromEvents.ts` lines 569-583 — find `FlowFees.FeesDeducted` event, extract amount
- `extractContractImports()` from `deriveFromEvents.ts` lines 587-597 — regex match `import X from 0xAddr`

```typescript
// decode.ts
import { parseTokenEvents } from './tokens.js';
import { parseEVMEvents } from './evm.js';
import { parseSystemEvents } from './system.js';
import { parseDefiEvents } from './defi.js';
import { parseStakingEvents } from './staking.js';
import { deriveTags } from './tags.js';
import type { RawEvent, DecodedEvents } from './types.js';

export function decodeEvents(events: RawEvent[], script?: string | null): DecodedEvents {
  const { transfers, nftTransfers } = parseTokenEvents(events);
  const evmExecutions = parseEVMEvents(events);
  const systemEvents = parseSystemEvents(events);
  const defiEvents = parseDefiEvents(events);
  const stakingEvents = parseStakingEvents(events);
  const tags = deriveTags(events);
  const fee = extractFee(events);
  const contractImports = extractContractImports(script);

  return { transfers, nftTransfers, evmExecutions, defiEvents, stakingEvents, systemEvents, fee, tags, contractImports };
}
```

**Step 1: Write integration test**

```typescript
describe('decodeEvents', () => {
  it('decodes a complete FLOW transfer simulation', () => {
    // Realistic events from the screenshot: TokensWithdrawn, FungibleToken.Withdrawn, TokensDeposited, FungibleToken.Deposited
    const events = [
      { type: 'A.1654653399040a61.FlowToken.TokensWithdrawn', payload: { value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
        { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0x1654653399040a61' } } },
      ] } } },
      { type: 'A.f233dcee88fe0abe.FungibleToken.Withdrawn', payload: { type: 'A.1654653399040a61.FlowToken.Vault', value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
        { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0x1654653399040a61' } } },
      ] } } },
      { type: 'A.1654653399040a61.FlowToken.TokensDeposited', payload: { value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
        { name: 'to', value: { type: 'Optional', value: { type: 'Address', value: '0xabcdef1234567890' } } },
      ] } } },
      { type: 'A.f233dcee88fe0abe.FungibleToken.Deposited', payload: { type: 'A.1654653399040a61.FlowToken.Vault', value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
        { name: 'to', value: { type: 'Optional', value: { type: 'Address', value: '0xabcdef1234567890' } } },
      ] } } },
    ];

    const result = decodeEvents(events);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].amount).toBe('0.00100000');
    expect(result.transfers[0].transfer_type).toBe('transfer');
    expect(result.fee).toBe(0); // no fee event in this set
    expect(result.tags).toEqual([]);
  });

  it('extracts fee from FeesDeducted event', () => {
    const events = [
      { type: 'A.f919ee77447b7497.FlowFees.FeesDeducted', payload: { value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '0.00001000' } },
      ] } } },
    ];
    expect(decodeEvents(events).fee).toBe(0.00001);
  });

  it('extracts contract imports from script', () => {
    const result = decodeEvents([], 'import FlowToken from 0x1654653399040a61\nimport FungibleToken from 0xf233dcee88fe0abe');
    expect(result.contractImports).toEqual([
      'A.1654653399040a61.FlowToken',
      'A.f233dcee88fe0abe.FungibleToken',
    ]);
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `decode.ts` + update `index.ts` to export everything**

```typescript
// index.ts
export { decodeEvents } from './decode.js';
export { buildSummary, buildSummaryItems } from './summary.js';
export { deriveTags } from './tags.js';
export { parseTokenEvents } from './tokens.js';
export { parseEVMEvents } from './evm.js';
export { parseSystemEvents } from './system.js';
export { parseDefiEvents } from './defi.js';
export { parseStakingEvents } from './staking.js';
export type * from './types.js';
```

**Step 4: Run tests — expect ALL PASS**

Run: `cd packages/event-decoder && bun run test`

**Step 5: Verify full build**

Run: `cd packages/event-decoder && bun run build && bun run lint`

**Step 6: Commit**

```
feat(event-decoder): add main decodeEvents orchestrator and barrel exports
```

---

## Task 11: Frontend Migration

**Files:**
- Modify: `frontend/package.json` — add `"@flowindex/event-decoder": "workspace:*"`
- Modify: `frontend/app/lib/deriveFromEvents.ts` — replace with re-exports
- Modify: `frontend/app/components/TransactionRow.tsx` — import summary helpers from package

**Step 1: Add dependency**

In `frontend/package.json`, add to dependencies:
```json
"@flowindex/event-decoder": "workspace:*"
```

Run: `cd frontend && bun install`

**Step 2: Replace `deriveFromEvents.ts` with re-exports**

```typescript
// frontend/app/lib/deriveFromEvents.ts
// Re-export from shared package — all consumers use these same imports
export { decodeEvents as deriveEnrichments } from '@flowindex/event-decoder';
export type {
  FTTransfer,
  NFTTransfer,
  EVMExecution,
  DecodedEvents as DerivedEnrichments,
  TransferType,
} from '@flowindex/event-decoder';
```

**Step 3: Update TransactionRow.tsx imports**

The existing `buildSummaryLine()` in TransactionRow.tsx reads `tx.tags`, `tx.template_description`, `tx.transfer_summary` which are backend-provided fields not available from pure event decoding. Keep `buildSummaryLine()` in TransactionRow.tsx as a wrapper that:
1. First tries backend-provided tags/template fields
2. Falls back to `buildSummary()` from the package for event-derived summaries

Import `buildSummary` from `@flowindex/event-decoder` and use it as the fallback in `buildSummaryLine()`.

**Step 4: Build and lint frontend**

Run: `cd frontend && bun run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```
refactor(frontend): migrate to @flowindex/event-decoder package
```

---

## Task 12: Runner Integration

**Files:**
- Modify: `runner/package.json` — add `"@flowindex/event-decoder": "workspace:*"`
- Modify: `runner/src/components/TransactionPreview.tsx` — use decoded events

**Step 1: Add dependency**

In `runner/package.json`, add to dependencies:
```json
"@flowindex/event-decoder": "workspace:*"
```

Run: `cd runner && bun install`

**Step 2: Update TransactionPreview.tsx**

Replace the raw events display section (lines 154-183) with decoded event rendering:

1. Import `decodeEvents` and `buildSummary` from `@flowindex/event-decoder`
2. In the component, call `decodeEvents(simResult.events)` via `useMemo`
3. Show summary line under the status header
4. Show decoded transfers as structured rows (token icon, amount, from → to)
5. Show system events as structured rows
6. Show defi/staking events
7. Keep raw events in a collapsed "Raw Events" section at the bottom

The exact UI implementation follows the runner's existing dark theme (zinc-900 bg, emerald accents, text-xs sizing). Reference the existing balance changes rendering pattern (lines 124-152) for consistent styling.

**Step 3: Build runner**

Run: `cd runner && bun run build`
Expected: Build succeeds

**Step 4: Run runner tests**

Run: `cd runner && bun run test`
Expected: Existing tests still pass

**Step 5: Commit**

```
feat(runner): use event-decoder for human-readable simulation results
```

---

## Task 13: Final Verification

**Step 1: Build all packages**

Run from repo root:
```bash
bun install
bun run build:packages
```

**Step 2: Build frontend**

```bash
cd frontend && NODE_OPTIONS="--max-old-space-size=8192" bun run build
```

**Step 3: Build runner**

```bash
cd runner && bun run build
```

**Step 4: Run all tests**

```bash
cd packages/event-decoder && bun run test
cd runner && bun run test
```

**Step 5: Lint frontend**

```bash
cd frontend && bun run lint
```

**Step 6: Final commit (if any fixups needed)**

```
chore: final cleanup for event-decoder integration
```
