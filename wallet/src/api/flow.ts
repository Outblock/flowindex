import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// Types — minimal interfaces matching the FlowIndex backend responses.
// Defined locally so the wallet has no dependency on the frontend's generated
// API client.
// ---------------------------------------------------------------------------

/** Standard paginated API envelope */
export interface ApiResponse<T> {
  _links?: Record<string, string>;
  _meta?: Record<string, unknown>;
  data?: T;
  error?: unknown;
}

/** Token metadata embedded in transfer records */
export interface TokenInfo {
  logo?: string;
  name?: string;
  symbol?: string;
  token?: string;
}

/** Vault info from the combined account details endpoint */
export interface VaultInfo {
  balance?: number;
  identifier?: string;
  logo?: string;
  name?: string;
  path?: string;
  short_path?: string;
  symbol?: string;
  token?: string;
  tags?: string[];
  socials?: Record<string, string>;
}

/** Combined account details returned by GET /flow/account/{address} */
export interface AccountData {
  address?: string;
  flowBalance?: number;
  flowStorage?: number;
  storageAvailable?: number;
  storageUsed?: number;
  contracts?: string[];
  keys?: AccountKey[];
  vaults?: Record<string, VaultInfo>;
  accountInfo?: {
    delegatedBalance?: number;
    primaryAcctBalance?: number;
    primaryAddress?: string;
    secondaryAcctBalance?: number;
    secondaryAddress?: string;
    stakedBalance?: number;
  };
}

export interface AccountKey {
  hashAlgorithm?: string;
  index?: number;
  publicKey?: string;
  revoked?: boolean;
  signAlgorithm?: string;
  weight?: number;
}

/** FT holding for a specific token holder (from the /ft endpoint) */
export interface FtHolding {
  address?: string;
  balance?: string;
  path?: string;
  token?: string;
  vault_id?: number;
}

/** NFT collection owned by an account */
export interface NftCollection {
  id?: string;
  address?: string;
  contract_name?: string;
  name?: string;
  display_name?: string;
  description?: string;
  external_url?: string;
  square_image?: string;
  banner_image?: string;
  number_of_tokens?: number;
  holder_count?: number;
  transfer_count?: number;
  nft_type?: string;
  owner?: string;
  /** @deprecated use square_image */
  logo?: string;
  /** @deprecated use banner_image */
  banner?: string;
  /** @deprecated use number_of_tokens */
  nft_count?: number;
}

/** A single NFT item */
export interface NftItem {
  id?: string;
  nft_id?: string;
  nft_type?: string;
  name?: string;
  description?: string;
  thumbnail?: string;
  external_url?: string;
  serial_number?: number;
  edition_name?: string;
  edition_number?: number;
  edition_max?: number;
  rarity_score?: string;
  owner?: string;
  block_height?: number;
  timestamp?: string;
}

/** A single transaction in the account's history */
export interface AccountTransaction {
  id?: string;
  block_height?: number;
  timestamp?: string;
  status?: string;
  proposer?: string;
  payer?: string;
  authorizers?: string[];
  gas_used?: number;
  fee?: number;
  event_count?: number;
  error?: string;
  error_code?: string;
  roles?: string[];
  raw_roles?: string[];
  tags?: Array<{ label?: string; color?: string }>;
  contract_imports?: string[];
  contract_outputs?: string[];
  entitlements?: string[];
  transaction_body_hash?: string;
}

/** Paginated transaction response */
export interface TransactionPage {
  data: AccountTransaction[];
  hasMore: boolean;
}

/** FT transfer record */
export interface FtTransfer {
  transaction_hash?: string;
  block_height?: number;
  timestamp?: string;
  address?: string;
  sender?: string;
  receiver?: string;
  receiver_balance?: number;
  amount?: number;
  approx_usd_price?: number;
  direction?: string;
  classifier?: string;
  is_primary?: boolean;
  verified?: boolean;
  token?: TokenInfo;
}

/** Paginated FT transfer response */
export interface FtTransferPage {
  data: FtTransfer[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Fetch combined account details (balance, keys, vaults, contracts). */
export async function getAccount(address: string): Promise<AccountData> {
  const res = await apiFetch<ApiResponse<AccountData[]>>(`/flow/account/${address}`);
  const item = res.data?.[0];
  if (!item) throw new Error(`Account not found: ${address}`);
  return item;
}

/** Fetch FT holdings / vault balances for an account. */
export async function getAccountFtHoldings(address: string): Promise<FtHolding[]> {
  const res = await apiFetch<ApiResponse<FtHolding[]>>(`/flow/account/${address}/ft`);
  return res.data ?? [];
}

/** Fetch NFT collections owned by an account. */
export async function getNftCollections(address: string): Promise<NftCollection[]> {
  const res = await apiFetch<ApiResponse<NftCollection[]>>(`/flow/account/${address}/nft`);
  return res.data ?? [];
}

/** Fetch NFT items for a specific collection owned by an account. */
export async function getNftCollectionItems(
  address: string,
  nftType: string,
  params?: { limit?: number; offset?: number },
): Promise<NftItem[]> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch<ApiResponse<NftItem[]>>(
    `/flow/account/${address}/nft/${nftType}${query}`,
  );
  return res.data ?? [];
}

/** Fetch paginated transaction history for an account. */
export async function getAccountTransactions(
  address: string,
  params?: { limit?: number; offset?: number },
): Promise<TransactionPage> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  const limit = params?.limit ?? 25;

  const res = await apiFetch<ApiResponse<AccountTransaction[]>>(
    `/flow/account/${address}/transaction${query}`,
  );
  const data = res.data ?? [];
  return { data, hasMore: data.length >= limit };
}

/** Fetch current token prices from the backend status endpoint. */
export async function getTokenPrices(): Promise<Record<string, number>> {
  const res = await apiFetch<ApiResponse<Array<{ symbol: string; price: number }>>>(
    '/status/prices',
  );
  const prices: Record<string, number> = {};
  for (const item of res.data ?? []) {
    if (item.symbol && item.price != null) {
      prices[item.symbol] = item.price;
    }
  }
  return prices;
}

/** Fetch paginated FT transfers for an account. */
export async function getAccountFtTransfers(
  address: string,
  params?: { limit?: number; offset?: number },
): Promise<FtTransferPage> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  const limit = params?.limit ?? 25;

  const res = await apiFetch<ApiResponse<FtTransfer[]>>(
    `/flow/account/${address}/ft/transfer${query}`,
  );
  const data = res.data ?? [];
  return { data, hasMore: data.length >= limit };
}
