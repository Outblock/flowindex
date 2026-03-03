# Flow-Native Sim Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 50 Flow blockchain blocks to Sim Studio (14 triggers + 36 action/query blocks), personal workspaces per user, and a webhook bridge connecting the Go backend's on-chain events to Sim Studio triggers.

**Architecture:** Flow blocks call the FlowIndex Go backend REST API (`http://127.0.0.1:8080`) for indexed data, and the Flow Access Node for live queries/transactions. Trigger blocks auto-register subscriptions with the Go backend on workflow deploy. Each user gets a personal workspace with cloned seed content.

**Tech Stack:** Next.js (App Router), TypeScript, Zod, Drizzle ORM, Flow SDK (fcl-js), FlowIndex REST API

---

## Phase 0: Shared Infrastructure

### Task 0.1: Flow Icon + Shared Types

**Files:**
- Modify: `sim-workflow/apps/sim/components/icons.tsx`
- Create: `sim-workflow/apps/sim/tools/flow/types.ts`
- Create: `sim-workflow/apps/sim/tools/flow/index.ts`

**Step 1: Add FlowIcon to icons.tsx**

Check if FlowIcon already exists. If not, add:

```typescript
export function FlowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.8 5.6H17.6V10.4H12.8V5.6ZM8 10.4H12.8V15.2H17.6V10.4H12.8V5.6H8V10.4ZM8 15.2V20H12.8V15.2H8ZM3.2 10.4H8V15.2H3.2V10.4Z" />
    </svg>
  )
}
```

**Step 2: Create shared Flow types**

```typescript
// tools/flow/types.ts
export interface FlowApiResponse<T = unknown> {
  data: T
  _meta?: { count?: number; limit?: number; offset?: number }
  error?: string | null
}

export interface FlowAccountInfo {
  address: string
  balance: string
  keys: Array<{ index: number; publicKey: string; signAlgo: string; hashAlgo: string; weight: number; revoked: boolean }>
  contracts: string[]
}

export interface FlowBlock {
  height: number
  id: string
  parentId: string
  timestamp: string
  transactionCount: number
}

export interface FlowTransaction {
  id: string
  blockHeight: number
  status: string
  proposer: string
  payer: string
  authorizers: string[]
  gasLimit: number
  isEvm: boolean
}

export interface FlowFtTransfer {
  transactionId: string
  blockHeight: number
  from: string
  to: string
  amount: string
  token: string
  timestamp: string
}

export interface FlowNftTransfer {
  transactionId: string
  blockHeight: number
  from: string
  to: string
  nftId: string
  nftType: string
  timestamp: string
}

export interface FlowEvent {
  type: string
  transactionId: string
  blockHeight: number
  data: Record<string, unknown>
}

// Common tool param types
export interface FlowQueryParams {
  address?: string
  limit?: number
  offset?: number
}

export interface FlowGetAccountParams {
  address: string
}

export interface FlowGetBalanceParams {
  address: string
  token?: string
}

export interface FlowGetBlockParams {
  height?: string
  id?: string
}

export interface FlowGetTransactionParams {
  id: string
}

export interface FlowGetEventsParams {
  eventType: string
  startHeight?: string
  endHeight?: string
  limit?: string
}

export interface FlowExecuteScriptParams {
  script: string
  arguments?: string
  network?: string
}

export interface FlowSendTransactionParams {
  script: string
  arguments?: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}
```

**Step 3: Create barrel export**

```typescript
// tools/flow/index.ts
export * from './types'
```

**Step 4: Commit**

```bash
git add sim-workflow/apps/sim/components/icons.tsx sim-workflow/apps/sim/tools/flow/
git commit -m "feat(flow): add FlowIcon and shared Flow types"
```

---

### Task 0.2: Flow API Client Utility

**Files:**
- Create: `sim-workflow/apps/sim/app/api/tools/flow/utils.ts`

**Step 1: Create Flow API client helper**

