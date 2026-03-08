# Sim Studio Wallet Integration Design

**Date:** 2026-03-09
**Status:** Approved

## Goal

Add wallet signing capabilities to Sim Workflow Studio so workflows can sign and send Flow transactions using cloud keys, passkeys, or imported private keys — without requiring users to paste raw private keys into block parameters.

## Architecture Overview

Three components:

1. **`@flowindex/flow-signer`** — New shared package extracted from agent-wallet's signer layer
2. **Signer integration** — Add wallet-based signing to all existing Flow transaction blocks
3. **Flow Send block** — One unified block for all asset transfers (token, NFT, Flow, EVM, bridge, child accounts)

## Part 1: `@flowindex/flow-signer` Package

Extract from `packages/agent-wallet/src/signer/` into `packages/flow-signer/`.

```
packages/flow-signer/
├── src/
│   ├── interface.ts    # FlowSigner interface, SignResult, SignerInfo
│   ├── local.ts        # LocalSigner — mnemonic/private key (server-only)
│   ├── cloud.ts        # CloudSigner — delegates to /api/v1/wallet/sign
│   ├── passkey.ts      # PasskeySigner — approval URL + polling
│   ├── fcl.ts          # createAuthzFromSigner() — FCL authorization helper
│   └── index.ts
├── package.json        # @flowindex/flow-signer
└── tsconfig.json
```

### FlowSigner Interface

```typescript
interface FlowSigner {
  init(): Promise<void>
  info(): SignerInfo
  signFlowTransaction(messageHex: string): Promise<SignResult>
  isHeadless(): boolean
}

interface SignResult {
  signature: string        // 128 hex chars (64 bytes r||s)
  extensionData?: string   // FLIP-264 for passkey
}

interface SignerInfo {
  type: 'local' | 'cloud' | 'passkey'
  flowAddress: string
  keyIndex: number
  sigAlgo: number   // 2=P256, 3=secp256k1
  hashAlgo: number  // 1=SHA2_256, 3=SHA3_256
}
```

### Signer Types

| Signer | Environment | Auth | Auto-sign |
|--------|-------------|------|-----------|
| **LocalSigner** | Server only | Private key / mnemonic | Yes |
| **CloudSigner** | Universal | fi_auth JWT or wallet API key | Yes (if auto-approve on) |
| **PasskeySigner** | Universal | fi_auth JWT | No — requires approval URL |

### Dependency Changes

- `packages/agent-wallet` → depends on `@flowindex/flow-signer` (re-exports signers)
- `sim-workflow/apps/sim` → depends on `@flowindex/flow-signer`

## Part 2: Signer Integration for Existing Blocks

### Affected Blocks (12)

All Flow blocks that currently require `signerAddress` + `signerPrivateKey`:

`send_transaction`, `transfer_flow`, `transfer_ft`, `transfer_nft`, `evm_send`, `stake`, `unstake`, `withdraw_rewards`, `create_account`, `add_key`, `remove_key`, `batch_transfer`

### Block UI Changes

Replace `signerAddress` + `signerPrivateKey` text inputs with a single **Signer dropdown**:

```
┌─────────────────────────────┐
│  Send Transaction Block     │
│                             │
│  Signer: [Agent Key #1  ▼] │
│  ─────────────────────────  │
│  ● Use Default              │
│  ● Agent Key: 0x1234 (P256) │
│  ● Passkey: My Key (0x5678) │
│  ● Manual Key               │
│                             │
│  Script: [Cadence code...]  │
│  Args:   [...]              │
└─────────────────────────────┘
```

### Workflow-Level Default Signer

- Workflow Settings gains a "Default Signer" dropdown
- Stored in workflow metadata
- Individual blocks default to "Use Default", can override

### Signer Options Loading

1. User logs into Studio via `fi_auth` cookie (cross-subdomain Supabase auth)
2. Studio calls `GET /api/v1/wallet/me` with fi_auth JWT
3. Returns `{ keys: [...cloud keys], passkey_accounts: [...] }`
4. Cached in Zustand store → populates all Signer dropdowns

### New SubBlock Type: `signer-select`

```typescript
{
  id: 'signer',
  title: 'Signer',
  type: 'dropdown',  // or new 'signer-select' type
  options: [], // dynamically populated from wallet store
  placeholder: 'Select a signer...',
  required: true,
}
```

### Signer Parameter Resolution

The `signerAddress` + `signerPrivateKey` params replaced by:

```typescript
interface SignerParam {
  signerMode: 'cloud' | 'passkey' | 'manual' | 'legacy'
  signerKeyId?: string        // cloud key ID from /wallet/me
  signerCredentialId?: string // passkey credential ID
  // Legacy fallback (backward compatible)
  signerAddress?: string
  signerPrivateKey?: string
}
```

