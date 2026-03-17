# DeFi Positions Tab — Design Spec

## Overview

Add a "DeFi" tab to the account detail page (`/accounts/:address`) that displays the user's DeFi positions across 5 protocols on both Cadence and Flow EVM. Positions are fetched real-time from on-chain state using FCL (Cadence) and viem (EVM).

## Protocols in Scope

| Protocol | Environment | Position Types | Key Contracts |
|---|---|---|---|
| **IncrementFi** | Cadence | LP, Lending, Borrowing, stFlow (liquid staking), Farming | SwapFactory `0xb063c16cac85dbd1`, SwapRouter `0xa6850776a94e6551`, LiquidStaking `0xd6f80565193ad727` |
| **Ankr** | Flow EVM | Liquid Staking (ankrFLOW) | ankrFLOW `0x1b97100eA1D7126C4d60027e231EA4CB25314bdb`, RatioFeed `0x32015e1Bd4bAAC9b959b100B0ca253BD131dE38F` |
| **MORE Markets** | Flow EVM | Lending, Borrowing | Pool `0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d`, PoolDataProvider `0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf` |
| **KittyPunch** | Flow EVM | LP (V2 + V3 concentrated liquidity), StableSwap | V2Factory `0x29372c22459a4e373851798bFd6808e71EA34A71`, V3Factory `0xf331959366032a634c7cAcF5852fE01ffdB84Af0`, V3NftManager `0xDfA7829Eb75B66790b6E9758DF48E518c69ee34a` |
| **FlowSwap** | Flow EVM | LP (V2 + V3) | V2Factory `0x681D1bFE03522e0727730Ba02a05CD3C0a08fa30`, V3NftManager `0xf7F20a346E3097C7d38afDDA65c7C802950195C7` |

## Architecture

### Frontend-First Approach

All position data is queried directly from on-chain state by the frontend:
- **Cadence positions** (IncrementFi): via `@onflow/fcl` scripts, same pattern as existing `cadenceService.getToken()` and `cadenceService.getStakingInfo()`
- **EVM positions** (Ankr, KittyPunch, MORE Markets, FlowSwap): via `viem` library making `eth_call` to Flow EVM RPC (`https://mainnet.evm.nodes.onflow.org`)

Backend API is **not required** for v1. A backend caching layer can be added later as an optimization for popular addresses and third-party API consumers.

### SSR Considerations

The frontend uses TanStack Start with SSR. FCL and viem must only execute client-side:
- **Cadence adapters**: Use dynamic `import('../../fclConfig')` inside `useEffect`, matching existing pattern in `AccountTokensTab` and `AccountStakingTab`
- **viem client**: Must be lazily created (not at module top-level) or dynamically imported to avoid SSR execution
- **All adapter calls** happen inside `useEffect` or event handlers — never in the route `loader` or component body

### Data Flow

```
User opens DeFi tab
  → fetchAllPositions(flowAddress, coaAddress?)
    → Promise.allSettled([
        incrementfi.fetchPositions(flowAddress),     // FCL Cadence script
        ankr.fetchPositions(coaAddress),             // viem eth_call
        moreMarkets.fetchPositions(coaAddress),      // viem eth_call (multicall)
        kittypunch.fetchPositions(coaAddress),       // viem eth_call (multicall)
        flowswap.fetchPositions(coaAddress),         // viem eth_call (multicall)
      ])
    → Normalize to DeFiPosition[]
    → Render per-protocol sections
```

If the account has no COA address, EVM protocol adapters are skipped entirely (only IncrementFi is queried).

### COA Resolution

The account page already resolves the COA address via `cadenceService.getAccountInfo()` and stores it in `onChainData.coaAddress`. The DeFi tab receives this as a prop — no additional resolution needed.

## Data Model

```typescript
// Unified position type returned by all protocol adapters
interface DeFiPosition {
  protocol: 'incrementfi' | 'ankr' | 'kittypunch' | 'more-markets' | 'flowswap'
  type: 'lp' | 'lending' | 'borrowing' | 'liquid-staking' | 'farming'

  // What the user holds
  assets: Array<{
    symbol: string
    amount: string           // Raw amount as string to preserve precision (bigint from EVM, UFix64 from Cadence)
    amountDisplay: number    // Formatted number for display (may lose precision for very large values)
    valueUsd: number | null
  }>

  // Protocol-specific metadata
  meta: {
    poolName?: string           // e.g. "FLOW/USDC"
    healthFactor?: number       // lending only (MORE Markets)
    exchangeRate?: number       // liquid staking ratio (Ankr ankrFLOW, IncrementFi stFlow)
    tickRange?: [number, number] // V3 concentrated liquidity range
  }
}

// Per-protocol fetch result
interface ProtocolResult {
  protocol: string
  status: 'ok' | 'error' | 'loading'
  positions: DeFiPosition[]
  error?: string
}
```

> **Note on precision**: EVM returns `bigint`, Cadence returns `UFix64` strings. `amount` stores the raw string to avoid JavaScript `number` precision loss (>2^53). `amountDisplay` is the human-readable `number` for rendering.
>
> **Note on APY**: APY is not available from on-chain reads and is excluded from v1. It could be added in a future phase by querying protocol-specific off-chain APIs.