This utility wraps calls to the FlowIndex Go backend. Since both services run on the same VM with `--network=host`, the backend is at `http://127.0.0.1:8080`.

```typescript
// app/api/tools/flow/utils.ts
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('FlowAPI')

const FLOW_API_BASE = env.FLOWINDEX_API_URL || 'http://127.0.0.1:8080'

export async function flowApiFetch<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown; timeout?: number }
): Promise<T> {
  const url = `${FLOW_API_BASE}${path}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 15000)

  try {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`FlowIndex API ${res.status}: ${text}`)
    }

    return (await res.json()) as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`FlowIndex API timeout: ${path}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}
```

**Step 2: Add `FLOWINDEX_API_URL` to env schema**

In `sim-workflow/apps/sim/lib/core/config/env.ts`, add:
```typescript
FLOWINDEX_API_URL: z.string().url().optional(),  // FlowIndex Go backend URL (default: http://127.0.0.1:8080)
```

**Step 3: Commit**

```bash
git add sim-workflow/apps/sim/app/api/tools/flow/ sim-workflow/apps/sim/lib/core/config/env.ts
git commit -m "feat(flow): add FlowIndex API client utility"
```

---

## Phase 1: Query/Data Blocks (13 blocks)

These are the simplest blocks — they call the FlowIndex REST API and return data. No signing, no webhooks.

### Task 1.1: flow_get_account Block (#15)

**Files:**
- Create: `sim-workflow/apps/sim/tools/flow/get_account.ts`
- Create: `sim-workflow/apps/sim/app/api/tools/flow/get-account/route.ts`
- Create: `sim-workflow/apps/sim/blocks/blocks/flow_get_account.ts`
- Modify: `sim-workflow/apps/sim/tools/registry.ts`
- Modify: `sim-workflow/apps/sim/blocks/registry.ts`

**Step 1: Create tool config**

```typescript
// tools/flow/get_account.ts
import type { ToolConfig } from '@/tools/types'

export interface FlowGetAccountParams {
  address: string
}

export interface FlowGetAccountResponse {
  success: boolean
  output: {
    content: string
    address: string
    balance: string
    keys: Array<Record<string, unknown>>
    contracts: string[]
  }
}

export const flowGetAccountTool: ToolConfig<FlowGetAccountParams, FlowGetAccountResponse> = {
  id: 'flow_get_account',
  name: 'Flow Get Account',
  description: 'Get Flow account details including balance, keys, and contracts',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
  },

  request: {
    url: '/api/tools/flow/get-account',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return { success: false, output: { content: data.error || 'Failed to get account' }, error: data.error }
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Account summary' },
    address: { type: 'string', description: 'Flow address' },
    balance: { type: 'string', description: 'FLOW balance' },
    keys: { type: 'array', description: 'Account keys' },
    contracts: { type: 'array', description: 'Deployed contract names' },
  },
}
```

**Step 2: Create API route handler**

```typescript
// app/api/tools/flow/get-account/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch, buildQueryString } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  address: z.string().min(1, 'Address is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { address } = Schema.parse(body)
    const addr = address.replace(/^0x/, '').toLowerCase()

    const data = await flowApiFetch<{ data: Record<string, unknown> }>(`/flow/account/${addr}`)
    const account = data.data || data

    return NextResponse.json({
      success: true,
      output: {
        content: `Account ${addr}: balance ${(account as any).balance || '0'} FLOW, ${((account as any).contracts || []).length} contracts`,
        address: addr,
        balance: String((account as any).balance || '0'),
        keys: (account as any).keys || [],
        contracts: (account as any).contracts || [],
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get account',
    }, { status: 500 })
  }
}
```

**Step 3: Create block config**

