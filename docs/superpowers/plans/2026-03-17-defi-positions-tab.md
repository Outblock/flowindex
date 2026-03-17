# DeFi Positions Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DeFi tab to the account detail page showing live positions across 5 protocols (IncrementFi, Ankr, MORE Markets, KittyPunch, FlowSwap) on both Cadence and Flow EVM.

**Architecture:** Frontend-first — Cadence positions queried via FCL (existing `cadenceService` pattern), EVM positions via new `viem` dependency using `eth_call`/`multicall` to Flow EVM RPC. All adapters run in parallel via `Promise.allSettled`. No backend changes needed.

**Tech Stack:** React 19, TanStack Start (SSR), viem (new), @onflow/fcl (existing), TailwindCSS, Shadcn/UI, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-17-defi-positions-tab-design.md`

---

## Chunk 1: Foundation — Types, viem Client, ABIs

### Task 1: Install viem and create shared types

**Files:**
- Create: `frontend/app/services/defi/types.ts`

- [ ] **Step 1: Install viem**

```bash
cd frontend && bun add viem
```

- [ ] **Step 2: Create types file**

Create `frontend/app/services/defi/types.ts` with the unified data model:

```typescript
export type ProtocolId = 'incrementfi' | 'ankr' | 'kittypunch' | 'more-markets' | 'flowswap'
export type PositionType = 'lp' | 'lending' | 'borrowing' | 'liquid-staking' | 'farming'

export interface DeFiAsset {
  symbol: string
  amount: string        // Raw string to preserve bigint/UFix64 precision
  amountDisplay: number // Human-readable number for rendering
  valueUsd: number | null
}

export interface DeFiPosition {
  protocol: ProtocolId
  type: PositionType
  assets: DeFiAsset[]
  meta: {
    poolName?: string
    healthFactor?: number
    exchangeRate?: number
    tickRange?: [number, number]
  }
}

export interface ProtocolResult {
  protocol: ProtocolId
  status: 'ok' | 'error'
  positions: DeFiPosition[]
  error?: string
}

// Protocol display metadata
export const PROTOCOL_META: Record<ProtocolId, { name: string; type: string; environment: 'cadence' | 'evm' }> = {
  'incrementfi':  { name: 'IncrementFi',  type: 'DEX / Lending / Staking', environment: 'cadence' },
  'ankr':         { name: 'Ankr',         type: 'Liquid Staking',          environment: 'evm' },
  'more-markets': { name: 'MORE Markets', type: 'Lending / Borrowing',     environment: 'evm' },
  'kittypunch':   { name: 'KittyPunch',   type: 'DEX',                     environment: 'evm' },
  'flowswap':     { name: 'FlowSwap',     type: 'DEX',                     environment: 'evm' },
}
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/bun.lockb frontend/app/services/defi/types.ts
git commit -m "feat(defi): add viem dependency and shared DeFi position types"
```

---

### Task 2: Create viem client and contract config

**Files:**
- Create: `frontend/app/services/defi/evm/client.ts`
- Create: `frontend/app/services/defi/evm/contracts.ts`

- [ ] **Step 1: Create SSR-safe viem client**

Create `frontend/app/services/defi/evm/client.ts`:

```typescript
import { createPublicClient, http, type PublicClient, type Chain, defineChain } from 'viem'

// Flow Mainnet chain definition (viem may include flowMainnet, but we define it
// explicitly to avoid version-dependent breakage)
const flowMainnet: Chain = defineChain({
  id: 747,
  name: 'Flow',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.evm.nodes.onflow.org'] } },
  blockExplorers: { default: { name: 'FlowScan', url: 'https://evm.flowscan.io' } },
})

let _client: PublicClient | null = null

/** Lazy-init viem client — SSR-safe (throws if called server-side) */
export function getEvmClient(): PublicClient {
  if (typeof window === 'undefined') {
    throw new Error('getEvmClient() must only be called client-side')
  }
  if (!_client) {
    _client = createPublicClient({
      chain: flowMainnet,
      transport: http('https://mainnet.evm.nodes.onflow.org'),
      batch: { multicall: true },
    })
  }
  return _client
}
```

- [ ] **Step 2: Create contract addresses and curated pair lists**

Create `frontend/app/services/defi/evm/contracts.ts`:

```typescript
// === Ankr ===
export const ANKR = {
  ankrFlow: '0x1b97100eA1D7126C4d60027e231EA4CB25314bdb' as const,
  ratioFeed: '0x32015e1Bd4bAAC9b959b100B0ca253BD131dE38F' as const,
}

