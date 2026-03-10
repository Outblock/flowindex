/** Raw event from simulation or backend API */
export interface RawEvent {
  type: string;
  payload: any;
  event_index?: number;
  contract_address?: string;
  block_height?: number;
}

export type TransferType = 'transfer' | 'mint' | 'burn';

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

export interface DecodedEvents {
  transfers: FTTransfer[];
  nftTransfers: NFTTransfer[];
  evmExecutions: EVMExecution[];
  defiEvents: DefiEvent[];
  stakingEvents: StakingEvent[];
  systemEvents: SystemEvent[];
  fee: number;
  tags: string[];
  contractImports: string[];
}
