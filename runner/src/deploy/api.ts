// ---------------------------------------------------------------------------
// FlowIndex API client — contract data + edge function address management
// ---------------------------------------------------------------------------

import { supabase } from '../auth/supabaseClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractInfo {
  address: string;
  name: string;
  code?: string;
  kind?: string; // FT, NFT, CONTRACT
  version: number;
  first_seen_height: number;
  last_seen_height: number;
  dependent_count: number;
  // Rich metadata from FlowIndex
  token_logo?: string;
  token_name?: string;
  token_symbol?: string;
  tags?: string[];
  is_verified?: boolean;
  import_count?: number;
}

export interface ContractVersion {
  version: number;
  block_height: number;
  created_at: string;
  transaction_id?: string;
}

export interface ContractEvent {
  type: string;
  event_name: string;
  count: number;
  last_seen?: string;
}

export interface ContractHolder {
  address: string;
  balance?: number;
  percentage?: number;
}

export interface NFTItem {
  id: string;
  serial_number?: number;
  name?: string;
  description?: string;
  image?: string;
  owner?: string;
}

export interface ContractDependency {
  address: string;
  name: string;
  identifier?: string;
}

export interface DependencyGraphNode {
  identifier: string;
  address: string;
  name: string;
  is_verified?: boolean;
  kind?: string;
  token_logo?: string;
  token_name?: string;
  token_symbol?: string;
}

export interface DependencyGraphEdge {
  source: string;
  target: string;
}

export interface DependencyGraph {
  root: string;
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
}

export interface DependencyData {
  imports: ContractDependency[];
  dependents: ContractDependency[];
  graph?: DependencyGraph;
}

export interface TokenMetadata {
  name: string;
  description?: string;
  logo?: string;
  banner?: string;
  external_url?: string;
  holder_count: number;
  total_supply?: number;
  socials?: Record<string, string>;
  is_verified?: boolean;
}

export interface ContractTransaction {
  id: string;
  timestamp: string;
  status: string;
  error: string;
  payer: string;
  proposer: string;
  authorizers: string[];
  event_count: number;
  fee: number;
  contract_imports: string[];
  gas_used: number;
  block_height: number;
}

export interface ContractScript {
  script_hash: string;
  tx_count: number;
  category: string;
  label: string;
  description: string;
  script_preview: string;
}

export type AddressSource = 'manual' | 'fcl' | 'local-key';

