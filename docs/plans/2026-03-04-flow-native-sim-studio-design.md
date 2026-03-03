# Flow-Native Sim Studio Design

**Date:** 2026-03-04
**Status:** Approved

## Goal

Make Sim Studio a Flow-native workflow automation platform with 50 blockchain-specific blocks, personal workspaces per user, and automatic on-chain event triggers connected to the FlowIndex Go backend.

## 1. Workspace Isolation

**Current:** All FlowIndex users share one default workspace (`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`).

**New:** Each user gets a personal workspace on first login.

- Replace `ensureDefaultWorkspacePermission` in `lib/auth/flowindex.ts` with `ensurePersonalWorkspace(userId, name, email)`
- New module: `lib/auth/flowindex-workspace.ts`
- On first login:
  1. Create workspace named `"{name}'s Workspace"`
  2. Grant user `admin` permission
  3. Clone seed content (MCP servers, custom tools, skills, starter workflows) with fresh UUIDs
- Idempotent: skip if user already has a workspace
- In-memory cache (`checkedUsers: Set<string>`) to avoid DB queries on every request

## 2. Flow-Native Blocks (50 total)

### 2.1 Trigger Blocks (14)

| # | ID | Name | Events | User Configures |
|---|-----|------|--------|-----------------|
| 1 | `flow_ft_transfer` | FT Transfer | ft.transfer | Token type, min amount, address filter |
| 2 | `flow_nft_transfer` | NFT Transfer | nft.transfer | Collection filter, address filter |
| 3 | `flow_tx_sealed` | Transaction Sealed | transaction.sealed | Address filter (proposer/payer/auth) |
| 4 | `flow_contract_event` | Contract Event | contract.event | Event type string |
| 5 | `flow_account_event` | Account Event | account.* | Key added/removed, contract deployed |
| 6 | `flow_balance_change` | Balance Change | balance.check | Token, threshold, direction |
| 7 | `flow_staking_event` | Staking Event | staking.event | Delegator address, event type |
| 8 | `flow_evm_tx` | EVM Transaction | evm.transaction | From/to address filter |
| 9 | `flow_defi_event` | DeFi Event | defi.swap, defi.liquidity | Pool, direction |
| 10 | `flow_schedule` | Schedule | (cron) | Cron expression |
| 11 | `flow_large_transfer` | Large Transfer | ft.large_transfer | Token, threshold |
| 12 | `flow_whale_activity` | Whale Activity | address.activity | Whale address list |
| 13 | `flow_contract_deploy` | Contract Deploy | account.contract.added | Address filter |
| 14 | `flow_new_account` | New Account | account.created | (none) |

### 2.2 Query/Data Blocks (13)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 15 | `flow_get_account` | Get Account | Account info (keys, contracts, balance) |
| 16 | `flow_get_balance` | Get Balance | Token balances (FLOW, FT) |
| 17 | `flow_get_block` | Get Block | Block by height or ID |
| 18 | `flow_get_transaction` | Get Transaction | Transaction details + events |
| 19 | `flow_get_events` | Get Events | Events by type + block range |
| 20 | `flow_get_nft` | Get NFT | NFT metadata/ownership |
| 21 | `flow_resolve_name` | Resolve Name | .find / .fn name resolution |
| 22 | `flow_get_ft_holdings` | FT Holdings | All FT balances for an account |
| 23 | `flow_get_nft_inventory` | NFT Inventory | All NFTs owned by account |
| 24 | `flow_get_contract_code` | Contract Code | Deployed contract source |
| 25 | `flow_get_staking_info` | Staking Info | Staking/delegation details |
| 26 | `flow_get_defi_positions` | DeFi Positions | DeFi positions (IncrementFi, etc.) |
| 27 | `flow_get_collection_metadata` | Collection Metadata | NFT collection info |

### 2.3 Cadence Execution Blocks (2)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 28 | `flow_execute_script` | Execute Script | Run Cadence script (read-only) |
| 29 | `flow_send_transaction` | Send Transaction | Send Cadence transaction (needs signer) |

### 2.4 Token Operation Blocks (3)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 30 | `flow_transfer_flow` | Transfer FLOW | Send FLOW tokens |
| 31 | `flow_transfer_ft` | Transfer FT | Send any fungible token |
| 32 | `flow_transfer_nft` | Transfer NFT | Send NFT |

### 2.5 Staking Blocks (3)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 33 | `flow_stake` | Stake | Stake FLOW to a node |
| 34 | `flow_unstake` | Unstake | Unstake FLOW |
| 35 | `flow_withdraw_rewards` | Withdraw Rewards | Withdraw staking rewards |

### 2.6 EVM Blocks (2)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 36 | `flow_evm_call` | EVM Call | Call EVM contract (read-only) |
| 37 | `flow_evm_send` | EVM Send | Send EVM transaction |

### 2.7 Account Management Blocks (3)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 38 | `flow_create_account` | Create Account | Create new Flow account |
| 39 | `flow_add_key` | Add Key | Add key to account |
| 40 | `flow_remove_key` | Remove Key | Remove key from account |

### 2.8 Utility/Transform Blocks (5)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 41 | `flow_format_address` | Format Address | Validate/format Flow address |
| 42 | `flow_decode_event` | Decode Event | Parse Cadence event payload to JSON |
| 43 | `flow_encode_arguments` | Encode Arguments | Convert JSON to Cadence arguments |
| 44 | `flow_nft_catalog_lookup` | NFT Catalog Lookup | Look up NFT in Flow NFT Catalog |
| 45 | `flow_token_list_lookup` | Token List Lookup | Look up token in Flow Token List |

