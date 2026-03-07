/**
 * Type definitions for transaction display components.
 * Extracted from frontend TransactionRow.tsx for reuse across apps.
 */

export interface FTSummaryItem {
  token: string
  amount: string
  direction: string
  counterparty?: string
  symbol?: string
  name?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logo?: any
}

export interface NFTSummaryItem {
  collection: string
  count: number
  direction: string
  counterparty?: string
  name?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logo?: any
}

export interface TransferSummary {
  ft: FTSummaryItem[]
  nft: NFTSummaryItem[]
}

export interface TokenMetaEntry {
  name: string
  symbol: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logo: any
  type: "ft" | "nft"
  banner_image?: string | null
}

export interface ActivityBadge {
  type: string
  label: string
  color: string
  bgColor: string
}

export interface TransferPreviewItem {
  type: "ft" | "nft"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any
  label: string
  amount?: string
  symbol?: string
  count?: number
}
