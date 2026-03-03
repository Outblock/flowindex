/** Generic wrapper for FlowIndex API responses */
export interface FlowApiResponse<T = unknown> {
  data: T
  _meta?: { count?: number; limit?: number; offset?: number }
  error?: string | null
}

/** Flow account information */
export interface FlowAccountInfo {
  address: string
  balance: string
  keys: Array<{
    index: number
    publicKey: string
    signAlgo: string
    hashAlgo: string
    weight: number
    revoked: boolean
  }>
  contracts: string[]
}

/** Flow block metadata */
export interface FlowBlock {
  height: number
  id: string
  parentId: string
  timestamp: string
  transactionCount: number
}

/** Flow transaction metadata */
export interface FlowTransaction {
  id: string
  blockHeight: number
  status: string
  proposer: string
  payer: string
  authorizers: string[]
  gasLimit: number
  isEvm: boolean
}

/** Fungible token transfer record */
export interface FlowFtTransfer {
  transactionId: string
  blockHeight: number
  from: string
  to: string
  amount: string
  token: string
  timestamp: string
}

/** Non-fungible token transfer record */
export interface FlowNftTransfer {
  transactionId: string
  blockHeight: number
  from: string
  to: string
  nftId: string
  nftType: string
  timestamp: string
}

/** Flow event log entry */
export interface FlowEvent {
  type: string
  transactionId: string
  blockHeight: number
  data: Record<string, unknown>
}

/** Common query parameters for paginated endpoints */
export interface FlowQueryParams {
  address?: string
  limit?: number
  offset?: number
}

/** Parameters for get_account tool */
export interface FlowGetAccountParams {
  address: string
}

/** Parameters for get_balance tool */
export interface FlowGetBalanceParams {
  address: string
  token?: string
}

/** Parameters for get_block tool */
export interface FlowGetBlockParams {
  height?: string
  id?: string
}

/** Parameters for get_transaction tool */
export interface FlowGetTransactionParams {
  id: string
}

/** Parameters for get_events tool */
export interface FlowGetEventsParams {
  eventType: string
  startHeight?: string
  endHeight?: string
  limit?: string
}

/** Parameters for execute_script tool */
export interface FlowExecuteScriptParams {
  script: string
  arguments?: string
  network?: string
}

/** Parameters for send_transaction tool */
export interface FlowSendTransactionParams {
  script: string
  arguments?: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}