### 2.9 Ecosystem Integration Blocks (3)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 46 | `flow_increment_fi` | IncrementFi | Swap quotes, pool info |
| 47 | `flow_flowindex_api` | FlowIndex API | Query blocks, txs, stats |
| 48 | `flow_find_profile` | .find Profile | Resolve .find name/profile |

### 2.10 Advanced Transaction Blocks (2)

| # | ID | Name | Description |
|---|-----|------|-------------|
| 49 | `flow_batch_transfer` | Batch Transfer | Transfer tokens to multiple addresses |
| 50 | `flow_multi_sign` | Multi-Sign | Multi-signature transaction (hybrid custody) |

### Block Implementation Pattern

Each block follows the standard Sim Studio pattern:

```
tools/flow/{action}.ts          — ToolConfig (API definition)
tools/flow/types.ts             — Shared TypeScript types
blocks/blocks/flow_{name}.ts    — BlockConfig (UI definition)
triggers/flow/{event}.ts        — TriggerConfig (trigger blocks only)
app/api/tools/flow/{action}/    — API route handlers
components/icons.tsx            — FlowIcon (reuse existing)
```

**API route handlers** call either:
- FlowIndex Go backend REST API (for indexed data queries)
- Flow Access Node gRPC (for live queries and transactions)
- Cadence MCP server (for script execution)

**Signing transactions** (blocks 29-40, 49-50):
- Phase 1: User provides private key as encrypted credential
- Phase 2: Hybrid custody key integration (future)

## 3. Webhook Bridge (Go Backend <-> Sim Studio)

### Flow

```
User deploys workflow with flow_ft_transfer trigger
    ↓
Sim Studio registers subscription with Go backend:
  POST /webhooks/subscriptions/external
  { event_type: "ft.transfer",
    conditions: { min_amount: 100000 },
    callback_url: "https://studio.flowindex.io/api/webhooks/trigger/{path}",
    workflow_id: "...",
    sim_webhook_path: "..." }
    ↓
Go backend Orchestrator matches live events → POSTs to callback_url
    ↓
Sim Studio receives webhook → triggers workflow execution
```

### Go Backend Changes

New API endpoint: `POST /webhooks/subscriptions/external`
- Authenticated via `INTERNAL_API_SECRET` header
- Creates subscription linked to Sim Studio webhook path
- On event match, Orchestrator sends POST with event payload to callback_url
- On workflow undeploy, Sim Studio calls `DELETE /webhooks/subscriptions/external/{id}`

### Sim Studio Changes

- `lib/flow/subscription-bridge.ts`: Manages subscription lifecycle
- On workflow deploy: iterate trigger blocks → register subscriptions
- On workflow undeploy: delete all subscriptions for that workflow
- Webhook payload format matches trigger block's expected input schema

## 4. Template Workflows (8 pre-built)

| # | Template | Trigger | Logic | Output |
|---|----------|---------|-------|--------|
| 1 | Large FLOW Transfer Alert | `flow_large_transfer` (>100K FLOW) | — | Slack/Discord notification |
| 2 | Large USDC Transfer Alert | `flow_ft_transfer` (USDC, >50K) | — | Notification |
| 3 | Whale Address Monitor | `flow_whale_activity` | — | Log + notification |
| 4 | Contract Deploy Notification | `flow_contract_deploy` | — | Notification |
| 5 | TopShot Trade Monitor | `flow_nft_transfer` (TopShot) | — | Notification |
| 6 | Staking Changes Alert | `flow_staking_event` | — | Notification |
| 7 | Low Balance Warning | `flow_schedule` (hourly) | `flow_get_balance` → condition (<1000) | Notification |
| 8 | NFT Received Alert | `flow_nft_transfer` (to my address) | — | Notification |

Templates stored as JSON workflow definitions in `studio/seed/templates/`. Cloned into personal workspace on creation (with the seed pack).

## 5. Implementation Phases

### Phase 1: Workspace Isolation
- Replace shared workspace with personal workspaces
- Clone seed content on first login
- ~2-3 files changed in auth module

### Phase 2: Core Flow Blocks (15 blocks)
- Query blocks (11-27): Call FlowIndex Go backend API
- Cadence execution (28-29): Call Flow Access Node / Cadence MCP
- Block + tool + API route for each

### Phase 3: Webhook Bridge + Trigger Blocks
- Go backend external subscription API
- Sim Studio subscription bridge module
- 14 trigger block definitions
- Auto-register/unregister on deploy/undeploy

### Phase 4: Transaction Blocks (12 blocks)
- Token operations (30-32)
- Staking (33-35)
- EVM (36-37)
- Account management (38-40)
- All require signing key support

### Phase 5: Utility + Ecosystem Blocks (11 blocks)
- Utility/transform (41-45)
- Ecosystem integrations (46-48)
- Advanced (49-50)

### Phase 6: Templates
- 8 pre-built workflow templates
- Template gallery UI (if not already in Sim Studio)

## 6. Key Decisions

- **Authentication for Go backend API**: Shared `INTERNAL_API_SECRET` (already exists in deployment)
- **Signing key storage**: Encrypted credentials in Sim Studio (same pattern as OAuth tokens)
- **Template format**: JSON workflow definitions (same as Sim Studio's existing save format)
- **Block naming**: All prefixed with `flow_` for namespace clarity
- **API routes**: All under `/api/tools/flow/` for tool blocks