### API Route Signing Flow

Each Flow transaction API route (`/api/tools/flow/send-transaction/route.ts` etc.) updated:

```
Request arrives →
  if signerMode === 'cloud':
    → Call FlowIndex POST /api/v1/wallet/sign with fi_auth JWT
    → CloudSigner handles signing server-side
    → Auto-approve if user has toggle on

  elif signerMode === 'passkey':
    → Call FlowIndex POST /api/v1/wallet/approve
    → Return approve_url to workflow executor
    → Workflow enters WAITING state (human-in-the-loop)
    → User opens approve_url, taps passkey
    → Poll GET /api/v1/wallet/approve/{id} (2s interval, 5min timeout)
    → Resume workflow with signature

  elif signerMode === 'manual' || signerPrivateKey:
    → Use LocalSigner (same as current behavior)
    → Private key from flow-keys import (stored encrypted in user_keys)
```

### Signing Helper

Shared helper used by all 12 API routes:

```typescript
// lib/flow/signer-resolver.ts
async function resolveSignerFromParams(
  params: SignerParam,
  fiAuthToken: string,
  flowIndexApiUrl: string
): Promise<FlowSigner>
```

## Part 3: Flow Send Block

One unified block for all asset transfers, powered by FRW-monorepo's strategy pattern.

### Reference: `@onflow/frw-workflow`

FRW-monorepo's `packages/workflow/src/send/` implements `SendTransaction()` with 21 strategies:

- **Token strategies (11):** Flow→Flow, Flow→EVM, EVM→Flow (COA/EOA bridge), EVM→EVM, Child→Child, Child→Others, Parent→Child
- **NFT strategies (10):** Same matrix plus TopShot special handling

All routing is automatic based on `SendPayload` fields (address format, `assetType`, `isCrossVM`, `childAddrs`).

### SendPayload (from FRW)

```typescript
interface SendPayload {
  type: 'token' | 'nft'
  assetType: 'flow' | 'evm'
  proposer: string       // signer address
  receiver: string       // recipient (Flow or EVM)
  sender: string         // sender (Flow or EVM)
  flowIdentifier: string // vault/collection type identifier
  childAddrs: string[]   // child accounts (auto-detected)
  ids: number[]          // NFT IDs (for NFT transfers)
  amount: string         // token amount
  decimal: number        // token decimals
  coaAddr: string        // user's COA address
  isCrossVM: boolean     // auto-detected from addresses
  tokenContractAddr: string
}
```

### Block UI

```
┌──────────────────────────────┐
│  Flow Send                   │
│                              │
│  Signer:  [Agent Key #1  ▼] │
│  Type:    [Token ▼]          │
│  From:    [0x1234...]        │
│  To:      [0xabcd...]        │
│  Token:   [A.1654...Vault]   │
│  Amount:  [10.0]             │
│  Network: [mainnet ▼]        │
│                              │
│  Advanced (auto-detected):   │
│  Cross-VM: ✓ (detected)      │
│  COA Addr: 0x...             │
└──────────────────────────────┘
```

Users fill from/to/token/amount. The system:
1. Detects address format (Flow `0x` 16 hex vs EVM `0x` 40 hex)
2. Detects if cross-VM bridge is needed
3. Queries child accounts if applicable
4. Routes to correct strategy automatically

### Block Definition

```typescript
// blocks/blocks/flow-send.ts
export const FlowSendBlock: BlockConfig = {
  type: 'flow_send',
  name: 'Flow Send',
  description: 'Send tokens or NFTs across Flow and EVM networks',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    { id: 'signer', title: 'Signer', type: 'dropdown', required: true },
    { id: 'sendType', title: 'Type', type: 'dropdown',
      options: [{ label: 'Token', value: 'token' }, { label: 'NFT', value: 'nft' }] },
    { id: 'sender', title: 'From', type: 'short-input', placeholder: '0x...' },
    { id: 'receiver', title: 'To', type: 'short-input', placeholder: '0x...' },
    { id: 'flowIdentifier', title: 'Token/Collection', type: 'short-input',
      placeholder: 'A.1654653399040a61.FlowToken.Vault' },
    { id: 'amount', title: 'Amount', type: 'short-input',
      condition: { field: 'sendType', value: 'token' } },
    { id: 'nftIds', title: 'NFT IDs', type: 'short-input',
      placeholder: 'Comma-separated IDs',
      condition: { field: 'sendType', value: 'nft' } },
    { id: 'network', title: 'Network', type: 'dropdown',
      options: [{ label: 'Mainnet', value: 'mainnet' }, { label: 'Testnet', value: 'testnet' }] },
  ],
  tools: {
    access: ['flow_send'],
    config: {
      tool: () => 'flow_send',
      params: (params) => ({
        ...params,
        // cross-VM and child detection happen server-side
      }),
    },
  },
  inputs: { input: { type: 'json', required: false } },
  outputs: {
    response: { type: 'json', description: 'Transaction result' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}
```