```typescript
// blocks/blocks/flow_get_account.ts
import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetAccountBlock: BlockConfig = {
  type: 'flow_get_account',
  name: 'Flow Get Account',
  description: 'Get Flow account details including balance, keys, and contracts',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'address',
      title: 'Address',
      type: 'short-input',
      placeholder: '0x1654653399040a61',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_account'],
    config: {
      tool: () => 'flow_get_account',
      params: (params) => ({ address: params.address }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
  },
  outputs: {
    content: { type: 'string', description: 'Account summary' },
    address: { type: 'string', description: 'Flow address' },
    balance: { type: 'string', description: 'FLOW balance' },
    keys: { type: 'array', description: 'Account keys' },
    contracts: { type: 'array', description: 'Deployed contract names' },
  },
}
```

**Step 4: Register in tools/registry.ts and blocks/registry.ts**

Add to `tools/registry.ts`:
```typescript
import { flowGetAccountTool } from '@/tools/flow/get_account'
// In the registry object:
flow_get_account: flowGetAccountTool,
```

Add to `blocks/registry.ts`:
```typescript
import { FlowGetAccountBlock } from '@/blocks/blocks/flow_get_account'
// In the registry object (alphabetically):
flow_get_account: FlowGetAccountBlock,
```

**Step 5: Commit**

```bash
git add sim-workflow/apps/sim/tools/flow/ sim-workflow/apps/sim/app/api/tools/flow/ sim-workflow/apps/sim/blocks/blocks/flow_get_account.ts sim-workflow/apps/sim/tools/registry.ts sim-workflow/apps/sim/blocks/registry.ts
git commit -m "feat(flow): add flow_get_account block"
```

---

### Task 1.2: Remaining Query Blocks (#16-#27) — Batch Implementation

All 12 remaining query blocks follow the **exact same pattern** as Task 1.1. For each block:

1. Create `tools/flow/{name}.ts` — tool config
2. Create `app/api/tools/flow/{name}/route.ts` — API route calling `flowApiFetch`
3. Create `blocks/blocks/flow_{name}.ts` — block config
4. Register in both registries

**Block → FlowIndex API mapping:**

| Block ID | API Endpoint | Key Params |
|----------|-------------|------------|
| `flow_get_balance` | `GET /flow/account/{addr}/ft` | address, token? |
| `flow_get_block` | `GET /flow/block/{height}` | height or id |
| `flow_get_transaction` | `GET /flow/transaction/{id}` | id |
| `flow_get_events` | `GET /flow/events/search` | eventType, startHeight?, endHeight?, limit? |
| `flow_get_nft` | `GET /flow/nft/{type}/item/{id}` | nftType, nftId |
| `flow_resolve_name` | `GET /flow/account/{address}` + label lookup | name |
| `flow_get_ft_holdings` | `GET /flow/account/{addr}/ft/holding` | address |
| `flow_get_nft_inventory` | `GET /flow/account/{addr}/nft` | address |
| `flow_get_contract_code` | `GET /flow/account/{addr}/contract/{name}` | address, contractName |
| `flow_get_staking_info` | `GET /staking/delegator?address={addr}` | address |
| `flow_get_defi_positions` | `GET /defi/events?address={addr}` | address |
| `flow_get_collection_metadata` | `GET /flow/nft/{type}` | nftType |

**Implementation approach:** Create all 12 in a single batch, following the exact pattern from Task 1.1. Each tool is ~40 lines, each API route is ~30 lines, each block config is ~30 lines.

**Commit after each batch of 3-4 blocks:**
```bash
git commit -m "feat(flow): add flow_get_balance, flow_get_block, flow_get_transaction, flow_get_events blocks"
git commit -m "feat(flow): add flow_get_nft, flow_resolve_name, flow_get_ft_holdings, flow_get_nft_inventory blocks"
git commit -m "feat(flow): add flow_get_contract_code, flow_get_staking_info, flow_get_defi_positions, flow_get_collection_metadata blocks"
```

---

## Phase 2: Cadence Execution Blocks (2 blocks)

### Task 2.1: flow_execute_script Block (#28)

**Files:**
- Create: `sim-workflow/apps/sim/tools/flow/execute_script.ts`
- Create: `sim-workflow/apps/sim/app/api/tools/flow/execute-script/route.ts`
- Create: `sim-workflow/apps/sim/blocks/blocks/flow_execute_script.ts`

