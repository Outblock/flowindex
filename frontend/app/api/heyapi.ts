import { resolveApiBaseUrl } from '../api';

import { client as findClient } from './gen/find/client.gen';

let configured = false;
let configuring: Promise<void> | null = null;
let _baseURL = '';

/**
 * The OpenAPI SDK generates paths with /v1/ segments (e.g. /flow/v1/block)
 * but the backend routes have no /v1/ (e.g. /flow/block).
 * In production Nginx strips this; in local dev we strip via Axios interceptor.
 */
const V1_RE = /\/(flow|accounting|status|defi|staking)\/v1\//;

export async function ensureHeyApiConfigured() {
  if (configured) return;
  if (!configuring) {
    configuring = (async () => {
      _baseURL = await resolveApiBaseUrl();
      findClient.setConfig({ baseURL: _baseURL, throwOnError: true, timeout: 30000 });
      // Install interceptor on the SDK's own Axios instance to strip /v1/ from paths
      findClient.instance.interceptors.request.use((config) => {
        if (config.url) {
          config.url = config.url.replace(V1_RE, '/$1/');
        }
        return config;
      });
      configured = true;
    })().finally(() => {
      configuring = null;
    });
  }
  await configuring;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Return the resolved base URL (e.g. for ad-hoc fetch calls outside the SDK) */
export function getBaseURL(): string { return _baseURL; }

/** Simple fetch for /status (base route, not in generated SDK) */
export async function fetchStatus(opts?: { includeRanges?: boolean; timeoutMs?: number }): Promise<any> {
  await ensureHeyApiConfigured();
  const includeRanges = opts?.includeRanges === true;
  const qs = includeRanges ? '?include_ranges=1' : '';
  return fetchJsonWithTimeout(`${_baseURL}/status${qs}`, opts?.timeoutMs ?? 4500);
}

/** Fetch Flow price from CoinGecko as fallback when backend has no data */
async function fetchPriceFromCoinGecko(): Promise<{ price: number; price_change_24h: number; market_cap: number } | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=flow&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
    if (!res.ok) return null;
    const data = await res.json();
    const flow = data?.flow;
    if (!flow) return null;
    return {
      price: flow.usd ?? 0,
      price_change_24h: flow.usd_24h_change ?? 0,
      market_cap: flow.usd_market_cap ?? 0,
    };
  } catch { return null; }
}

/** Fetch network stats: price, epoch, tokenomics (combined) */
export async function fetchNetworkStats(opts?: { timeoutMs?: number }): Promise<any> {
  await ensureHeyApiConfigured();
  const timeoutMs = opts?.timeoutMs ?? 6000;
  const [priceRes, epochRes, tokenomicsRes] = await Promise.allSettled([
    fetchJsonWithTimeout(`${_baseURL}/status/price`, timeoutMs).catch(() => null),
    fetchJsonWithTimeout(`${_baseURL}/status/epoch/status`, timeoutMs).catch(() => null),
    fetchJsonWithTimeout(`${_baseURL}/status/tokenomics`, timeoutMs).catch(() => null),
  ]);
  let price = priceRes.status === 'fulfilled' ? priceRes.value?.data?.[0] : null;
  const epoch = epochRes.status === 'fulfilled' ? epochRes.value?.data?.[0] : null;
  const tokenomics = tokenomicsRes.status === 'fulfilled' ? tokenomicsRes.value?.data?.[0] : null;

  // Fallback: fetch price from CoinGecko if backend has no data
  if (!price) {
    price = await fetchPriceFromCoinGecko();
  }

  if (!price && !epoch && !tokenomics) return null;
  return {
    price: price?.price ?? 0,
    price_change_24h: price?.price_change_24h ?? 0,
    market_cap: price?.market_cap ?? 0,
    epoch: epoch?.epoch ?? epoch?.current_epoch ?? null,
    epoch_progress: epoch?.epoch_progress ?? epoch?.progress ?? 0,
    updated_at: epoch?.updated_at ?? epoch?.as_of ?? null,
    start_view: epoch?.start_view ?? null,
    end_view: epoch?.end_view ?? null,
    current_view: epoch?.current_view ?? null,
    phase: epoch?.phase ?? null,
    total_staked: tokenomics?.total_staked ?? 0,
    total_supply: tokenomics?.total_supply ?? 0,
    active_nodes: tokenomics?.validator_count ?? tokenomics?.active_nodes ?? 0,
    staking_apy: tokenomics?.staking_apy ?? null,
  };
}

