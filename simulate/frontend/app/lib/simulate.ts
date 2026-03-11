import type { FTTransfer, NFTTransfer, EVMExecution, EVMLogTransfer, SystemEvent, DefiEvent, StakingEvent, DecodedSummaryItem } from '@flowindex/event-decoder'

export interface SimulateRequest {
  cadence: string
  arguments: Array<Record<string, unknown>>
  authorizers: string[]
  payer: string
}

export interface BalanceChange {
  address: string
  token: string
  before?: string
  after?: string
  delta: string
}

export interface SimulateResponse {
  success: boolean
  error?: string | null
  computationUsed: number
  balanceChanges: BalanceChange[]
  // Decoded fields from event-decoder
  summary: string
  summaryItems: DecodedSummaryItem[]
  transfers: FTTransfer[]
  nftTransfers: NFTTransfer[]
  evmExecutions: EVMExecution[]
  evmLogTransfers: EVMLogTransfer[]
  systemEvents: SystemEvent[]
  defiEvents: DefiEvent[]
  stakingEvents: StakingEvent[]
  fee: number
  tags: string[]
  // Raw events
  events: Array<{ type: string; payload: unknown }>
}

export async function simulateTransaction(req: SimulateRequest): Promise<SimulateResponse> {
  const resp = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!resp.ok) {
    const text = await resp.text()
    return {
      success: false,
      error: `Simulation service error: ${resp.status} ${text}`,
      events: [],
      balanceChanges: [],
      computationUsed: 0,
      summary: '',
      summaryItems: [],
      transfers: [],
      nftTransfers: [],
      evmExecutions: [],
      evmLogTransfers: [],
      systemEvents: [],
      defiEvents: [],
      stakingEvents: [],
      fee: 0,
      tags: [],
    }
  }

  return await resp.json()
}