**Step 1: Create tool config and API route**

The API route handler sends the Cadence script to the Flow Access Node via the Go backend's `/ai/workflow-generate` or directly via `fcl-js`. For simplicity, use the Go backend's Cadence check endpoint and a new script execution endpoint.

**Alternative approach:** Call the **Cadence MCP server** (already deployed at the VM) to execute scripts. The MCP server at `flow-evm-mcp:8102` or the Cadence MCP can execute scripts on mainnet.

The API route:
```typescript
// app/api/tools/flow/execute-script/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const Schema = z.object({
  script: z.string().min(1, 'Cadence script is required'),
  arguments: z.string().optional().default('[]'),
  network: z.string().optional().default('mainnet'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { script, arguments: args, network } = Schema.parse(body)

    // Use fcl-js to execute script on Flow Access Node
    const { config, query } = await import('@onflow/fcl')
    config().put('accessNode.api', network === 'testnet'
      ? 'https://rest-testnet.onflow.org'
      : 'https://rest-mainnet.onflow.org'
    )

    let parsedArgs: unknown[] = []
    try {
      parsedArgs = JSON.parse(args)
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid arguments JSON' }, { status: 400 })
    }

    const result = await query({ cadence: script, args: () => parsedArgs })

    return NextResponse.json({
      success: true,
      output: {
        content: JSON.stringify(result, null, 2),
        result,
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Script execution failed',
    }, { status: 500 })
  }
}
```

**Note:** `@onflow/fcl` may need to be added as a dependency:
```bash
cd sim-workflow && bun add @onflow/fcl @onflow/types
```

**Step 2: Create block config with code editor**

```typescript
// blocks/blocks/flow_execute_script.ts
import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowExecuteScriptBlock: BlockConfig = {
  type: 'flow_execute_script',
  name: 'Flow Execute Script',
  description: 'Execute a Cadence script on the Flow blockchain (read-only)',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'script',
      title: 'Cadence Script',
      type: 'code',
      placeholder: 'access(all) fun main(): String {\n  return "Hello, Flow!"\n}',
      required: true,
    },
    {
      id: 'arguments',
      title: 'Arguments (JSON)',
      type: 'code',
      placeholder: '[]',
    },
    {
      id: 'network',
      title: 'Network',
      type: 'dropdown',
      options: [
        { label: 'Mainnet', id: 'mainnet' },
        { label: 'Testnet', id: 'testnet' },
      ],
      value: () => 'mainnet',
    },
  ],
  tools: {
    access: ['flow_execute_script'],
    config: {
      tool: () => 'flow_execute_script',
      params: (params) => ({
        script: params.script,
        arguments: params.arguments || '[]',
        network: params.network || 'mainnet',
      }),
    },
  },
  inputs: {
    script: { type: 'string', description: 'Cadence script code' },
    arguments: { type: 'string', description: 'JSON array of arguments' },
    network: { type: 'string', description: 'Flow network (mainnet or testnet)' },
  },
  outputs: {
    content: { type: 'string', description: 'Script result as JSON string' },
    result: { type: 'json', description: 'Script result value' },
  },
}
```

**Step 3: Register and commit**

```bash
git commit -m "feat(flow): add flow_execute_script block"
```

---

### Task 2.2: flow_send_transaction Block (#29)

Same pattern as 2.1 but uses `fcl.mutate()` with a signer. The signer private key is stored as an encrypted credential in the block config (password field).

For Phase 1, use a simple private key signer. Later, migrate to hybrid custody.

```bash
git commit -m "feat(flow): add flow_send_transaction block"
```

---

## Phase 3: Token + Staking + EVM + Account Blocks (16 blocks, #30-#40, #49-#50)

### Task 3.1: Token Operation Blocks (#30-#32)

