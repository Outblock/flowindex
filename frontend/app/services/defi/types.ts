export type ProtocolId = 'incrementfi' | 'ankr' | 'kittypunch' | 'more-markets' | 'flowswap'
export type PositionType = 'lp' | 'lending' | 'borrowing' | 'liquid-staking' | 'farming'

export interface DeFiAsset {
  symbol: string
  amount: string
  amountDisplay: number
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

export const PROTOCOL_META: Record<ProtocolId, { name: string; type: string; environment: 'cadence' | 'evm' }> = {
  'incrementfi':  { name: 'IncrementFi',  type: 'DEX / Lending / Staking', environment: 'cadence' },
  'ankr':         { name: 'Ankr',         type: 'Liquid Staking',          environment: 'evm' },
  'more-markets': { name: 'MORE Markets', type: 'Lending / Borrowing',     environment: 'evm' },
  'kittypunch':   { name: 'KittyPunch',   type: 'DEX',                     environment: 'evm' },
  'flowswap':     { name: 'FlowSwap',     type: 'DEX',                     environment: 'evm' },
}