/** Fetch node list from /status/nodes */
export async function fetchNodeList(): Promise<any[]> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/status/nodes?limit=2000`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}

/** Fetch GCP VM status (proxied via backend /status/gcp-vms) */
export async function fetchGcpVmStatus(): Promise<any> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/status/gcp-vms`);
  if (!res.ok) return null;
  return res.json();
}

/** Storage API helpers (returns raw Cadence JSON-CDC) */
export async function fetchAccountStorage(address: string): Promise<any> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/flow/account/${address}/storage`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function fetchAccountStorageLinks(address: string, domain = 'public'): Promise<any> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/flow/account/${address}/storage/links?domain=${domain}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function fetchAccountStorageItem(address: string, path: string): Promise<any> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/flow/account/${address}/storage/item?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/** Fetch analytics daily stats (enriched with error rates, EVM split) */
export async function fetchAnalyticsDaily(from?: string, to?: string): Promise<any[]> {
  await ensureHeyApiConfigured();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${_baseURL}/insights/daily${qs}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}

/** Fetch one analytics daily module: accounts|evm|defi|epoch|bridge */
export async function fetchAnalyticsDailyModule(module: string, from?: string, to?: string, timeoutMs = 5000): Promise<any[]> {
  await ensureHeyApiConfigured();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  try {
    const json = await fetchJsonWithTimeout(`${_baseURL}/insights/daily/module/${encodeURIComponent(module)}${qs}`, timeoutMs);
    return json?.data ?? [];
  } catch {
    return [];
  }
}

/** Fetch daily FT/NFT transfer counts */
export async function fetchAnalyticsTransfersDaily(from?: string, to?: string): Promise<any[]> {
  await ensureHeyApiConfigured();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${_baseURL}/insights/transfers/daily${qs}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}

export interface BigTransfer {
  tx_id: string;
  block_height: number;
  timestamp: string;
  type: 'mint' | 'burn' | 'transfer' | 'swap' | 'bridge';
  token_symbol: string;
  token_contract_address: string;
  contract_name: string;
  token_logo?: string;
  amount: string;
  usd_value: number;
  from_address: string;
  to_address: string;
}

export interface TopContract {
  contract_identifier: string
  contract_name: string
  address: string
  tx_count: number
  unique_callers: number
}

export async function fetchTopContracts(opts: { hours?: number; limit?: number } = {}): Promise<TopContract[]> {
  await ensureHeyApiConfigured()
  const params = new URLSearchParams()
  if (opts.hours) params.set('hours', String(opts.hours))
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const json = await fetchJsonWithTimeout(`${_baseURL}/insights/top-contracts${qs}`)
    return json?.data ?? []
  } catch {
    return []
  }
}

export interface TokenVolume {
  symbol: string
  contract_name: string
  logo?: string
  transfer_count: number
  total_amount: string
  usd_volume: number
}

export async function fetchTokenVolume(opts: { hours?: number; limit?: number } = {}): Promise<TokenVolume[]> {
  await ensureHeyApiConfigured()
  const params = new URLSearchParams()
  if (opts.hours) params.set('hours', String(opts.hours))
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const json = await fetchJsonWithTimeout(`${_baseURL}/insights/token-volume${qs}`)
    return json?.data ?? []
  } catch {
    return []
  }
}

export async function fetchBigTransfers(
  opts: { limit?: number; offset?: number; minUsd?: number; type?: string; timeoutMs?: number } = {}
): Promise<BigTransfer[]> {
  await ensureHeyApiConfigured();
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.minUsd) params.set('min_usd', String(opts.minUsd));
  if (opts.type) params.set('type', opts.type);
  const qs = params.toString() ? `?${params.toString()}` : '';
  try {
    const json = await fetchJsonWithTimeout(`${_baseURL}/insights/big-transfers${qs}`, opts.timeoutMs ?? 10000);
    return json?.data ?? [];
  } catch {
    return [];
  }
}
