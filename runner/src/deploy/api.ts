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
}

export interface ContractVersion {
  version: number;
  block_height: number;
  created_at: string;
}

export interface ContractEvent {
  type: string;
  name: string;
}

export interface ContractDependency {
  address: string;
  name: string;
}

export interface VerifiedAddress {
  id: string;
  user_id: string;
  address: string;
  network: string;
  label: string | null;
  verified_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip 0x prefix and lowercase */
function normalizeAddress(address: string): string {
  return address.replace(/^0x/i, '').toLowerCase();
}

/** Base URL for the FlowIndex public API by network */
function apiBase(network: string): string {
  if (network === 'testnet') return 'https://testnet.flowindex.io';
  return 'https://flowindex.io';
}

// ---------------------------------------------------------------------------
// FlowIndex public API — contract data (no auth)
// ---------------------------------------------------------------------------

export async function fetchContracts(
  address: string,
  network: string,
): Promise<ContractInfo[]> {
  const addr = normalizeAddress(address);
  const res = await fetch(
    `${apiBase(network)}/flow/v1/contract?address=${addr}&limit=100`,
  );
  if (!res.ok) throw new Error(`Failed to fetch contracts: ${res.status}`);
  const json = await res.json();
  return (json.data ?? json.contracts ?? json) as ContractInfo[];
}

export async function fetchContractDetail(
  identifier: string,
  network: string,
): Promise<ContractInfo> {
  const res = await fetch(
    `${apiBase(network)}/flow/v1/contract/${identifier}`,
  );
  if (!res.ok)
    throw new Error(`Failed to fetch contract detail: ${res.status}`);
  const json = await res.json();
  return (json.data ?? json) as ContractInfo;
}

export async function fetchContractVersions(
  identifier: string,
  network: string,
): Promise<ContractVersion[]> {
  const res = await fetch(
    `${apiBase(network)}/flow/v1/contract/${identifier}/version`,
  );
  if (!res.ok)
    throw new Error(`Failed to fetch contract versions: ${res.status}`);
  const json = await res.json();
  return (json.data ?? json.versions ?? json) as ContractVersion[];
}

export async function fetchContractEvents(
  identifier: string,
  network: string,
): Promise<ContractEvent[]> {
  const res = await fetch(
    `${apiBase(network)}/flow/v1/contract/${identifier}/events`,
  );
  if (!res.ok)
    throw new Error(`Failed to fetch contract events: ${res.status}`);
  const json = await res.json();
  return (json.data ?? json.events ?? json) as ContractEvent[];
}

export async function fetchContractDependencies(
  identifier: string,
  network: string,
): Promise<ContractDependency[]> {
  const res = await fetch(
    `${apiBase(network)}/flow/v1/contract/${identifier}/dependencies`,
  );
  if (!res.ok)
    throw new Error(`Failed to fetch contract dependencies: ${res.status}`);
  const json = await res.json();
  return (json.data ?? json.dependencies ?? json) as ContractDependency[];
}

export async function fetchHolderCount(
  identifier: string,
  kind: string,
  network: string,
): Promise<number> {
  try {
    const path =
      kind === 'FT'
        ? `/flow/v1/ft/${identifier}/top-account?limit=1`
        : `/flow/v1/nft/${identifier}/top-account?limit=1`;
    const res = await fetch(`${apiBase(network)}${path}`);
    if (!res.ok) return 0;
    const json = await res.json();
    return json.total ?? json.count ?? 0;
  } catch {
    return 0;
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

export async function verifyAddress(
  token: string,
  address: string,
  network: string,
  message: string,
  signatures: unknown[],
  label?: string,
): Promise<VerifiedAddress> {
  const addr = normalizeAddress(address);
  const result = await callEdgeFunction<{ address: VerifiedAddress }>(
    token,
    '/addresses/verify',
    { address: addr, network, message, signatures, label },
  );
  return result.address;
}

export async function deleteAddress(
  token: string,
  id: string,
): Promise<void> {
  await callEdgeFunction(token, '/addresses/delete', { id });
}