## Protocol Adapters

### IncrementFi (Cadence — FCL)

New Cadence script `DeFi/get_incrementfi_positions.cdc` that queries:
- **LP positions**: Borrow `LpTokenCollection` from user storage, iterate `getAllLPTokens()`, call `getLpTokenBalance(pairAddr)` for each pool
- **stFlow balance**: Check FungibleToken vault for stFlow, use `LiquidStaking.calcFlowFromStFlow()` for underlying value
- **Lending/borrowing**: Query `LendingPool` for supply/borrow balances per asset
- **Farming**: Query staking contract `0x1b77ba4b414de352` for staked LP tokens and pending rewards

The `.cdc` script is placed in `frontend/cadence/DeFi/` and picked up by codegen (`bun run codegen`), which generates a `getIncrementFiPositions()` method on `CadenceService` in `cadence.gen.ts`. The adapter in `services/defi/cadence/incrementfi.ts` calls `cadenceService.getIncrementFiPositions(address)` and normalizes the result to `DeFiPosition[]`.

> **Note**: IncrementFi lending contract addresses and storage paths need to be verified on-chain during implementation. The SwapFactory, SwapRouter, and LiquidStaking addresses are confirmed. `addresses.json` already has `0xSwapRouter` and `0xstFlowToken` — additional aliases for SwapFactory and LiquidStaking must be added.

### Ankr (EVM — viem)

Simple ERC-20 reads:
- `ankrFLOW.balanceOf(coaAddress)` — user's ankrFLOW balance
- `AnkrRatioFeed.getRatioFor(ankrFLOW)` — exchange rate to calculate underlying FLOW value

### MORE Markets (EVM — viem multicall)

Aave V3 standard interface:
- `PoolDataProvider.getUserReserveData(asset, coaAddress)` for each supported asset (WFLOW, ankrFLOW, WETH, USDF, stgUSDC, PYUSD)
- Returns: currentATokenBalance (supply), currentStableDebt + currentVariableDebt (borrow), usageAsCollateralEnabled
- `Pool.getUserAccountData(coaAddress)` for aggregate health factor, total collateral, total debt
- All batched via viem `multicall` — single RPC round-trip for 6+ assets

### KittyPunch (EVM — viem multicall)

**V2 LP positions (curated pair list):**

V2Factory does not support per-user enumeration — calling `allPairs(i)` and checking `balanceOf` on each would require hundreds of RPC calls. Instead, maintain a **hardcoded curated list** of the top V2 pairs (by TVL) in `contracts.ts`. This list can be updated periodically as new popular pairs emerge.

- `pair.balanceOf(coaAddress)` for each curated pair (batched via multicall)
- `pair.getReserves()` + `pair.totalSupply()` to calculate user's share
- Pairs with zero balance are filtered out

**V3 concentrated liquidity:**
- `NonfungiblePositionManager.balanceOf(coaAddress)` — count of position NFTs
- `NonfungiblePositionManager.tokenOfOwnerByIndex(coaAddress, i)` — get token IDs
- `NonfungiblePositionManager.positions(tokenId)` — get tick range, liquidity, tokens owed

**StableKitty pools:**
- `pool.balanceOf(coaAddress)` on known StableKitty pool contracts

### FlowSwap (EVM — viem multicall)

Same approach as KittyPunch — standard Uniswap V2/V3 interfaces:
- V2: Curated pair list, `pair.balanceOf()` + `getReserves()` + `totalSupply()` (batched via multicall)
- V3: `NonfungiblePositionManager` (`0xf7F20a346E3097C7d38afDDA65c7C802950195C7`) position enumeration

## File Structure

```
frontend/cadence/
  DeFi/
    get_incrementfi_positions.cdc  # Cadence script → codegen adds getIncrementFiPositions() to CadenceService
  addresses.json                   # Add aliases: 0xSwapFactory, 0xLiquidStaking, etc.

frontend/app/
  services/defi/                   # New directory for DeFi position fetching
    types.ts                       # DeFiPosition, ProtocolResult interfaces
    index.ts                       # fetchAllPositions() orchestrator + useDefiPositions() hook
    incrementfi.ts                 # IncrementFi adapter — wraps cadenceService.getIncrementFiPositions()
    evm/
      client.ts                    # viem publicClient for Flow EVM (lazy-init, SSR-safe)
      contracts.ts                 # All contract addresses + curated V2 pair lists
      ankr.ts                      # Ankr adapter
      kittypunch.ts                # KittyPunch V2/V3/StableKitty adapter
      more-markets.ts              # MORE Markets (Aave V3) adapter
      flowswap.ts                  # FlowSwap V2/V3 adapter
    abis/                          # Minimal read-only ABI fragments
      erc20.ts
      uniswapV2Pair.ts
      uniswapV3NftManager.ts
      aaveV3PoolDataProvider.ts
      ankrRatioFeed.ts

  components/account/
    AccountDefiTab.tsx             # Main tab component (uses useDefiPositions hook)
    defi/
      DefiSummaryBar.tsx           # Total value, position count, refresh, "fetched X ago"
      DefiProtocolSection.tsx      # Collapsible per-protocol section
      ProtocolHeader.tsx           # Logo, name, type badge, value, status
      LendingPositionRow.tsx       # Supply/borrow row with health factor
      LpPositionRow.tsx            # Pool pair, share, token amounts
      StakingPositionRow.tsx       # Staked amount, underlying, ratio
      FarmingPositionRow.tsx       # LP staked, pending rewards
      DefiEmptyState.tsx           # "No DeFi positions found"
```

