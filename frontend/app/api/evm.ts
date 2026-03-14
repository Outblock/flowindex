import { resolveApiBaseUrl } from '../api';
import type {
  BSAddress,
  BSTransaction,
  BSInternalTransaction,
  BSTokenTransfer,
  BSTokenBalance,
  BSLog,
  BSSearchResult,
  BSPageParams,
  BSPaginatedResponse,
  TxPreviewResponse,
  AddressPreviewResponse,
} from '@/types/blockscout';

async function evmFetch<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const baseUrl = await resolveApiBaseUrl();
  const url = new URL(`${baseUrl}/flow/evm${path}`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`EVM API error: ${res.status}`);
  return res.json();
}

function pageParamsToRecord(params?: BSPageParams): Record<string, string> | undefined {
  if (!params) return undefined;
  const record: Record<string, string> = {};
  Object.entries(params).forEach(([k, v]) => { record[k] = String(v); });
  return record;
}

// --- Address endpoints ---

export async function getEVMAddress(address: string, signal?: AbortSignal): Promise<BSAddress> {
  return evmFetch<BSAddress>(`/address/${address}`, undefined, signal);
}

export async function getEVMAddressTransactions(
  address: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSTransaction>> {
  return evmFetch(`/address/${address}/transactions`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMAddressInternalTxs(
  address: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSInternalTransaction>> {
  return evmFetch(`/address/${address}/internal-transactions`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMAddressTokenTransfers(
  address: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSTokenTransfer>> {
  return evmFetch(`/address/${address}/token-transfers`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMAddressTokenBalances(
  address: string, signal?: AbortSignal
): Promise<BSTokenBalance[]> {
  const res = await evmFetch<BSTokenBalance[] | BSPaginatedResponse<BSTokenBalance>>(`/address/${address}/token`, undefined, signal);
  // Blockscout may return { items: [...] } or plain array
  return Array.isArray(res) ? res : (res as BSPaginatedResponse<BSTokenBalance>).items ?? [];
}

// --- Transaction endpoints ---

export async function getEVMTransaction(hash: string, signal?: AbortSignal): Promise<BSTransaction> {
  return evmFetch<BSTransaction>(`/transaction/${hash}`, undefined, signal);
}

export async function getEVMTransactionInternalTxs(
  hash: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSInternalTransaction>> {
  return evmFetch(`/transaction/${hash}/internal-transactions`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMTransactionLogs(
  hash: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSLog>> {
  return evmFetch(`/transaction/${hash}/logs`, pageParamsToRecord(pageParams), signal);
}

export async function getEVMTransactionTokenTransfers(
  hash: string, pageParams?: BSPageParams, signal?: AbortSignal
): Promise<BSPaginatedResponse<BSTokenTransfer>> {
  return evmFetch(`/transaction/${hash}/token-transfers`, pageParamsToRecord(pageParams), signal);
}

// --- Search ---

export async function searchEVM(query: string, signal?: AbortSignal): Promise<BSSearchResult> {
  return evmFetch<BSSearchResult>(`/search`, { q: query }, signal);
}

// --- Search Preview ---

export async function fetchSearchPreview(
  query: string,
  type: 'tx' | 'address',
  signal?: AbortSignal
): Promise<TxPreviewResponse | AddressPreviewResponse> {
  const baseUrl = await resolveApiBaseUrl();
  const params = new URLSearchParams({ q: query, type });
  const res = await fetch(`${baseUrl}/flow/search/preview?${params}`, { signal });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}
