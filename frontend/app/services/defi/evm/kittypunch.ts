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
  pairs: readonly { address: `0x${string}`; token0Symbol: string; token1Symbol: string; token0Decimals: number; token1Decimals: number }[],
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