`flow_transfer_flow`, `flow_transfer_ft`, `flow_transfer_nft` — all use `fcl.mutate()` with standard Cadence transaction templates.

Each block:
- Accepts: recipient address, amount/NFT ID, signer key
- Uses well-known Cadence transaction templates for Flow token transfers
- API route calls `fcl.mutate()` with the user's signer key

**Cadence templates** are stored as constants in `app/api/tools/flow/cadence-templates.ts`.

### Task 3.2: Staking Blocks (#33-#35)

`flow_stake`, `flow_unstake`, `flow_withdraw_rewards` — use standard FlowIDTableStaking Cadence transactions.

### Task 3.3: EVM Blocks (#36-#37)

`flow_evm_call` — call EVM contract via Flow's EVM gateway (JSON-RPC)
`flow_evm_send` — send EVM transaction via Flow's EVM gateway

### Task 3.4: Account Management Blocks (#38-#40)

`flow_create_account`, `flow_add_key`, `flow_remove_key` — standard Cadence account management transactions.

### Task 3.5: Advanced Blocks (#49-#50)

`flow_batch_transfer` — loop over recipients array
`flow_multi_sign` — multi-signature transaction (stub for hybrid custody)

**Commit after each sub-task.**

---

## Phase 4: Utility + Ecosystem Blocks (10 blocks, #41-#48)

### Task 4.1: Utility Blocks (#41-#45)

These are **pure logic blocks** — no external API calls:

- `flow_format_address` — validate/format Flow address (add/remove 0x, pad to 16 chars)
- `flow_decode_event` — parse Cadence event JSON fields
- `flow_encode_arguments` — convert JSON to FCL argument format
- `flow_nft_catalog_lookup` — call NFT Catalog API or use the Cadence MCP
- `flow_token_list_lookup` — call Flow Token List API

### Task 4.2: Ecosystem Blocks (#46-#48)

- `flow_increment_fi` — call IncrementFi API for swap quotes
- `flow_flowindex_api` — generic FlowIndex API query block (user provides endpoint path)
- `flow_find_profile` — call .find FLIP-??lookup

---

## Phase 5: Trigger Blocks + Webhook Bridge (14 triggers)

### Task 5.1: Go Backend External Subscription API

**Files:**
- Modify: `backend/internal/api/server.go` (add new routes)
- Create: `backend/internal/api/external_subscriptions.go`

**Step 1: Add subscription management endpoints**

```go
// New endpoints in server.go:
// POST   /webhooks/subscriptions/external   — create subscription
// DELETE /webhooks/subscriptions/external/{id} — delete subscription
// GET    /webhooks/subscriptions/external    — list subscriptions

// Authenticated via X-Internal-Secret header matching INTERNAL_API_SECRET env var
```

**Step 2: Subscription model**

```go
type ExternalSubscription struct {
    ID          string          `json:"id"`
    EventType   string          `json:"event_type"`
    Conditions  json.RawMessage `json:"conditions"`
    CallbackURL string          `json:"callback_url"`
    WorkflowID  string          `json:"workflow_id"`
    WebhookPath string          `json:"webhook_path"`
    IsActive    bool            `json:"is_active"`
    CreatedAt   time.Time       `json:"created_at"`
}
```

**Step 3: Orchestrator integration**

When the Orchestrator matches an event, also check external subscriptions and POST to their callback URLs.

**Step 4: Commit**

```bash
cd backend && git commit -m "feat(webhooks): add external subscription API for Sim Studio triggers"
```

---

### Task 5.2: Sim Studio Subscription Bridge

**Files:**
- Create: `sim-workflow/apps/sim/lib/flow/subscription-bridge.ts`

**Step 1: Create subscription bridge module**