export interface VerifiedAddress {
  id: string;
  user_id: string;
  address: string;
  network: string;
  label: string | null;
  source: AddressSource;
  verified_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip 0x prefix and lowercase */
function normalizeAddress(address: string): string {
  return address.replace(/^0x/i, '').toLowerCase();
}

/** Normalize contract identifier — strip 0x from address part (A.0xABC.Name → A.ABC.Name) */
function normalizeIdentifier(identifier: string): string {
  return identifier.replace(/\.0x/i, '.');
}

/** Fetch with timeout to avoid hanging requests */
function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** FlowIndex API base URL by network */
function flowIndexBase(network: string): string {
  return network === 'testnet'
    ? 'https://testnet.flowindex.io/api'
    : 'https://flowindex.io/api';
}

/** Flow Access Node REST API base URL by network (fallback) */
function accessNodeBase(network: string): string {
  return network === 'testnet'
    ? 'https://rest-testnet.onflow.org'
    : 'https://rest-mainnet.onflow.org';
}

// ---------------------------------------------------------------------------
// Contract data — FlowIndex primary, Flow Access Node RPC fallback
// ---------------------------------------------------------------------------

function mapContract(c: Record<string, unknown>, fallbackAddr: string): ContractInfo {
  return {
    address: (c.address as string) || fallbackAddr,
    name: (c.name as string) || '',
    code: (c.body as string) || (c.code as string) || undefined,
    kind: (c.kind as string) || undefined,
    version: (c.version as number) || 1,
    first_seen_height: (c.first_seen_height as number) || (c.valid_from as number) || 0,
    last_seen_height: (c.last_seen_height as number) || 0,
    dependent_count: (c.dependent_count as number) || (c.import_count as number) || 0,
    token_logo: (c.token_logo as string) || undefined,
    token_name: (c.token_name as string) || undefined,
    token_symbol: (c.token_symbol as string) || undefined,
    tags: (c.tags as string[]) || undefined,
    is_verified: (c.is_verified as boolean) || undefined,
    import_count: (c.import_count as number) || 0,
  };
}

/** Fetch contracts from FlowIndex API */
async function fetchContractsFromFlowIndex(
  addr: string,
  network: string,
): Promise<ContractInfo[]> {
  const res = await fetchWithTimeout(
    `${flowIndexBase(network)}/flow/contract?address=${addr}&limit=100`,
  );
  if (!res.ok) throw new Error(`FlowIndex API error: ${res.status}`);
  const json = await res.json();
  const items = (json.data ?? json.contracts ?? json) as Array<Record<string, unknown>>;
  return items.map((c) => mapContract(c, addr));
}

/** Fetch contracts from Flow Access Node RPC (fallback) */
async function fetchContractsFromRPC(
  addr: string,
  network: string,
): Promise<ContractInfo[]> {
  const fullAddr = `0x${addr}`;
  const res = await fetch(
    `${accessNodeBase(network)}/v1/accounts/${fullAddr}?expand=contracts`,
  );
  if (!res.ok) throw new Error(`Flow RPC error: ${res.status}`);
  const json = await res.json();
  const contracts = json.contracts || {};
  return Object.entries(contracts).map(([name, codeBase64]) => ({
    address: addr,
    name,
    code: atob(codeBase64 as string),
    version: 1,
    first_seen_height: 0,
    last_seen_height: 0,
    dependent_count: 0,
  }));
}

/** Fetch all contracts — FlowIndex first, RPC fallback */
export async function fetchContracts(
  address: string,
  network: string,
): Promise<ContractInfo[]> {
  const addr = normalizeAddress(address);
  try {
    return await fetchContractsFromFlowIndex(addr, network);
  } catch {
    console.warn('[deploy/api] FlowIndex unavailable, falling back to RPC');
    return fetchContractsFromRPC(addr, network);
  }
}

/** Fetch contract detail — FlowIndex first, RPC fallback */
export async function fetchContractDetail(
  identifier: string,
  network: string,
): Promise<ContractInfo> {
  // Try FlowIndex first
  const id = normalizeIdentifier(identifier);
  try {
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${id}`,
    );
    if (res.ok) {
      const json = await res.json();
      const items = json.data;
      const c = (Array.isArray(items) ? items[0] : items ?? json) as Record<string, unknown>;
      return mapContract(c, '');
    }
  } catch { /* fall through */ }

  // Fallback: parse identifier (A.address.Name) and fetch from RPC
  const parts = identifier.split('.');
  const addr = normalizeAddress(parts[1] || identifier);
  const name = parts[2] || '';
  const contracts = await fetchContractsFromRPC(addr, network);
  const found = contracts.find((c) => c.name === name);
  if (!found) throw new Error(`Contract ${name} not found on ${addr}`);
  return found;
}

export async function fetchContractVersions(
  identifier: string,
  network: string,
): Promise<ContractVersion[]> {
  try {
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${id}/version`,
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? json.versions ?? json) as ContractVersion[];
  } catch {
    return [];
  }
}

/** Fetch source code for a specific contract version */
export async function fetchVersionCode(
  identifier: string,
  version: number,
  network: string,
): Promise<string> {
  try {
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${encodeURIComponent(id)}/version/${version}`,
    );
    if (!res.ok) return '';
    const json = await res.json();
    const items = json?.data;
    if (Array.isArray(items) && items.length > 0) {
      return items[0].code || '';
    }
    return '';
  } catch {
    return '';
  }
}

export async function fetchContractEvents(
  identifier: string,
  network: string,
): Promise<ContractEvent[]> {
  try {
    // This query can be slow — give it more time
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${id}/events`,
      15000,
    );
    if (!res.ok) return [];
    const json = await res.json();
    const items = (json.data ?? json.events ?? json) as Array<Record<string, unknown>>;
    return items.map((e) => ({
      type: (e.type as string) || '',
      event_name: (e.event_name as string) || '',
      count: (e.count as number) || 0,
      last_seen: (e.last_seen as string) || undefined,
    }));
  } catch {
    return [];
  }
}

