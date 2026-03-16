/** Raw event from simulation or backend API */
export interface RawEvent {
  type: string;
  payload: any;
  event_index?: number;
  contract_address?: string;
  block_height?: number;
}

export type TransferType = 'transfer' | 'mint' | 'burn' | 'stake' | 'unstake';

export interface FTTransfer {
  token: string;
  from_address: string;
  to_address: string;
  amount: string;
  event_index: number;
  transfer_type: TransferType;
  evm_to_address?: string;
  evm_from_address?: string;
}

export interface NFTTransfer {
  token: string;
  from_address: string;
  to_address: string;
  token_id: string;
  event_index: number;
  transfer_type: TransferType;
}

export interface EVMExecution {
  hash: string;
  from: string;
  to: string;
  gas_used: string;
  gas_limit: string;
  gas_price: string;
  value: string;
  status: string;
  event_index: number;
  block_number?: number;
  type?: number;
  nonce?: number;
  position?: number;
  data?: string;
}

export interface DefiEvent {
  dex: string;
  action: string;
  pairId: string;
  amountIn: string;
  amountOut: string;
  tokenIn?: string;
  tokenOut?: string;
  event_index: number;
}

export interface StakingEvent {
  action: string;
  nodeId: string;
  delegatorId?: number;
  amount: string;
  event_index: number;
}

export interface SystemEvent {
  category: 'account' | 'key' | 'contract' | 'capability' | 'inbox';
  action: string;
  address: string;
  detail: string;
  event_index: number;
  contractName?: string;
  keyIndex?: number;
  path?: string;
  capabilityType?: string;
}

export interface DecodedSummaryItem {
  icon: 'transfer' | 'swap' | 'stake' | 'account' | 'contract' | 'capability' | 'nft' | 'evm';
  text: string;
}

export interface DecodedEVMCall {
  recipient: string;  // 40 hex chars, no 0x
  tokenID: string;    // decimal string, empty for FT
  callType: string;   // "erc20_transfer", "erc20_transferFrom", etc.
}

/** Decoded EVM log-level token transfer (ERC-20/721/1155 Transfer events) */
export interface EVMLogTransfer {
  /** Contract address that emitted the event (0x-prefixed) */
  contractAddress: string;
  /** 'erc20' | 'erc721' | 'erc1155' */
  standard: 'erc20' | 'erc721' | 'erc1155';
  from: string;    // 0x-prefixed
  to: string;      // 0x-prefixed
  /** Decimal string. For ERC-20: token amount in base units. For ERC-721: always "1". For ERC-1155: transfer amount. */
  amount: string;
  /** Token ID (decimal string). Empty for ERC-20. */
  tokenId: string;
  /** Index of the parent EVM.TransactionExecuted event */
  event_index: number;
  /** Index of this log within the EVM tx logs */
  log_index: number;
}

export interface DecodedEvents {
  transfers: FTTransfer[];
  nftTransfers: NFTTransfer[];
  evmExecutions: EVMExecution[];
  evmLogTransfers: EVMLogTransfer[];
  defiEvents: DefiEvent[];
  stakingEvents: StakingEvent[];
  systemEvents: SystemEvent[];
  fee: number;
  tags: string[];
  contractImports: string[];
}
