import type { ProtocolResult } from '../types'
import { getEvmClient } from './client'
import { ANKR } from './contracts'
import { erc20Abi } from '../abis/erc20'
import { ankrRatioFeedAbi } from '../abis/ankrRatioFeed'
import { formatUnits } from 'viem'

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
          poolName: 'ankrFLOW \u2192 FLOW',
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
