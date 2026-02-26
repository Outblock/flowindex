import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout'

export interface CardDef {
  key: string
  title: string
  defaultW: number
  /** tab categories this card belongs to */
  tabs: readonly string[]
  /** if set, card is only visible when this returns true */
  visibleKey?: string
}

export const CARD_DEFS: CardDef[] = [
  { key: 'daily-tx-count', title: 'Daily Transaction Count', defaultW: 2, tabs: ['transactions'] },
  { key: 'active-accounts', title: 'Active Accounts', defaultW: 1, tabs: ['network'] },
  { key: 'new-accounts', title: 'New Accounts', defaultW: 1, tabs: ['network'], visibleKey: 'showNewAccounts' },
  { key: 'evm-vs-cadence', title: 'EVM vs Cadence (%)', defaultW: 1, tabs: ['transactions'] },
  { key: 'flow-price', title: 'FLOW Price History', defaultW: 2, tabs: ['price'] },
  { key: 'defi-swaps', title: 'DeFi Swaps & Traders', defaultW: 2, tabs: ['tokens'], visibleKey: 'showDefiMetrics' },
  { key: 'epoch-payout', title: 'Epoch Payout', defaultW: 1, tabs: ['network'], visibleKey: 'showEpochPayout' },
  { key: 'bridge-evm', title: 'Bridge -> EVM Txs (Proxy)', defaultW: 1, tabs: ['transactions'], visibleKey: 'showBridgeMetrics' },
  { key: 'gas-burned', title: 'Gas Burned per Day', defaultW: 1, tabs: ['transactions'] },
  { key: 'avg-gas-tx', title: 'Avg Gas per Tx', defaultW: 1, tabs: ['transactions'] },
  { key: 'error-rate', title: 'Error Rate (%)', defaultW: 1, tabs: ['transactions'] },
  { key: 'ft-transfers', title: 'FT Transfers', defaultW: 1, tabs: ['tokens'] },
  { key: 'nft-transfers', title: 'NFT Transfers', defaultW: 1, tabs: ['tokens'] },
  { key: 'failed-txs', title: 'Failed Transactions', defaultW: 1, tabs: ['transactions'] },
  { key: 'total-staked', title: 'Total Staked per Epoch', defaultW: 2, tabs: ['network'] },
  { key: 'node-count', title: 'Node Count per Epoch', defaultW: 1, tabs: ['network'] },
  { key: 'contract-activity', title: 'Contract Activity', defaultW: 2, tabs: ['network'] },
]

/** Build a layout array for a given number of columns */
function buildLayout(cols: number, isStatic: boolean): LayoutItem[] {
  const layout: LayoutItem[] = []
  let x = 0
  let y = 0

  for (const card of CARD_DEFS) {
    const w = Math.min(card.defaultW, cols)
    // wrap to next row if doesn't fit
    if (x + w > cols) {
      x = 0
      y++
    }
    layout.push({
      i: card.key,
      x,
      y,
      w,
      h: 1,
      minW: 1,
      maxW: Math.min(3, cols),
      minH: 1,
      maxH: 2,
      static: isStatic,
    })
    x += w
    if (x >= cols) {
      x = 0
      y++
    }
  }

  return layout
}

export const DEFAULT_LAYOUTS: ResponsiveLayouts = {
  lg: buildLayout(3, false),
  md: buildLayout(2, false),
  sm: buildLayout(1, true),
}