> **Convention note**: The Cadence adapter follows existing patterns — the `.cdc` script is codegen'd into `CadenceService`, and `incrementfi.ts` is a thin wrapper that calls `cadenceService.getIncrementFiPositions()`. The `services/defi/` directory is new but justified: the multi-protocol orchestration with viem + FCL doesn't fit neatly into any existing location.

## UI Design

### Layout: Group by Protocol

Each protocol is a collapsible section. Sections are sorted by total value (highest first).

```
┌─────────────────────────────────────────────────────┐
│ DeFi Positions              Total Value: $12,450.32 │
├─────────────────────────────────────────────────────┤
│ ▼ MORE Markets  [Lending/Borrowing]        $8,200   │
│   ┌─────────────────────────────────────────────┐   │
│   │ Supply  FLOW      2,500 FLOW     $2,500     │   │
│   │ Supply  USDC      6,000 USDC     $6,000     │   │
│   │ Borrow  WETH      0.12 WETH      -$300      │   │
│   │ Health Factor: 2.84                         │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│ ▼ Ankr  [Liquid Staking]                   $2,245   │
│   ┌─────────────────────────────────────────────┐   │
│   │ ankrFLOW  2,000 (≈ 2,245 FLOW)  $2,245     │   │
│   │ Rate: 1 ankrFLOW = 1.1223 FLOW             │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│ ▶ KittyPunch  [DEX LP]                    $2,005    │
│                                                     │
│ ⚠ IncrementFi  [Failed to load]              —     │
│                                                     │
│ ▶ FlowSwap  [DEX LP]  (no positions)               │
└─────────────────────────────────────────────────────┘
```

### Behavior

- **On tab mount**: Fire all protocol adapters in parallel via `Promise.allSettled`
- **Per-protocol loading**: Each section shows a skeleton loader independently
- **Auto-expand**: Sections with positions expand by default; empty/error sections stay collapsed
- **Error state**: Failed protocols show warning icon + error message, collapsed by default
- **No COA**: If address has no COA, show only IncrementFi section with a note: "No EVM address linked — only Cadence protocol positions shown"
- **Empty state**: If all protocols return empty, show `DefiEmptyState` component
- **Refresh**: Manual refresh button in `DefiSummaryBar` re-fires all adapters

### Price Data

USD prices sourced from the backend `/status` endpoint (existing CoinGecko feed) for major tokens (FLOW, USDC, WETH, WBTC, etc.). DeFi-specific token prices are derived:

| Token Type | Price Derivation |
|---|---|
| **ankrFLOW** | ankrFLOW exchange rate × FLOW price |
| **stFlow** | stFlow exchange rate × FLOW price |
| **LP tokens** | `(reserve0 × price0 + reserve1 × price1) / totalSupply × userBalance` |
| **aTokens** (MORE supply) | 1:1 with underlying asset price |
| **Debt tokens** (MORE borrow) | 1:1 with underlying asset price |
| **Obscure tokens** | `null` — show amount only, no USD value |

### Staleness

Data is fetched once on tab mount. A "Fetched X ago" indicator and manual refresh button in `DefiSummaryBar` let users re-fetch. No auto-refresh in v1.

### Route Registration

The account route file (`frontend/app/routes/accounts/$address.tsx`) must be updated:
1. Add `'defi'` to `VALID_TABS` constant
2. Add DeFi tab entry to the `tabs` array (with icon, e.g. `Landmark` from Lucide)
3. Add render branch: `{activeTab === 'defi' && <AccountDefiTab ... />}`

## Dependencies

### New dependency: viem

```bash
cd frontend && bun add viem
```

viem is ~45KB gzipped with tree-shaking. Only `createPublicClient`, `http`, `multicall`, and ABI utilities are imported. The viem client and all EVM adapter code should be dynamically imported (code-split) so non-DeFi tab users don't pay the bundle cost.

### Existing dependencies (no changes)

- `@onflow/fcl` — already used for all Cadence queries
- No other new dependencies required

## Out of Scope (Future Phases)

- **Backend caching API**: `/flow/v1/account/{address}/defi` with TTL-based cache
- **Historical position tracking**: Worker that indexes position changes over time
- **Yield/PnL calculation**: Profit and loss tracking over time
- **Protocol-specific actions**: "Unstake", "Withdraw" buttons (would require wallet integration)
- **Trado.one**: Small TVL, contract addresses not publicly documented
- **Flow Credit Markets (FCM)**: Not yet launched