/** Fetch holders for a token contract — endpoint is /holding (not /holder) */
export async function fetchTokenHolders(
  identifier: string,
  kind: string,
  network: string,
  limit = 25,
  offset = 0,
): Promise<{ holders: ContractHolder[]; hasMore: boolean }> {
  try {
    const id = normalizeIdentifier(identifier);
    const path = kind === 'FT'
      ? `/flow/ft/${id}/holding?limit=${limit}&offset=${offset}`
      : `/flow/nft/${id}/holding?limit=${limit}&offset=${offset}`;
    const res = await fetchWithTimeout(`${flowIndexBase(network)}${path}`);
    if (!res.ok) return { holders: [], hasMore: false };
    const json = await res.json();
    const items = (json.data ?? []) as Array<Record<string, unknown>>;
    const hasMore = json._meta?.has_more ?? items.length >= limit;
    const holders = items.map((h) => ({
      address: (h.owner as string) || (h.address as string) || '',
      balance: (h.count as number) || (h.balance as number) || 0,
      percentage: (h.percentage as number) || 0,
    }));
    return { holders, hasMore };
  } catch {
    return { holders: [], hasMore: false };
  }
}

/** Fetch NFT items for a collection */
export async function fetchNFTItems(
  identifier: string,
  network: string,
  limit = 20,
  offset = 0,
): Promise<{ items: NFTItem[]; hasMore: boolean }> {
  try {
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/nft/${id}/item?limit=${limit}&offset=${offset}`,
    );
    if (!res.ok) return { items: [], hasMore: false };
    const json = await res.json();
    const data = (json.data ?? []) as Array<Record<string, unknown>>;
    const hasMore = json._meta?.has_more ?? data.length >= limit;
    const items = data.map((n) => ({
      id: String(n.id ?? n.nft_id ?? ''),
      serial_number: (n.serial_number as number) || undefined,
      name: (n.name as string) || (n.edition_name as string) || undefined,
      description: (n.description as string) || undefined,
      image: (n.image as string) || (n.thumbnail as string) || undefined,
      owner: (n.current_owner as string) || (n.owner as string) || undefined,
    }));
    return { items, hasMore };
  } catch {
    return { items: [], hasMore: false };
  }
}

export async function fetchContractDependencies(
  identifier: string,
  network: string,
): Promise<DependencyData> {
  const empty: DependencyData = { imports: [], dependents: [] };
  try {
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${id}/dependencies?depth=3`,
    );
    if (!res.ok) return empty;
    const json = await res.json();
    // API returns { data: [{ imports: [...], dependents: [...], graph: {...} }] }
    const d = Array.isArray(json.data) ? json.data[0] : json.data ?? json;
    const imports = ((d?.imports ?? []) as Array<Record<string, unknown>>).map((i) => ({
      address: (i.address as string) || '',
      name: (i.name as string) || '',
      identifier: (i.identifier as string) || undefined,
    }));
    const dependents = ((d?.dependents ?? []) as Array<Record<string, unknown>>).map((i) => ({
      address: (i.address as string) || '',
      name: (i.name as string) || '',
      identifier: (i.identifier as string) || undefined,
    }));
    const graph = d?.graph as DependencyGraph | undefined;
    return { imports, dependents, graph };
  } catch {
    return empty;
  }
}

export async function fetchHolderCount(
  identifier: string,
  kind: string,
  network: string,
): Promise<number> {
  try {
    // Use the token metadata endpoint which has holder_count
    const id = normalizeIdentifier(identifier);
    const path = kind === 'FT' ? `/flow/ft/${id}` : `/flow/nft/${id}`;
    const res = await fetchWithTimeout(`${flowIndexBase(network)}${path}`);
    if (!res.ok) return 0;
    const json = await res.json();
    const d = Array.isArray(json.data) ? json.data[0] : json.data ?? json;
    return d?.holder_count ?? 0;
  } catch {
    return 0;
  }
}

