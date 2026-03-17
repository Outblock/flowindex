// Blockscout API v2 response types

export interface BSAddress {
  hash: string;
  is_contract: boolean;
  is_verified: boolean | null;
  name: string | null;
  coin_balance: string | null;
  exchange_rate: string | null;
  block_number_balance_updated_at: number | null;
  transactions_count: number;
  token_transfers_count: number;
  has_custom_methods_read: boolean;
  has_custom_methods_write: boolean;
  flow_address?: string;
  is_coa?: boolean;
}

export interface BSTransaction {
  hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string; name?: string | null; is_contract: boolean };
  to: { hash: string; name?: string | null; is_contract: boolean } | null;
  value: string;
  gas_limit: string;
  gas_used: string;
  gas_price: string;
  status: string;
  result: string;
  nonce: number;
  type: number;
  method: string | null;
  raw_input: string;
  decoded_input: BSDecodedInput | null;
  token_transfers: BSTokenTransfer[] | null;
  fee: { type: string; value: string };
  tx_types: string[];
  confirmations: number;
  revert_reason: string | null;
  has_error_in_internal_txs: boolean;
}

export interface BSDecodedInput {
  method_call: string;
  method_id: string;
  parameters: BSDecodedParam[];
}

export interface BSDecodedParam {
  name: string;
  type: string;
  value: string;
}

export interface BSInternalTransaction {
  index: number;
  transaction_hash: string;
  block_number: number;
  timestamp: string;
  type: string;
  call_type: string | null;
  from: { hash: string; name?: string | null; is_contract: boolean };
  to: { hash: string; name?: string | null; is_contract: boolean } | null;
  value: string;
  gas_limit: string;
  gas_used: string;
  input: string;
  output: string;
  error: string | null;
  created_contract: { hash: string; name?: string | null } | null;
  success: boolean;
}

export interface BSTokenTransfer {
  block_hash: string;
  block_number: number;
  log_index: number;
  timestamp: string;
  from: { hash: string; name?: string | null; is_contract: boolean };
  to: { hash: string; name?: string | null; is_contract: boolean };
  token: BSToken;
  total: { value: string; decimals: string } | null;
  tx_hash?: string;
  transaction_hash?: string;
  type: string;
  method: string | null;
}

export interface BSToken {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  type: string;
  icon_url: string | null;
  exchange_rate: string | null;
}

export interface BSNFTInstance {
  id: number;
  is_unique: boolean;
  metadata: {
    name?: string;
    image?: string;
    image_url?: string;
    description?: string;
    attributes?: Array<{ trait_type: string; value: string }>;
    [key: string]: any;
  } | null;
}

export interface BSTokenBalance {
  token: BSToken;
  token_id: string | null;
  value: string;
  token_instance: BSNFTInstance | null;
}

export interface BSLog {
  index: number;
  address: { hash: string; name?: string | null; is_contract: boolean };
  data: string;
  topics: string[];
  decoded: BSDecodedLog | null;
  tx_hash: string;
  block_number: number;
}

export interface BSDecodedLog {
  method_call: string;
  method_id: string;
  parameters: BSDecodedParam[];
}

export interface BSSearchResult {
  items: BSSearchItem[];
  next_page_params: BSPageParams | null;
}

export interface BSSearchItem {
  type: string;
  name: string | null;
  address: string | null;
  address_hash?: string | null;
  url: string;
  symbol: string | null;
  token_type: string | null;
  is_smart_contract_verified: boolean | null;
  exchange_rate: string | null;
}

export interface BSPageParams {
  [key: string]: string | number;
}

export interface BSPaginatedResponse<T> {
  items: T[];
  next_page_params: BSPageParams | null;
}

// --- Search Preview Types ---

export interface CadenceTxPreview {
  id: string;
  status: string;
  block_height: number;
  timestamp: string;
  authorizers: string[];
  is_evm: boolean;
}

export interface EVMTxPreview {
  hash: string;
  status: string;
  from: string;
  to: string | null;
  value: string;
  method: string | null;
  block_number: number;
}

export interface TxLink {
  cadence_tx_id: string;
  evm_hash: string;
}

export interface CadenceAddressPreview {
  address: string;
  contracts_count: number;
  has_keys: boolean;
}

export interface EVMAddressPreview {
  address: string;
  balance: string;
  is_contract: boolean;
  is_verified: boolean;
  tx_count: number;
}

export interface COALink {
  flow_address: string;
  coa_address?: string;   // backend field name
  evm_address?: string;   // alias used in spec
}

export interface TxPreviewResponse {
  cadence: CadenceTxPreview | null;
  evm: EVMTxPreview | null;
  link: TxLink | null;
}

export interface AddressPreviewResponse {
  cadence: CadenceAddressPreview | null;
  evm: EVMAddressPreview | null;
  link: COALink | null;
  coa_link?: COALink | null; // backwards compat alias
}