```typescript
// lib/flow/subscription-bridge.ts
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('FlowSubscriptionBridge')
const FLOW_API_BASE = env.FLOWINDEX_API_URL || 'http://127.0.0.1:8080'

export async function registerFlowSubscription(params: {
  eventType: string
  conditions: Record<string, unknown>
  callbackUrl: string
  workflowId: string
  webhookPath: string
}): Promise<string> {
  const res = await fetch(`${FLOW_API_BASE}/webhooks/subscriptions/external`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': env.INTERNAL_API_SECRET || '',
    },
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    throw new Error(`Failed to register subscription: ${res.status}`)
  }

  const data = await res.json()
  return data.id
}

export async function deleteFlowSubscription(subscriptionId: string): Promise<void> {
  await fetch(`${FLOW_API_BASE}/webhooks/subscriptions/external/${subscriptionId}`, {
    method: 'DELETE',
    headers: { 'X-Internal-Secret': env.INTERNAL_API_SECRET || '' },
  })
}

export async function deleteFlowSubscriptionsForWorkflow(workflowId: string): Promise<void> {
  const res = await fetch(
    `${FLOW_API_BASE}/webhooks/subscriptions/external?workflow_id=${workflowId}`,
    { headers: { 'X-Internal-Secret': env.INTERNAL_API_SECRET || '' } }
  )
  if (!res.ok) return

  const { data } = await res.json()
  for (const sub of data || []) {
    await deleteFlowSubscription(sub.id)
  }
}
```

**Step 2: Hook into workflow deploy/undeploy**

Find where webhook registration happens during workflow deploy (likely in `app/api/workflows/[workflowId]/deploy/route.ts` or similar) and add Flow subscription registration for any Flow trigger blocks in the workflow.

---

### Task 5.3: Flow Trigger Block Definitions (14 blocks)

Each trigger block follows the `genericWebhookTrigger` pattern but with Flow-specific configuration fields.

**Example: flow_ft_transfer trigger**

```typescript
// triggers/flow/ft_transfer.ts
import { FlowIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const flowFtTransferTrigger: TriggerConfig = {
  id: 'flow_ft_transfer',
  name: 'Flow FT Transfer',
  provider: 'flow',
  description: 'Triggered when a fungible token transfer occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: [
    {
      id: 'token',
      title: 'Token',
      type: 'dropdown',
      options: [
        { label: 'Any Token', id: 'any' },
        { label: 'FLOW', id: 'flow' },
        { label: 'USDC', id: 'usdc' },
        { label: 'stFlow', id: 'stflow' },
      ],
      value: () => 'any',
      mode: 'trigger',
    },
    {
      id: 'minAmount',
      title: 'Minimum Amount',
      type: 'short-input',
      placeholder: '0',
      description: 'Only trigger for transfers >= this amount',
      mode: 'trigger',
    },
    {
      id: 'addressFilter',
      title: 'Address Filter',
      type: 'short-input',
      placeholder: '0x... (sender or receiver)',
      description: 'Only trigger for transfers involving this address',
      mode: 'trigger',
    },
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'flow_ft_transfer',
    },
  ],

  outputs: {
    transactionId: { type: 'string', description: 'Transaction ID' },
    from: { type: 'string', description: 'Sender address' },
    to: { type: 'string', description: 'Receiver address' },
    amount: { type: 'string', description: 'Transfer amount' },
    token: { type: 'string', description: 'Token type' },
    blockHeight: { type: 'number', description: 'Block height' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
```

**All 14 triggers follow this pattern** with different configuration fields:

| Trigger | Config Fields | Event Type |
|---------|--------------|------------|
| `flow_ft_transfer` | token, minAmount, addressFilter | ft.transfer |
| `flow_nft_transfer` | collection, addressFilter | nft.transfer |
| `flow_tx_sealed` | addressFilter (proposer/payer/auth) | transaction.sealed |
| `flow_contract_event` | eventType string | contract.event |
| `flow_account_event` | eventCategory dropdown | account.* |
| `flow_balance_change` | token, threshold, direction | balance.check |
| `flow_staking_event` | delegatorAddress, eventType | staking.event |
| `flow_evm_tx` | fromAddress, toAddress | evm.transaction |
| `flow_defi_event` | pool, direction | defi.swap |
| `flow_schedule` | cronExpression | (cron) |
| `flow_large_transfer` | token, threshold | ft.large_transfer |
| `flow_whale_activity` | addressList | address.activity |
| `flow_contract_deploy` | addressFilter | account.contract.added |
| `flow_new_account` | (none) | account.created |