/** Fetch NFT or FT token metadata (logo, banner, description, holders, socials) */
export async function fetchTokenMetadata(
  identifier: string,
  kind: string,
  network: string,
): Promise<TokenMetadata | null> {
  try {
    const id = normalizeIdentifier(identifier);
    const path = kind === 'FT' ? `/flow/ft/${id}` : `/flow/nft/${id}`;
    const res = await fetchWithTimeout(`${flowIndexBase(network)}${path}`);
    if (!res.ok) return null;
    const json = await res.json();
    const d = Array.isArray(json.data) ? json.data[0] : json.data ?? json;
    if (!d) return null;
    return {
      name: d.display_name || d.name || '',
      description: d.description || undefined,
      logo: d.square_image || d.logo || undefined,
      banner: d.banner_image || undefined,
      external_url: d.external_url || undefined,
      holder_count: d.holder_count || 0,
      total_supply: d.number_of_tokens || d.total_supply || undefined,
      socials: d.socials || undefined,
      is_verified: d.is_verified || false,
    };
  } catch {
    return null;
  }
}

/** Fetch recent transactions for a contract */
export async function fetchContractTransactions(
  identifier: string,
  network: string,
  limit = 10,
): Promise<ContractTransaction[]> {
  try {
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${id}/transaction?limit=${limit}`,
    );
    if (!res.ok) return [];
    const json = await res.json();
    const items = (json.data ?? []) as Array<Record<string, unknown>>;
    return items.map((t) => ({
      id: (t.id as string) || '',
      timestamp: (t.timestamp as string) || '',
      status: (t.status as string) || '',
      error: (t.error as string) || '',
      payer: (t.payer as string) || '',
      proposer: (t.proposer as string) || '',
      authorizers: (t.authorizers as string[]) || [],
      event_count: (t.event_count as number) || 0,
      fee: (t.fee as number) || 0,
      contract_imports: (t.contract_imports as string[]) || [],
      gas_used: (t.gas_used as number) || 0,
      block_height: (t.block_height as number) || 0,
    }));
  } catch {
    return [];
  }
}

export async function fetchContractScripts(
  identifier: string,
  network: string,
  limit = 20,
  offset = 0,
): Promise<{ scripts: ContractScript[]; hasMore: boolean }> {
  try {
    const id = normalizeIdentifier(identifier);
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/contract/${id}/scripts?limit=${limit}&offset=${offset}`,
    );
    if (!res.ok) return { scripts: [], hasMore: false };
    const json = await res.json();
    const items = (json.data ?? []) as ContractScript[];
    return { scripts: items, hasMore: items.length >= limit };
  } catch {
    return { scripts: [], hasMore: false };
  }
}

export async function fetchScriptText(
  scriptHash: string,
  network: string,
): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `${flowIndexBase(network)}/flow/script/${encodeURIComponent(scriptHash)}`,
    );
    if (!res.ok) return '';
    const json = await res.json();
    const items = json.data;
    if (Array.isArray(items) && items.length > 0) {
      return items[0].script_text || '';
    }
    return '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Edge function calls — verified address management (auth required)
// ---------------------------------------------------------------------------

async function callEdgeFunction<T = unknown>(
  token: string,
  endpoint: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: result, error } = await supabase.functions.invoke(
    'runner-projects',
    {
      body: { endpoint, data },
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (error) throw new Error(error.message || 'Edge function error');
  if (!result.success)
    throw new Error(result.error?.message || 'Unknown error');
  return result.data as T;
}

export async function listAddresses(
  token: string,
): Promise<VerifiedAddress[]> {
  const result = await callEdgeFunction<{ addresses: VerifiedAddress[] }>(
    token,
    '/addresses/list',
  );
  return result.addresses;
}

export async function addAddress(
  token: string,
  address: string,
  network: string,
  source: AddressSource,
  label?: string,
): Promise<VerifiedAddress> {
  const addr = normalizeAddress(address);
  const result = await callEdgeFunction<{ address: VerifiedAddress }>(
    token,
    '/addresses/add',
    { address: addr, network, source, label },
  );
  return result.address;
}

export async function deleteAddress(
  token: string,
  id: string,
): Promise<void> {
  await callEdgeFunction(token, '/addresses/delete', { id });
}