// === MORE Markets (Aave V3 fork) ===
export const MORE_MARKETS = {
  pool: '0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d' as const,
  poolDataProvider: '0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf' as const,
  // Supported assets: address → symbol → decimals
  // Addresses must be verified on-chain during implementation (use Blockscout to confirm)
  assets: [
    { address: '0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e' as const, symbol: 'WFLOW', decimals: 18 },
    { address: '0x1b97100eA1D7126C4d60027e231EA4CB25314bdb' as const, symbol: 'ankrFLOW', decimals: 18 },
    { address: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590' as const, symbol: 'WETH', decimals: 18 },
    // Stablecoins — addresses TBD, verify on Blockscout during implementation
    // { address: '0x...', symbol: 'USDF', decimals: 18 },
    // { address: '0x...', symbol: 'stgUSDC', decimals: 6 },
    // { address: '0x...', symbol: 'PYUSD', decimals: 6 },
  ] as const,
}

// === KittyPunch ===
export const KITTYPUNCH = {
  v2Factory: '0x29372c22459a4e373851798bFd6808e71EA34A71' as const,
  v3Factory: '0xf331959366032a634c7cAcF5852fE01ffdB84Af0' as const,
  v3NftManager: '0xDfA7829Eb75B66790b6E9758DF48E518c69ee34a' as const,
  // Top V2 pairs by TVL — update periodically
  v2Pairs: [] as readonly { address: `0x${string}`; token0Symbol: string; token1Symbol: string; token0Decimals: number; token1Decimals: number }[],
}

// === FlowSwap ===
export const FLOWSWAP = {
  v2Factory: '0x681D1bFE03522e0727730Ba02a05CD3C0a08fa30' as const,
  v3NftManager: '0xf7F20a346E3097C7d38afDDA65c7C802950195C7' as const,
  // Top V2 pairs by TVL — update periodically
  v2Pairs: [] as readonly { address: `0x${string}`; token0Symbol: string; token1Symbol: string; token0Decimals: number; token1Decimals: number }[],
}

// WFLOW address (used for price lookups)
export const WFLOW = '0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e' as const
```

> **Note on V2 pairs:** The curated pair lists start empty. During implementation, query the V2Factory `allPairs` to find the top pairs by TVL and populate these arrays. This is a one-time discovery step, not a runtime operation. The lists can also be populated later with real data from GeckoTerminal or similar.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/services/defi/evm/
git commit -m "feat(defi): add viem client and EVM contract config"
```

---

### Task 3: Create ABI fragments

**Files:**
- Create: `frontend/app/services/defi/abis/erc20.ts`
- Create: `frontend/app/services/defi/abis/ankrRatioFeed.ts`
- Create: `frontend/app/services/defi/abis/aaveV3Pool.ts`
- Create: `frontend/app/services/defi/abis/aaveV3PoolDataProvider.ts`
- Create: `frontend/app/services/defi/abis/uniswapV2Pair.ts`
- Create: `frontend/app/services/defi/abis/uniswapV3NftManager.ts`

These are minimal read-only ABI fragments — only the functions we call.

- [ ] **Step 1: Create ERC-20 ABI**

Create `frontend/app/services/defi/abis/erc20.ts`:

```typescript
export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
```

- [ ] **Step 2: Create Ankr RatioFeed ABI**

Create `frontend/app/services/defi/abis/ankrRatioFeed.ts`:

```typescript
export const ankrRatioFeedAbi = [
  {
    type: 'function',
    name: 'getRatioFor',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
```

- [ ] **Step 3: Create Aave V3 ABIs**

Create `frontend/app/services/defi/abis/aaveV3Pool.ts`:

```typescript
export const aaveV3PoolAbi = [
  {
    type: 'function',
    name: 'getUserAccountData',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
  },
] as const
```

Create `frontend/app/services/defi/abis/aaveV3PoolDataProvider.ts`:

```typescript
export const aaveV3PoolDataProviderAbi = [
  {
    type: 'function',
    name: 'getUserReserveData',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'currentATokenBalance', type: 'uint256' },
      { name: 'currentStableDebt', type: 'uint256' },
      { name: 'currentVariableDebt', type: 'uint256' },
      { name: 'principalStableDebt', type: 'uint256' },
      { name: 'scaledVariableDebt', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'stableRateLastUpdated', type: 'uint40' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
    ],
  },
] as const
```

- [ ] **Step 4: Create Uniswap V2 Pair ABI**

Create `frontend/app/services/defi/abis/uniswapV2Pair.ts`:

```typescript
export const uniswapV2PairAbi = [
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const
```

- [ ] **Step 5: Create Uniswap V3 NonfungiblePositionManager ABI**

Create `frontend/app/services/defi/abis/uniswapV3NftManager.ts`:

```typescript
export const uniswapV3NftManagerAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
  },
] as const
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/services/defi/abis/
git commit -m "feat(defi): add minimal read-only ABI fragments for EVM protocols"
```

---

## Chunk 2: EVM Protocol Adapters

### Task 4: Ankr adapter

**Files:**
- Create: `frontend/app/services/defi/evm/ankr.ts`

- [ ] **Step 1: Create Ankr adapter**

Create `frontend/app/services/defi/evm/ankr.ts`:

```typescript
import type { ProtocolResult } from '../types'
import { getEvmClient } from './client'
import { ANKR } from './contracts'
import { erc20Abi } from '../abis/erc20'
import { ankrRatioFeedAbi } from '../abis/ankrRatioFeed'
import { formatUnits } from 'viem'

/**
 * Fetch Ankr liquid staking positions for a COA address.
 * Queries ankrFLOW balance + exchange rate from RatioFeed.
 */
export async function fetchAnkrPositions(
  coaAddress: `0x${string}`,
  flowPriceUsd: number,
): Promise<ProtocolResult> {
  try {
    const client = getEvmClient()

    const [balance, ratio] = await Promise.all([
      client.readContract({
        address: ANKR.ankrFlow,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [coaAddress],
      }),
      client.readContract({
        address: ANKR.ratioFeed,
        abi: ankrRatioFeedAbi,
        functionName: 'getRatioFor',
        args: [ANKR.ankrFlow],
      }),
    ])

    if (balance === 0n) {
      return { protocol: 'ankr', status: 'ok', positions: [] }
    }

    // ratio is in 18 decimals: 1e18 = 1:1 ratio
    const exchangeRate = Number(formatUnits(ratio, 18))
    const amountDisplay = Number(formatUnits(balance, 18))
    const underlyingFlow = amountDisplay * exchangeRate
    const valueUsd = flowPriceUsd > 0 ? underlyingFlow * flowPriceUsd : null

    return {
      protocol: 'ankr',
      status: 'ok',
      positions: [{
        protocol: 'ankr',
        type: 'liquid-staking',
        assets: [{
          symbol: 'ankrFLOW',
          amount: balance.toString(),
          amountDisplay,
          valueUsd,
        }],
        meta: {
          poolName: 'ankrFLOW → FLOW',
          exchangeRate,
        },
      }],
    }
  } catch (err) {
    return {
      protocol: 'ankr',
      status: 'error',
      positions: [],
      error: err instanceof Error ? err.message : 'Failed to fetch Ankr positions',
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep -E "error|ankr" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/services/defi/evm/ankr.ts
git commit -m "feat(defi): add Ankr liquid staking adapter"
```

---

### Task 5: MORE Markets adapter

**Files:**
- Create: `frontend/app/services/defi/evm/more-markets.ts`

- [ ] **Step 1: Create MORE Markets adapter**

Create `frontend/app/services/defi/evm/more-markets.ts`:

```typescript
import type { DeFiPosition, ProtocolResult } from '../types'
import { getEvmClient } from './client'
import { MORE_MARKETS } from './contracts'
import { aaveV3PoolAbi } from '../abis/aaveV3Pool'
import { aaveV3PoolDataProviderAbi } from '../abis/aaveV3PoolDataProvider'
import { formatUnits } from 'viem'

/** Price map: token symbol → USD price */
type PriceMap = Record<string, number>

/**
 * Fetch MORE Markets lending/borrowing positions for a COA address.
 * Uses Aave V3 PoolDataProvider.getUserReserveData for each supported asset,
 * plus Pool.getUserAccountData for aggregate health factor.
 */
export async function fetchMoreMarketsPositions(
  coaAddress: `0x${string}`,
  prices: PriceMap,
): Promise<ProtocolResult> {
  try {
    const client = getEvmClient()

    // Batch all reads in one multicall
    const reserveCalls = MORE_MARKETS.assets.map((asset) => ({
      address: MORE_MARKETS.poolDataProvider,
      abi: aaveV3PoolDataProviderAbi,
      functionName: 'getUserReserveData' as const,
      args: [asset.address, coaAddress] as const,
    }))

    const accountDataCall = {
      address: MORE_MARKETS.pool,
      abi: aaveV3PoolAbi,
      functionName: 'getUserAccountData' as const,
      args: [coaAddress] as const,
    }

    const results = await client.multicall({
      contracts: [...reserveCalls, accountDataCall],
      allowFailure: true,
    })

    const reserveResults = results.slice(0, MORE_MARKETS.assets.length)
    const accountResult = results[MORE_MARKETS.assets.length]

    // Parse health factor from getUserAccountData
    let healthFactor: number | undefined
    if (accountResult.status === 'success') {
      const [, , , , , hf] = accountResult.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint]
      // healthFactor is in 18 decimals, type(uint256).max means no borrows
      const hfNum = Number(formatUnits(hf, 18))
      if (hfNum < 1e15) healthFactor = hfNum // skip absurdly large values (no debt)
    }

    const positions: DeFiPosition[] = []

    for (let i = 0; i < MORE_MARKETS.assets.length; i++) {
      const asset = MORE_MARKETS.assets[i]
      const res = reserveResults[i]
      if (res.status !== 'success') continue

      const [aTokenBal, stableDebt, variableDebt] = res.result as readonly [bigint, bigint, bigint, ...bigint[]]
      const price = prices[asset.symbol] ?? 0

      // Supply position
      if (aTokenBal > 0n) {
        const amt = Number(formatUnits(aTokenBal, asset.decimals))
        positions.push({
          protocol: 'more-markets',
          type: 'lending',
          assets: [{
            symbol: asset.symbol,
            amount: aTokenBal.toString(),
            amountDisplay: amt,
            valueUsd: price > 0 ? amt * price : null,
          }],
          meta: { healthFactor },
        })
      }

      // Borrow position (stable + variable)
      const totalDebt = stableDebt + variableDebt
      if (totalDebt > 0n) {
        const amt = Number(formatUnits(totalDebt, asset.decimals))
        positions.push({
          protocol: 'more-markets',
          type: 'borrowing',
          assets: [{
            symbol: asset.symbol,
            amount: totalDebt.toString(),
            amountDisplay: amt,
            valueUsd: price > 0 ? amt * price : null,
          }],
          meta: { healthFactor },
        })
      }
    }

    return { protocol: 'more-markets', status: 'ok', positions }
  } catch (err) {
    return {
      protocol: 'more-markets',
      status: 'error',
      positions: [],
      error: err instanceof Error ? err.message : 'Failed to fetch MORE Markets positions',
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/services/defi/evm/more-markets.ts
git commit -m "feat(defi): add MORE Markets (Aave V3) lending/borrowing adapter"
```

---

### Task 6: KittyPunch adapter

**Files:**
- Create: `frontend/app/services/defi/evm/kittypunch.ts`

- [ ] **Step 1: Create KittyPunch adapter**

Create `frontend/app/services/defi/evm/kittypunch.ts`:

```typescript
import type { DeFiPosition, ProtocolResult } from '../types'
import { getEvmClient } from './client'
import { KITTYPUNCH } from './contracts'
import { uniswapV2PairAbi } from '../abis/uniswapV2Pair'
import { uniswapV3NftManagerAbi } from '../abis/uniswapV3NftManager'
import { erc20Abi } from '../abis/erc20'
import { formatUnits } from 'viem'

type PriceMap = Record<string, number>

/**
 * Fetch KittyPunch DEX positions: V2 LP + V3 concentrated liquidity.
 */
export async function fetchKittyPunchPositions(
  coaAddress: `0x${string}`,
  prices: PriceMap,
): Promise<ProtocolResult> {
  try {
    const positions: DeFiPosition[] = []

    const [v2Positions, v3Positions] = await Promise.all([
      fetchV2Positions(coaAddress, KITTYPUNCH.v2Pairs, prices),
      fetchV3Positions(coaAddress, KITTYPUNCH.v3NftManager, prices),
    ])

    positions.push(...v2Positions, ...v3Positions)

    return { protocol: 'kittypunch', status: 'ok', positions }
  } catch (err) {
    return {
      protocol: 'kittypunch',
      status: 'error',
      positions: [],
      error: err instanceof Error ? err.message : 'Failed to fetch KittyPunch positions',
    }
  }
}

/** Fetch V2 LP positions from curated pair list */
async function fetchV2Positions(
  user: `0x${string}`,
  pairs: readonly { address: `0x${string}`; token0Symbol: string; token1Symbol: string }[],
  prices: PriceMap,
): Promise<DeFiPosition[]> {
  if (pairs.length === 0) return []

  const client = getEvmClient()
  const positions: DeFiPosition[] = []

  // Batch: balanceOf for each pair
  const balanceCalls = pairs.map((p) => ({
    address: p.address,
    abi: uniswapV2PairAbi,
    functionName: 'balanceOf' as const,
    args: [user] as const,
  }))
  const balances = await client.multicall({ contracts: balanceCalls, allowFailure: true })

  // Find pairs with non-zero balance
  const activePairs = pairs
    .map((p, i) => ({ pair: p, balance: balances[i].status === 'success' ? balances[i].result as bigint : 0n }))
    .filter((p) => p.balance > 0n)

  if (activePairs.length === 0) return []

  // For active pairs, fetch reserves + totalSupply
  const detailCalls = activePairs.flatMap((p) => [
    { address: p.pair.address, abi: uniswapV2PairAbi, functionName: 'getReserves' as const, args: [] as const },
    { address: p.pair.address, abi: uniswapV2PairAbi, functionName: 'totalSupply' as const, args: [] as const },
  ])
  const details = await client.multicall({ contracts: detailCalls, allowFailure: true })

  for (let i = 0; i < activePairs.length; i++) {
    const { pair, balance } = activePairs[i]
    const reservesResult = details[i * 2]
    const supplyResult = details[i * 2 + 1]
    if (reservesResult.status !== 'success' || supplyResult.status !== 'success') continue

    const [reserve0, reserve1] = reservesResult.result as readonly [bigint, bigint, number]
    const totalSupply = supplyResult.result as bigint
    if (totalSupply === 0n) continue

    const share = Number(balance) / Number(totalSupply)
    const dec0 = pair.token0Decimals ?? 18
    const dec1 = pair.token1Decimals ?? 18
    const amt0 = Number(formatUnits(reserve0, dec0)) * share
    const amt1 = Number(formatUnits(reserve1, dec1)) * share
    const price0 = prices[pair.token0Symbol] ?? 0
    const price1 = prices[pair.token1Symbol] ?? 0
    const totalValueUsd = (price0 > 0 && price1 > 0) ? amt0 * price0 + amt1 * price1 : null

    positions.push({
      protocol: 'kittypunch',
      type: 'lp',
      assets: [
        { symbol: pair.token0Symbol, amount: balance.toString(), amountDisplay: amt0, valueUsd: price0 > 0 ? amt0 * price0 : null },
        { symbol: pair.token1Symbol, amount: balance.toString(), amountDisplay: amt1, valueUsd: price1 > 0 ? amt1 * price1 : null },
      ],
      meta: { poolName: `${pair.token0Symbol}/${pair.token1Symbol}` },
    })
  }

  return positions
}

/** Fetch V3 concentrated liquidity positions via NonfungiblePositionManager */
async function fetchV3Positions(
  user: `0x${string}`,
  nftManager: `0x${string}`,
  prices: PriceMap,
): Promise<DeFiPosition[]> {
  const client = getEvmClient()
  const positions: DeFiPosition[] = []

  // Step 1: Get number of positions
  const count = await client.readContract({
    address: nftManager,
    abi: uniswapV3NftManagerAbi,
    functionName: 'balanceOf',
    args: [user],
  })

  if (count === 0n) return []

  // Step 2: Get token IDs
  const indexCalls = Array.from({ length: Number(count) }, (_, i) => ({
    address: nftManager,
    abi: uniswapV3NftManagerAbi,
    functionName: 'tokenOfOwnerByIndex' as const,
    args: [user, BigInt(i)] as const,
  }))
  const tokenIdResults = await client.multicall({ contracts: indexCalls, allowFailure: true })
  const tokenIds = tokenIdResults
    .filter((r) => r.status === 'success')
    .map((r) => r.result as bigint)

  if (tokenIds.length === 0) return []

  // Step 3: Get position details
  const posCalls = tokenIds.map((id) => ({
    address: nftManager,
    abi: uniswapV3NftManagerAbi,
    functionName: 'positions' as const,
    args: [id] as const,
  }))
  const posResults = await client.multicall({ contracts: posCalls, allowFailure: true })

  // Step 4: Resolve token symbols AND decimals (batch)
  const tokenAddresses = new Set<`0x${string}`>()
  for (const r of posResults) {
    if (r.status !== 'success') continue
    const [, , token0, token1] = r.result as readonly [bigint, string, `0x${string}`, `0x${string}`, ...unknown[]]
    tokenAddresses.add(token0)
    tokenAddresses.add(token1)
  }
  const metaCalls = [...tokenAddresses].flatMap((addr) => [
    { address: addr, abi: erc20Abi, functionName: 'symbol' as const, args: [] as const },
    { address: addr, abi: erc20Abi, functionName: 'decimals' as const, args: [] as const },
  ])
  const metaResults = await client.multicall({ contracts: metaCalls, allowFailure: true })
  const symbolMap = new Map<string, string>()
  const decimalsMap = new Map<string, number>()
  ;[...tokenAddresses].forEach((addr, i) => {
    const symRes = metaResults[i * 2]
    const decRes = metaResults[i * 2 + 1]
    if (symRes.status === 'success') symbolMap.set(addr.toLowerCase(), symRes.result as string)
    decimalsMap.set(addr.toLowerCase(), decRes.status === 'success' ? Number(decRes.result) : 18)
  })

  for (const r of posResults) {
    if (r.status !== 'success') continue
    const [, , token0, token1, , tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] =
      r.result as readonly [bigint, string, `0x${string}`, `0x${string}`, number, number, number, bigint, bigint, bigint, bigint, bigint]

    if (liquidity === 0n && tokensOwed0 === 0n && tokensOwed1 === 0n) continue

    const sym0 = symbolMap.get(token0.toLowerCase()) ?? token0.slice(0, 10)
    const sym1 = symbolMap.get(token1.toLowerCase()) ?? token1.slice(0, 10)
    const dec0 = decimalsMap.get(token0.toLowerCase()) ?? 18
    const dec1 = decimalsMap.get(token1.toLowerCase()) ?? 18

    // For V3, we show tokens owed as claimable amounts
    const owed0 = Number(formatUnits(tokensOwed0, dec0))
    const owed1 = Number(formatUnits(tokensOwed1, dec1))
    const price0 = prices[sym0] ?? 0
    const price1 = prices[sym1] ?? 0

    positions.push({
      protocol: 'kittypunch',
      type: 'lp',
      assets: [
        { symbol: sym0, amount: tokensOwed0.toString(), amountDisplay: owed0, valueUsd: price0 > 0 ? owed0 * price0 : null },
        { symbol: sym1, amount: tokensOwed1.toString(), amountDisplay: owed1, valueUsd: price1 > 0 ? owed1 * price1 : null },
      ],
      meta: {
        poolName: `${sym0}/${sym1}`,
        tickRange: [tickLower, tickUpper],
      },
    })
  }

  return positions
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/services/defi/evm/kittypunch.ts
git commit -m "feat(defi): add KittyPunch V2/V3 DEX LP adapter"
```

---

### Task 7: FlowSwap adapter

**Files:**
- Create: `frontend/app/services/defi/evm/flowswap.ts`

- [ ] **Step 1: Create FlowSwap adapter**

FlowSwap uses the same Uniswap V2/V3 interfaces as KittyPunch. Reuse the V2/V3 fetching logic by extracting it, or duplicate with different contract addresses. For simplicity and independence, create a standalone adapter that imports the shared helper from kittypunch or duplicates the pattern:

Create `frontend/app/services/defi/evm/flowswap.ts`:

```typescript
import type { DeFiPosition, ProtocolResult } from '../types'
import { getEvmClient } from './client'
import { FLOWSWAP } from './contracts'
import { uniswapV2PairAbi } from '../abis/uniswapV2Pair'
import { uniswapV3NftManagerAbi } from '../abis/uniswapV3NftManager'
import { erc20Abi } from '../abis/erc20'
import { formatUnits } from 'viem'

type PriceMap = Record<string, number>

/**
 * Fetch FlowSwap DEX positions: V2 LP + V3 concentrated liquidity.
 * Same interface as KittyPunch (Uniswap V2/V3 fork).
 */
export async function fetchFlowSwapPositions(
  coaAddress: `0x${string}`,
  prices: PriceMap,
): Promise<ProtocolResult> {
  try {
    const positions: DeFiPosition[] = []

    const [v2Positions, v3Positions] = await Promise.all([
      fetchV2Positions(coaAddress, prices),
      fetchV3Positions(coaAddress, prices),
    ])

    positions.push(...v2Positions, ...v3Positions)

    return { protocol: 'flowswap', status: 'ok', positions }
  } catch (err) {
    return {
      protocol: 'flowswap',
      status: 'error',
      positions: [],
      error: err instanceof Error ? err.message : 'Failed to fetch FlowSwap positions',
    }
  }
}

async function fetchV2Positions(user: `0x${string}`, prices: PriceMap): Promise<DeFiPosition[]> {
  if (FLOWSWAP.v2Pairs.length === 0) return []

  const client = getEvmClient()
  const positions: DeFiPosition[] = []

  const balanceCalls = FLOWSWAP.v2Pairs.map((p) => ({
    address: p.address,
    abi: uniswapV2PairAbi,
    functionName: 'balanceOf' as const,
    args: [user] as const,
  }))
  const balances = await client.multicall({ contracts: balanceCalls, allowFailure: true })

  const activePairs = FLOWSWAP.v2Pairs
    .map((p, i) => ({ pair: p, balance: balances[i].status === 'success' ? balances[i].result as bigint : 0n }))
    .filter((p) => p.balance > 0n)

  if (activePairs.length === 0) return []

  const detailCalls = activePairs.flatMap((p) => [
    { address: p.pair.address, abi: uniswapV2PairAbi, functionName: 'getReserves' as const, args: [] as const },
    { address: p.pair.address, abi: uniswapV2PairAbi, functionName: 'totalSupply' as const, args: [] as const },
  ])
  const details = await client.multicall({ contracts: detailCalls, allowFailure: true })

  for (let i = 0; i < activePairs.length; i++) {
    const { pair, balance } = activePairs[i]
    const reservesResult = details[i * 2]
    const supplyResult = details[i * 2 + 1]
    if (reservesResult.status !== 'success' || supplyResult.status !== 'success') continue

    const [reserve0, reserve1] = reservesResult.result as readonly [bigint, bigint, number]
    const totalSupply = supplyResult.result as bigint
    if (totalSupply === 0n) continue

    const share = Number(balance) / Number(totalSupply)
    const dec0 = pair.token0Decimals ?? 18
    const dec1 = pair.token1Decimals ?? 18
    const amt0 = Number(formatUnits(reserve0, dec0)) * share
    const amt1 = Number(formatUnits(reserve1, dec1)) * share
    const price0 = prices[pair.token0Symbol] ?? 0
    const price1 = prices[pair.token1Symbol] ?? 0

    positions.push({
      protocol: 'flowswap',
      type: 'lp',
      assets: [
        { symbol: pair.token0Symbol, amount: balance.toString(), amountDisplay: amt0, valueUsd: price0 > 0 ? amt0 * price0 : null },
        { symbol: pair.token1Symbol, amount: balance.toString(), amountDisplay: amt1, valueUsd: price1 > 0 ? amt1 * price1 : null },
      ],
      meta: { poolName: `${pair.token0Symbol}/${pair.token1Symbol}` },
    })
  }

  return positions
}

async function fetchV3Positions(user: `0x${string}`, prices: PriceMap): Promise<DeFiPosition[]> {
  const client = getEvmClient()
  const positions: DeFiPosition[] = []
  const nftManager = FLOWSWAP.v3NftManager

  const count = await client.readContract({
    address: nftManager,
    abi: uniswapV3NftManagerAbi,
    functionName: 'balanceOf',
    args: [user],
  })
  if (count === 0n) return []

  const indexCalls = Array.from({ length: Number(count) }, (_, i) => ({
    address: nftManager,
    abi: uniswapV3NftManagerAbi,
    functionName: 'tokenOfOwnerByIndex' as const,
    args: [user, BigInt(i)] as const,
  }))
  const tokenIdResults = await client.multicall({ contracts: indexCalls, allowFailure: true })
  const tokenIds = tokenIdResults.filter((r) => r.status === 'success').map((r) => r.result as bigint)
  if (tokenIds.length === 0) return []

  const posCalls = tokenIds.map((id) => ({
    address: nftManager,
    abi: uniswapV3NftManagerAbi,
    functionName: 'positions' as const,
    args: [id] as const,
  }))
  const posResults = await client.multicall({ contracts: posCalls, allowFailure: true })

  const tokenAddresses = new Set<`0x${string}`>()
  for (const r of posResults) {
    if (r.status !== 'success') continue
    const [, , token0, token1] = r.result as readonly [bigint, string, `0x${string}`, `0x${string}`, ...unknown[]]
    tokenAddresses.add(token0)
    tokenAddresses.add(token1)
  }
  const metaCalls = [...tokenAddresses].flatMap((addr) => [
    { address: addr, abi: erc20Abi, functionName: 'symbol' as const, args: [] as const },
    { address: addr, abi: erc20Abi, functionName: 'decimals' as const, args: [] as const },
  ])
  const metaResults = await client.multicall({ contracts: metaCalls, allowFailure: true })
  const symbolMap = new Map<string, string>()
  const decimalsMap = new Map<string, number>()
  ;[...tokenAddresses].forEach((addr, i) => {
    const symRes = metaResults[i * 2]
    const decRes = metaResults[i * 2 + 1]
    if (symRes.status === 'success') symbolMap.set(addr.toLowerCase(), symRes.result as string)
    decimalsMap.set(addr.toLowerCase(), decRes.status === 'success' ? Number(decRes.result) : 18)
  })

  for (const r of posResults) {
    if (r.status !== 'success') continue
    const [, , token0, token1, , tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] =
      r.result as readonly [bigint, string, `0x${string}`, `0x${string}`, number, number, number, bigint, bigint, bigint, bigint, bigint]
    if (liquidity === 0n && tokensOwed0 === 0n && tokensOwed1 === 0n) continue

    const sym0 = symbolMap.get(token0.toLowerCase()) ?? token0.slice(0, 10)
    const sym1 = symbolMap.get(token1.toLowerCase()) ?? token1.slice(0, 10)
    const dec0 = decimalsMap.get(token0.toLowerCase()) ?? 18
    const dec1 = decimalsMap.get(token1.toLowerCase()) ?? 18
    const owed0 = Number(formatUnits(tokensOwed0, dec0))
    const owed1 = Number(formatUnits(tokensOwed1, dec1))
    const price0 = prices[sym0] ?? 0
    const price1 = prices[sym1] ?? 0

    positions.push({
      protocol: 'flowswap',
      type: 'lp',
      assets: [
        { symbol: sym0, amount: tokensOwed0.toString(), amountDisplay: owed0, valueUsd: price0 > 0 ? owed0 * price0 : null },
        { symbol: sym1, amount: tokensOwed1.toString(), amountDisplay: owed1, valueUsd: price1 > 0 ? owed1 * price1 : null },
      ],
      meta: { poolName: `${sym0}/${sym1}`, tickRange: [tickLower, tickUpper] },
    })
  }

  return positions
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/services/defi/evm/flowswap.ts
git commit -m "feat(defi): add FlowSwap V2/V3 DEX LP adapter"
```

---

## Chunk 3: IncrementFi Cadence Adapter

### Task 8: IncrementFi adapter

**Files:**
- Create: `frontend/app/services/defi/incrementfi.ts`

> **Note:** The Cadence script for IncrementFi requires research into IncrementFi's storage paths, contract interfaces, and lending contract addresses. These may need to be discovered on-chain during implementation. The adapter below uses `cadenceService` if the codegen method exists, or falls back to a direct FCL query with an inline script.

- [ ] **Step 1: Create IncrementFi adapter with stFlow position**

Start with stFlow liquid staking (confirmed contract address) and LP positions. Lending/borrowing and farming can be added incrementally once contract details are verified.

Create `frontend/app/services/defi/incrementfi.ts`:

```typescript
import type { DeFiPosition, ProtocolResult } from './types'

/**
 * Fetch IncrementFi positions for a Flow address.
 * Uses FCL to execute Cadence scripts.
 *
 * Phase 1: stFlow liquid staking position
 * Phase 2: LP positions (requires LpTokenCollection discovery)
 * Phase 3: Lending/borrowing (requires contract address verification)
 */
export async function fetchIncrementFiPositions(
  flowAddress: string,
  flowPriceUsd: number,
): Promise<ProtocolResult> {
  try {
    const { cadenceService } = await import('../fclConfig')
    const positions: DeFiPosition[] = []

    // Query stFlow balance from the user's FT vaults (reuse existing getToken)
    const tokenRes = await cadenceService.getToken(flowAddress).catch(() => null)
    if (tokenRes?.tokens) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stFlowVault = tokenRes.tokens.find((t: any) =>
        t.contractName === 'stFlowToken' || t.symbol === 'stFlow'
      )
      if (stFlowVault && Number(stFlowVault.balance) > 0) {
        const balance = Number(stFlowVault.balance)
        // stFlow exchange rate: ~1.06 stFlow = 1 FLOW (approximate, actual rate from on-chain)
        // TODO: Query LiquidStaking.calcFlowFromStFlow() for exact rate
        const exchangeRate = 1.0 // placeholder — will be replaced with on-chain query
        const underlyingFlow = balance * exchangeRate
        const valueUsd = flowPriceUsd > 0 ? underlyingFlow * flowPriceUsd : null

        positions.push({
          protocol: 'incrementfi',
          type: 'liquid-staking',
          assets: [{
            symbol: 'stFlow',
            amount: stFlowVault.balance.toString(),
            amountDisplay: balance,
            valueUsd,
          }],
          meta: {
            poolName: 'stFlow → FLOW',
            exchangeRate,
          },
        })
      }

      // Check for LP tokens in vault list
      // IncrementFi LP tokens have contractName containing "SwapPair"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lpVaults = tokenRes.tokens.filter((t: any) =>
        t.contractName?.includes('SwapPair') || t.path?.includes('SwapPair')
      )
      for (const lp of lpVaults) {
        if (Number(lp.balance) <= 0) continue
        positions.push({
          protocol: 'incrementfi',
          type: 'lp',
          assets: [{
            symbol: lp.symbol || lp.contractName || 'LP',
            amount: lp.balance.toString(),
            amountDisplay: Number(lp.balance),
            valueUsd: null, // LP token pricing requires pool reserves query
          }],
          meta: {
            poolName: lp.symbol || lp.contractName || 'IncrementFi LP',
          },
        })
      }
    }

    return { protocol: 'incrementfi', status: 'ok', positions }
  } catch (err) {
    return {
      protocol: 'incrementfi',
      status: 'error',
      positions: [],
      error: err instanceof Error ? err.message : 'Failed to fetch IncrementFi positions',
    }
  }
}
```

> **Implementation note:** This adapter piggybacks on the existing `cadenceService.getToken()` which already iterates all FT vaults in the user's storage. stFlow and LP tokens show up as FT vaults. For a more detailed IncrementFi integration (lending, farming, exact stFlow exchange rate), a dedicated Cadence script should be written in a follow-up.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/services/defi/incrementfi.ts
git commit -m "feat(defi): add IncrementFi adapter (stFlow + LP via getToken)"
```

---

## Chunk 4: Orchestrator & Hook

### Task 9: Create fetchAllPositions orchestrator and useDefiPositions hook

**Files:**
- Create: `frontend/app/services/defi/index.ts`

- [ ] **Step 1: Create orchestrator and hook**

Create `frontend/app/services/defi/index.ts`:

```typescript
import type { ProtocolResult, ProtocolId } from './types'
import { PROTOCOL_META } from './types'
import { fetchIncrementFiPositions } from './incrementfi'
import { useState, useEffect, useCallback, useRef } from 'react'

/** Price map: token symbol → USD price */
type PriceMap = Record<string, number>

/**
 * Fetch DeFi positions from all protocols in parallel.
 * EVM adapters are dynamically imported (code-split) and skipped if no COA address.
 */
export async function fetchAllPositions(
  flowAddress: string,
  coaAddress: string | undefined,
  flowPriceUsd: number,
  prices: PriceMap,
): Promise<ProtocolResult[]> {
  const promises: Promise<ProtocolResult>[] = []

  // Cadence protocols — always query
  promises.push(fetchIncrementFiPositions(flowAddress, flowPriceUsd))

  // EVM protocols — only if COA address exists
  if (coaAddress) {
    const normalizedCoa = (coaAddress.startsWith('0x') ? coaAddress : `0x${coaAddress}`) as `0x${string}`

    // Dynamic import for code-splitting — viem only loaded when DeFi tab is opened
    const evmPromise = import('./evm/ankr').then(({ fetchAnkrPositions }) =>
      fetchAnkrPositions(normalizedCoa, flowPriceUsd)
    )
    const morePromise = import('./evm/more-markets').then(({ fetchMoreMarketsPositions }) =>
      fetchMoreMarketsPositions(normalizedCoa, prices)
    )
    const kittyPromise = import('./evm/kittypunch').then(({ fetchKittyPunchPositions }) =>
      fetchKittyPunchPositions(normalizedCoa, prices)
    )
    const flowswapPromise = import('./evm/flowswap').then(({ fetchFlowSwapPositions }) =>
      fetchFlowSwapPositions(normalizedCoa, prices)
    )

    promises.push(evmPromise, morePromise, kittyPromise, flowswapPromise)
  }

  const settled = await Promise.allSettled(promises)

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value
    // Promise.allSettled rejection — shouldn't happen since adapters catch internally
    const protocols: ProtocolId[] = coaAddress
      ? ['incrementfi', 'ankr', 'more-markets', 'kittypunch', 'flowswap']
      : ['incrementfi']
    return {
      protocol: protocols[i] ?? 'incrementfi',
      status: 'error' as const,
      positions: [],
      error: result.reason?.message || 'Unknown error',
    }
  })
}

