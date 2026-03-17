import type { DeFiPosition, ProtocolResult } from './types'

export async function fetchIncrementFiPositions(
  flowAddress: string,
  flowPriceUsd: number,
): Promise<ProtocolResult> {
  try {
    const { cadenceService } = await import('../fclConfig')
    const positions: DeFiPosition[] = []

    const tokenRes = await cadenceService.getToken(flowAddress).catch(() => null)
    if (tokenRes?.tokens) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stFlowVault = tokenRes.tokens.find((t: any) =>
        t.contractName === 'stFlowToken' || t.symbol === 'stFlow'
      )
      if (stFlowVault && Number(stFlowVault.balance) > 0) {
        const balance = Number(stFlowVault.balance)
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
            valueUsd: null,
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
