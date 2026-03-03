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

/** Parameters for get_nft tool */
export interface FlowGetNftParams {
  nftType: string
  nftId: string
}

/** Parameters for resolve_name tool */
export interface FlowResolveNameParams {
  name: string
}

/** Parameters for get_ft_holdings tool */
export interface FlowGetFtHoldingsParams {
  address: string
}

/** Parameters for get_nft_inventory tool */
export interface FlowGetNftInventoryParams {
  address: string
}

/** Parameters for get_contract_code tool */
export interface FlowGetContractCodeParams {
  address: string
  contractName: string
}

/** Parameters for get_staking_info tool */
export interface FlowGetStakingInfoParams {
  address: string
}

/** Parameters for get_defi_positions tool */
export interface FlowGetDefiPositionsParams {
  address: string
}

/** Parameters for get_collection_metadata tool */
export interface FlowGetCollectionMetadataParams {
  nftType: string
}

/** Parameters for format_address tool */
export interface FlowFormatAddressParams {
  address: string
  format?: 'with_prefix' | 'without_prefix' | 'padded'
}

/** Parameters for decode_event tool */
export interface FlowDecodeEventParams {
  eventData: string
}

/** Parameters for encode_arguments tool */
export interface FlowEncodeArgumentsParams {
  arguments: string
  types: string
}

/** Parameters for nft_catalog_lookup tool */
export interface FlowNftCatalogLookupParams {
  collectionIdentifier: string
}

/** Parameters for token_list_lookup tool */
export interface FlowTokenListLookupParams {
  symbol?: string
  address?: string
}

/** Parameters for increment_fi tool */
export interface FlowIncrementFiParams {
  tokenIn: string
  tokenOut: string
  amountIn: string
}

/** Parameters for flowindex_api tool */
export interface FlowFlowIndexApiParams {
  endpoint: string
  method?: 'GET' | 'POST'
  body?: string
}

/** Parameters for find_profile tool */
export interface FlowFindProfileParams {
  name: string
}

/** Parameters for transfer_flow tool */
export interface FlowTransferFlowParams {
  recipient: string
  amount: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for transfer_ft tool */
export interface FlowTransferFtParams {
  recipient: string
  amount: string
  vaultPath: string
  receiverPath: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for transfer_nft tool */
export interface FlowTransferNftParams {
  recipient: string
  nftId: string
  collectionStoragePath: string
  collectionPublicPath: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for stake tool */
export interface FlowStakeParams {
  amount: string
  nodeId?: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for unstake tool */
export interface FlowUnstakeParams {
  amount: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for withdraw_rewards tool */
export interface FlowWithdrawRewardsParams {
  amount: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for evm_call tool */
export interface FlowEvmCallParams {
  to: string
  data: string
  value?: string
  network?: string
}

/** Parameters for evm_send tool */
export interface FlowEvmSendParams {
  to: string
  data?: string
  value?: string
  gasLimit?: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for create_account tool */
export interface FlowCreateAccountParams {
  publicKey: string
  sigAlgo?: string
  hashAlgo?: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for add_key tool */
export interface FlowAddKeyParams {
  publicKey: string
  sigAlgo?: string
  hashAlgo?: string
  weight?: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for remove_key tool */
export interface FlowRemoveKeyParams {
  keyIndex: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for batch_transfer tool */
export interface FlowBatchTransferParams {
  recipients: string
  signerAddress: string
  signerPrivateKey: string
  network?: string
}

/** Parameters for multi_sign tool */
export interface FlowMultiSignParams {
  script: string
  arguments?: string
  signers: string
  network?: string
}