/**
 * Build price map from FLOW price. Extend with more tokens as backend provides them.
 * Defined at module level to avoid object identity instability.
 */
function buildPriceMap(flowPriceUsd: number): PriceMap {
  return {
    FLOW: flowPriceUsd,
    WFLOW: flowPriceUsd,
    // Add more as available from backend /status endpoint
  }
}

/**
 * React hook for fetching DeFi positions.
 * Manages loading, error, and staleness states.
 * Accepts only primitive/stable values to avoid re-render loops.
 */
export function useDefiPositions(
  flowAddress: string,
  coaAddress: string | undefined,
  flowPriceUsd: number,
) {
  const [results, setResults] = useState<ProtocolResult[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const fetchIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++fetchIdRef.current
    setLoading(true)

    // Build price map from primitives — no object identity issues
    const prices = buildPriceMap(flowPriceUsd)
    const allResults = await fetchAllPositions(flowAddress, coaAddress, flowPriceUsd, prices)

    // Only update if this is still the latest fetch
    if (id === fetchIdRef.current) {
      setResults(allResults)
      setLoading(false)
      setFetchedAt(new Date())
    }
  }, [flowAddress, coaAddress, flowPriceUsd])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Compute summary
  const totalValueUsd = results.reduce((sum, r) => {
    if (r.status !== 'ok') return sum
    return sum + r.positions.reduce((pSum, p) => {
      const posValue = p.assets.reduce((aSum, a) => aSum + (a.valueUsd ?? 0), 0)
      // Borrowing is negative
      return pSum + (p.type === 'borrowing' ? -posValue : posValue)
    }, 0)
  }, 0)

  const positionCount = results.reduce(
    (sum, r) => sum + (r.status === 'ok' ? r.positions.length : 0), 0
  )

  return {
    results,
    loading,
    fetchedAt,
    refresh,
    totalValueUsd,
    positionCount,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep "error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/services/defi/index.ts
git commit -m "feat(defi): add position orchestrator with useDefiPositions hook"
```

---

## Chunk 5: UI Components

### Task 10: Create position row components

**Files:**
- Create: `frontend/app/components/account/defi/LendingPositionRow.tsx`
- Create: `frontend/app/components/account/defi/LpPositionRow.tsx`
- Create: `frontend/app/components/account/defi/StakingPositionRow.tsx`
- Create: `frontend/app/components/account/defi/DefiEmptyState.tsx`

- [ ] **Step 1: Create LendingPositionRow**

Create `frontend/app/components/account/defi/LendingPositionRow.tsx`:

```tsx
import type { DeFiPosition } from '../../../services/defi/types'

export function LendingPositionRow({ position }: { position: DeFiPosition }) {
  const asset = position.assets[0]
  if (!asset) return null
  const isBorrow = position.type === 'borrowing'

  return (
    <div className="flex items-center justify-between py-2.5 px-3 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
          isBorrow
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
        }`}>
          {isBorrow ? 'Borrow' : 'Supply'}
        </span>
        <span className="text-sm font-medium">{asset.symbol}</span>
      </div>
      <div className="text-right">
        <div className="text-sm font-mono">
          {asset.amountDisplay.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </div>
        {asset.valueUsd != null && (
          <div className={`text-xs ${isBorrow ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {isBorrow ? '-' : ''}${Math.abs(asset.valueUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create LpPositionRow**

Create `frontend/app/components/account/defi/LpPositionRow.tsx`:

```tsx
import type { DeFiPosition } from '../../../services/defi/types'

export function LpPositionRow({ position }: { position: DeFiPosition }) {
  const totalValue = position.assets.reduce((sum, a) => sum + (a.valueUsd ?? 0), 0)

  return (
    <div className="py-2.5 px-3 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            LP
          </span>
          <span className="text-sm font-medium">{position.meta.poolName || 'Pool'}</span>
          {position.meta.tickRange && (
            <span className="text-[10px] text-zinc-400 font-mono">
              V3 [{position.meta.tickRange[0]}, {position.meta.tickRange[1]}]
            </span>
          )}
        </div>
        {totalValue > 0 && (
          <span className="text-sm font-mono text-zinc-500 dark:text-zinc-400">
            ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      <div className="flex gap-4 mt-1.5 ml-[52px]">
        {position.assets.map((asset, i) => (
          <span key={i} className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {asset.amountDisplay.toLocaleString(undefined, { maximumFractionDigits: 4 })} {asset.symbol}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create StakingPositionRow**

Create `frontend/app/components/account/defi/StakingPositionRow.tsx`:

```tsx
import type { DeFiPosition } from '../../../services/defi/types'

export function StakingPositionRow({ position }: { position: DeFiPosition }) {
  const asset = position.assets[0]
  if (!asset) return null

  return (
    <div className="py-2.5 px-3 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
            Staked
          </span>
          <span className="text-sm font-medium">{asset.symbol}</span>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono">
            {asset.amountDisplay.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </div>
          {asset.valueUsd != null && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              ${asset.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </div>
      {position.meta.exchangeRate != null && (
        <div className="text-[11px] text-zinc-400 mt-1 ml-[52px]">
          Rate: 1 {asset.symbol} ≈ {position.meta.exchangeRate.toFixed(4)} FLOW
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create DefiEmptyState**

Create `frontend/app/components/account/defi/DefiEmptyState.tsx`:

```tsx
import { ChartLine } from 'lucide-react'
import { GlassCard } from '@flowindex/flow-ui'

export function DefiEmptyState({ noCoa }: { noCoa?: boolean }) {
  return (
    <GlassCard className="p-12 text-center">
      <ChartLine className="h-10 w-10 mx-auto mb-4 text-zinc-300 dark:text-zinc-600" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No DeFi positions found for this account.
      </p>
      {noCoa && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
          No EVM address linked — only Cadence protocol positions were checked.
        </p>
      )}
    </GlassCard>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/account/defi/
git commit -m "feat(defi): add position row components and empty state"
```

---

### Task 11: Create DefiProtocolSection component

**Files:**
- Create: `frontend/app/components/account/defi/DefiProtocolSection.tsx`

- [ ] **Step 1: Create collapsible protocol section**

Create `frontend/app/components/account/defi/DefiProtocolSection.tsx`:

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { GlassCard } from '@flowindex/flow-ui'
import type { ProtocolResult, DeFiPosition } from '../../../services/defi/types'
import { PROTOCOL_META } from '../../../services/defi/types'
import { LendingPositionRow } from './LendingPositionRow'
import { LpPositionRow } from './LpPositionRow'
import { StakingPositionRow } from './StakingPositionRow'

function PositionRow({ position }: { position: DeFiPosition }) {
  switch (position.type) {
    case 'lending':
    case 'borrowing':
      return <LendingPositionRow position={position} />
    case 'lp':
    case 'farming':
      return <LpPositionRow position={position} />
    case 'liquid-staking':
      return <StakingPositionRow position={position} />
    default:
      return null
  }
}

interface Props {
  result: ProtocolResult
  defaultExpanded?: boolean
}

export function DefiProtocolSection({ result, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const meta = PROTOCOL_META[result.protocol]
  const isError = result.status === 'error'
  const isEmpty = result.status === 'ok' && result.positions.length === 0
  const hasPositions = result.status === 'ok' && result.positions.length > 0

  // Calculate total value
  const totalValue = hasPositions
    ? result.positions.reduce((sum, p) => {
        const posValue = p.assets.reduce((aSum, a) => aSum + (a.valueUsd ?? 0), 0)
        return sum + (p.type === 'borrowing' ? -posValue : posValue)
      }, 0)
    : 0

  // Health factor from MORE Markets
  const healthFactor = result.positions.find((p) => p.meta.healthFactor != null)?.meta.healthFactor

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          {isError ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : expanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          )}
          <span className="font-bold text-sm">{meta.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
            {meta.type}
          </span>
          {isEmpty && (
            <span className="text-[10px] text-zinc-400">(no positions)</span>
          )}
          {isError && (
            <span className="text-[10px] text-red-500">{result.error || 'Failed to load'}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {healthFactor != null && (
            <span className={`text-[10px] font-mono ${
              healthFactor < 1.5 ? 'text-red-500' : healthFactor < 2.5 ? 'text-amber-500' : 'text-zinc-400'
            }`}>
              HF: {healthFactor.toFixed(2)}
            </span>
          )}
          {hasPositions && totalValue !== 0 && (
            <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </button>

      {expanded && hasPositions && (
        <div className="border-t border-zinc-100 dark:border-white/5">
          {result.positions.map((position, i) => (
            <PositionRow key={i} position={position} />
          ))}
        </div>
      )}
    </GlassCard>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/account/defi/DefiProtocolSection.tsx
git commit -m "feat(defi): add collapsible protocol section component"
```

---

### Task 12: Create DefiSummaryBar and AccountDefiTab

**Files:**
- Create: `frontend/app/components/account/defi/DefiSummaryBar.tsx`
- Create: `frontend/app/components/account/AccountDefiTab.tsx`

- [ ] **Step 1: Create DefiSummaryBar**

Create `frontend/app/components/account/defi/DefiSummaryBar.tsx`:

```tsx
import { RefreshCw } from 'lucide-react'

interface Props {
  totalValueUsd: number
  positionCount: number
  fetchedAt: Date | null
  loading: boolean
  onRefresh: () => void
}

export function DefiSummaryBar({ totalValueUsd, positionCount, fetchedAt, loading, onRefresh }: Props) {
  const timeAgo = fetchedAt ? getTimeAgo(fetchedAt) : null

  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500">DeFi Positions</h3>
        {positionCount > 0 && (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-lg font-bold font-mono">
              ${totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-zinc-400">
              {positionCount} position{positionCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {timeAgo && (
          <span className="text-[10px] text-zinc-400">
            Fetched {timeAgo}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
```

- [ ] **Step 2: Create AccountDefiTab**

Create `frontend/app/components/account/AccountDefiTab.tsx`:

```tsx
import { useDefiPositions } from '../../services/defi'
import { DefiSummaryBar } from './defi/DefiSummaryBar'
import { DefiProtocolSection } from './defi/DefiProtocolSection'
import { DefiEmptyState } from './defi/DefiEmptyState'
import { GlassCard } from '@flowindex/flow-ui'

interface Props {
  address: string
  coaAddress?: string
  flowPriceUsd: number
}

export function AccountDefiTab({ address, coaAddress, flowPriceUsd }: Props) {
  const {
    results,
    loading,
    fetchedAt,
    refresh,
    totalValueUsd,
    positionCount,
  } = useDefiPositions(address, coaAddress, flowPriceUsd)

  if (loading && results.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-40 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
          <div className="h-8 w-8 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
        </div>
        {[0, 1, 2].map((i) => (
          <GlassCard key={i} className="h-14 animate-pulse" />
        ))}
      </div>
    )
  }

  // Sort by total value (highest first), errors last
  const sorted = [...results].sort((a, b) => {
    if (a.status === 'error' && b.status !== 'error') return 1
    if (b.status === 'error' && a.status !== 'error') return -1
    const valueA = a.positions.reduce((s, p) => s + p.assets.reduce((as2, asset) => as2 + (asset.valueUsd ?? 0), 0), 0)
    const valueB = b.positions.reduce((s, p) => s + p.assets.reduce((as2, asset) => as2 + (asset.valueUsd ?? 0), 0), 0)
    return valueB - valueA
  })

  const allEmpty = results.every((r) => r.status === 'ok' && r.positions.length === 0)

  if (allEmpty && !loading) {
    return (
      <>
        <DefiSummaryBar
          totalValueUsd={0}
          positionCount={0}
          fetchedAt={fetchedAt}
          loading={loading}
          onRefresh={refresh}
        />
        <DefiEmptyState noCoa={!coaAddress} />
      </>
    )
  }

  return (
    <div>
      <DefiSummaryBar
        totalValueUsd={totalValueUsd}
        positionCount={positionCount}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={refresh}
      />
      <div className="space-y-3">
        {sorted.map((result) => (
          <DefiProtocolSection
            key={result.protocol}
            result={result}
            defaultExpanded={result.status === 'ok' && result.positions.length > 0}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep "error" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/account/AccountDefiTab.tsx frontend/app/components/account/defi/DefiSummaryBar.tsx
git commit -m "feat(defi): add AccountDefiTab with summary bar and position rendering"
```

---

## Chunk 6: Route Integration

### Task 13: Wire DeFi tab into account page

**Files:**
- Modify: `frontend/app/routes/accounts/$address.tsx`

- [ ] **Step 1: Add import for AccountDefiTab**

At `frontend/app/routes/accounts/$address.tsx`, add the import near line 28 (after the other tab imports):

```typescript
import { AccountDefiTab } from '../../components/account/AccountDefiTab';
```

- [ ] **Step 2: Add 'defi' to VALID_TABS**

Change line 49 from:

```typescript
const VALID_TABS = ['activity', 'balance', 'tokens', 'nfts', 'staking', 'keys', 'contracts', 'storage', 'linked'] as const;
```

to:

```typescript
const VALID_TABS = ['activity', 'balance', 'tokens', 'nfts', 'defi', 'staking', 'keys', 'contracts', 'storage', 'linked'] as const;
```

- [ ] **Step 3: Add DeFi tab to tabs array**

In the `tabs` array (line 289), add the DeFi tab after 'nfts' and before 'staking':

```typescript
{ id: 'defi' as const, label: 'DeFi', icon: ChartLine },
```

The full tabs array should be:
```typescript
const tabs = [
    { id: 'activity' as const, label: 'Activity', icon: Activity },
    { id: 'tokens' as const, label: 'Tokens', icon: Coins },
    { id: 'nfts' as const, label: 'NFTs', icon: ImageIcon },
    { id: 'defi' as const, label: 'DeFi', icon: ChartLine },
    { id: 'staking' as const, label: 'Staking', icon: Landmark },
    { id: 'keys' as const, label: 'Public Keys', icon: Key },
    { id: 'contracts' as const, label: `Contracts (${account.contracts?.length || 0})`, icon: FileText },
    { id: 'storage' as const, label: 'Storage', icon: HardDrive },
    { id: 'linked' as const, label: 'Linked Accounts', icon: Link2 },
    { id: 'balance' as const, label: 'Balance', icon: TrendingUp },
];
```

> Note: `ChartLine` is already imported (line 10). No new icon import needed.

- [ ] **Step 4: Add render branch for DeFi tab**

In the tab content area (after line 631, the `nfts` tab render), add:

```tsx
{activeTab === 'defi' && <AccountDefiTab address={normalizedAddress} coaAddress={onChainData?.coaAddress} flowPriceUsd={flowPrice} />}
```

No helper function needed — the price map is built internally by the `useDefiPositions` hook.

- [ ] **Step 5: Verify the build compiles**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | grep "error" | head -10
```

- [ ] **Step 6: Verify the full build succeeds**

```bash
cd frontend && NODE_OPTIONS="--max-old-space-size=8192" bun run build 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add frontend/app/routes/accounts/\$address.tsx
git commit -m "feat(defi): wire DeFi tab into account detail page"
```

---

### Task 14: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
cd frontend && bun run dev
```

- [ ] **Step 2: Test with a known DeFi address**

Open the browser and navigate to an account that has DeFi positions. Test:
1. DeFi tab appears in the tab bar
2. Loading skeletons show while fetching
3. Protocol sections render with correct data
4. Collapsible sections expand/collapse
5. Refresh button works
6. Empty state shows for accounts with no DeFi positions
7. Error states render gracefully if a protocol fails
8. No EVM protocols shown when account has no COA

Good test addresses (find accounts with DeFi positions):
- Check MORE Markets / KittyPunch frontends for active addresses
- Or use the backend: `SELECT DISTINCT maker FROM app.defi_events LIMIT 10`

- [ ] **Step 3: Test SSR**

Verify the page loads correctly with SSR (no hydration errors in console). The DeFi tab data should load client-side after navigation, not during SSR.

- [ ] **Step 4: Run lint**

```bash
cd frontend && bun run lint
```

Fix any lint errors before proceeding.

- [ ] **Step 5: Final commit with any lint fixes**

```bash
git add -A && git commit -m "fix(defi): lint fixes"
```

---

## Follow-up Items (Not in This Plan)

These are deferred to future work:

1. **Add MORE Markets stablecoin assets** — Verify USDF, stgUSDC, PYUSD contract addresses on Blockscout and add to `contracts.ts`
2. **Populate V2 curated pair lists** — Query KittyPunch and FlowSwap V2Factory to find top pairs by TVL, add to `contracts.ts`
2. **IncrementFi lending/farming** — Write dedicated Cadence script for LendingPool and farming positions
3. **stFlow exact exchange rate** — Add Cadence script calling `LiquidStaking.calcFlowFromStFlow()`
4. **Richer price map** — Fetch more token prices from backend `/status` or CoinGecko
5. **Backend caching API** — Add `/flow/v1/account/{address}/defi` with TTL cache
6. **StableKitty pool discovery** — Find known StableKitty pool addresses
