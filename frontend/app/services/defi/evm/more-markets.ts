import type { DeFiPosition, ProtocolResult } from '../types'
import { getEvmClient } from './client'
import { MORE_MARKETS } from './contracts'
import { aaveV3PoolAbi } from '../abis/aaveV3Pool'
import { aaveV3PoolDataProviderAbi } from '../abis/aaveV3PoolDataProvider'
import { formatUnits } from 'viem'

type PriceMap = Record<string, number>

export async function fetchMoreMarketsPositions(
  coaAddress: `0x${string}`,
  prices: PriceMap,
): Promise<ProtocolResult> {
  try {
    const client = getEvmClient()

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

    let healthFactor: number | undefined
    if (accountResult.status === 'success') {
      const [, , , , , hf] = accountResult.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint]
      const hfNum = Number(formatUnits(hf, 18))
      if (hfNum < 1e15) healthFactor = hfNum
    }

    const positions: DeFiPosition[] = []

    for (let i = 0; i < MORE_MARKETS.assets.length; i++) {
      const asset = MORE_MARKETS.assets[i]
      const res = reserveResults[i]
      if (res.status !== 'success') continue

      const [aTokenBal, stableDebt, variableDebt] = res.result as readonly [bigint, bigint, bigint, ...bigint[]]
      const price = prices[asset.symbol] ?? 0

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