**Commit after each batch of 3-4 triggers.**

---

## Phase 6: Workspace Isolation

### Task 6.1: Personal Workspace Creation

**Files:**
- Create: `sim-workflow/apps/sim/lib/auth/flowindex-workspace.ts`
- Modify: `sim-workflow/apps/sim/lib/auth/flowindex.ts`

**Step 1: Create workspace seeding module**

```typescript
// lib/auth/flowindex-workspace.ts
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'

const logger = createLogger('FlowIndexWorkspace')

const checkedUsers = new Set<string>()

export async function ensurePersonalWorkspace(
  userId: string,
  name: string,
  email: string
): Promise<void> {
  if (checkedUsers.has(userId)) return

  // Check if user already has any workspace
  const existingPermission = await db.query.permissions.findFirst({
    where: eq(schema.permissions.userId, userId),
    columns: { id: true },
  })

  if (existingPermission) {
    checkedUsers.add(userId)
    return
  }

  // Create personal workspace
  const workspaceId = crypto.randomUUID()
  const now = new Date()

  await db.insert(schema.workspace).values({
    id: workspaceId,
    name: `${name}'s Workspace`,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.permissions).values({
    id: crypto.randomUUID(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
    createdAt: now,
    updatedAt: now,
  })

  // TODO: Clone seed content (MCP servers, tools, skills, starter workflows)
  // into the new workspace with fresh UUIDs

  logger.info('Created personal workspace for FlowIndex user', { userId, workspaceId })
  checkedUsers.add(userId)
}
```

**Step 2: Update flowindex.ts to use ensurePersonalWorkspace**

Replace the call to `ensureDefaultWorkspacePermission(userId)` with `ensurePersonalWorkspace(userId, name, email)`.

**Step 3: Commit**

```bash
git commit -m "feat(auth): create personal workspace per FlowIndex user on first login"
```

---

## Phase 7: Template Workflows

### Task 7.1: Create 8 Template Workflow JSON Files

**Files:**
- Create: `studio/seed/templates/large-flow-transfer.json`
- Create: `studio/seed/templates/large-usdc-transfer.json`
- Create: `studio/seed/templates/whale-monitor.json`
- Create: `studio/seed/templates/contract-deploy.json`
- Create: `studio/seed/templates/topshot-trade.json`
- Create: `studio/seed/templates/staking-changes.json`
- Create: `studio/seed/templates/low-balance-warning.json`
- Create: `studio/seed/templates/nft-received.json`

Each template is a JSON file matching Sim Studio's workflow save format. These get loaded into the user's workspace as part of the seed content clone in Phase 6.

---

## Implementation Order Summary

| Phase | Blocks | Estimated Size | Dependencies |
|-------|--------|---------------|-------------|
| Phase 0 | Shared infra | ~3 files | None |
| Phase 1 | 13 query blocks | ~39 files (3 per block) | Phase 0 |
| Phase 2 | 2 Cadence blocks | ~6 files | Phase 0, fcl-js |
| Phase 3 | 16 tx blocks | ~48 files | Phase 2 |
| Phase 4 | 10 utility blocks | ~30 files | Phase 0 |
| Phase 5 | 14 trigger blocks | ~28 files + Go changes | Phase 0, Go backend |
| Phase 6 | Workspace isolation | ~2 files | None |
| Phase 7 | 8 templates | ~8 JSON files | Phases 1-5 |

**Recommended execution:** Phase 0 → Phase 6 → Phase 1 → Phase 2 → Phase 4 → Phase 5 → Phase 3 → Phase 7

Start with shared infra and workspace isolation (quick wins), then query blocks (most useful immediately), then triggers and transactions.