### Tool Definition

```typescript
// tools/flow/flow_send.ts
export const flowSendTool: ToolConfig<FlowSendParams, FlowSendResponse> = {
  id: 'flow_send',
  name: 'Flow Send',
  description: 'Send tokens or NFTs across Flow and EVM networks',
  version: '1.0.0',
  params: {
    signer: { type: 'string', required: true, description: 'Signer config JSON' },
    sendType: { type: 'string', required: true, description: 'token or nft' },
    sender: { type: 'string', required: true },
    receiver: { type: 'string', required: true },
    flowIdentifier: { type: 'string', required: true },
    amount: { type: 'string', required: false },
    nftIds: { type: 'string', required: false },
    network: { type: 'string', required: false },
  },
  request: { url: '/api/tools/flow/send', method: 'POST', ... },
  ...
}
```

### API Route

```typescript
// app/api/tools/flow/send/route.ts
// 1. Parse SendPayload from request
// 2. Resolve signer via resolveSignerFromParams()
// 3. Auto-detect cross-VM, child accounts, COA address
// 4. Call SendTransaction(payload, cadenceService) from @onflow/frw-workflow
// 5. Return transaction result
```

### Integration with `@onflow/frw-workflow`

Add `@onflow/frw-workflow` as dependency to `sim-workflow/apps/sim/`.

The `SendTransaction()` function needs a `cadenceService` — we provide one that uses our `FlowSigner` from `@flowindex/flow-signer`:

```typescript
// lib/flow/cadence-service-adapter.ts
function createCadenceServiceFromSigner(signer: FlowSigner) {
  // Wraps FlowSigner into the CadenceService interface expected by frw-workflow
  // Maps each strategy's cadenceService.sendTransaction() call to FCL + our signer
}
```

## Part 4: Wallet Store

### Zustand Store

```typescript
// stores/wallet/store.ts
interface WalletState {
  keys: CloudKey[]           // from /api/v1/wallet/me
  passkeyAccounts: PasskeyAccount[]
  isLoading: boolean
  error: string | null
  fetchWallets: (fiAuthToken: string) => Promise<void>
  getSignerOptions: () => SignerOption[]
}
```

### SignerOption Type

```typescript
interface SignerOption {
  id: string
  label: string          // "Agent Key: 0x1234 (P256)"
  type: 'cloud' | 'passkey' | 'manual'
  flowAddress: string
  keyIndex: number
  sigAlgo: string
  hashAlgo: string
}
```

## Part 5: Passkey Human-in-the-Loop

When a passkey signer is selected (manual run or automated trigger):

1. API route calls `POST /api/v1/wallet/approve` → gets `approve_url`
2. Workflow executor enters WAITING state (uses existing human-in-the-loop mechanism)
3. User receives WebSocket notification with approve_url
4. User opens URL, taps passkey → signature submitted
5. API route polls `GET /api/v1/wallet/approve/{id}` (2s interval, 5min timeout)
6. Workflow resumes with signature

Cloud keys with auto-approve toggle bypass this — signing happens instantly server-side.

## Data Flow Summary

```
User logs into Studio (fi_auth cookie)
  ↓
Studio GET /api/v1/wallet/me → load keys + passkey accounts
  ↓
User builds workflow → selects signer per block (or uses workflow default)
  ↓
Workflow executes →
  Block params include signerMode + keyId
  ↓
  API route resolves signer:
  ├─ cloud:   POST /api/v1/wallet/sign (instant if auto-approve)
  ├─ passkey: POST /api/v1/wallet/approve → poll → signature
  └─ manual:  LocalSigner with imported key from user_keys
  ↓
  FCL mutate() with resolved signer → tx sealed
  ↓
  Return txId + status to workflow
```

## Scope Summary

| Component | What | Count |
|-----------|------|-------|
| New package | `@flowindex/flow-signer` | 1 |
| Refactor agent-wallet | Depend on flow-signer | 1 |
| Modify existing blocks | Add signer dropdown | 12 |
| New block | Flow Send (unified) | 1 |
| New tool | flow_send | 1 |
| New API route | /api/tools/flow/send | 1 |
| New store | wallet store | 1 |
| New lib | signer-resolver, cadence-service-adapter | 2 |
| Dependency | @onflow/frw-workflow | 1 |
