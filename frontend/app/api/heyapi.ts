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
      findClient.setConfig({ baseURL: _baseURL, throwOnError: true, timeout: 8000 });
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

/** Simple fetch for /status (base route, not in generated SDK) */
export async function fetchStatus(): Promise<any> {
  await ensureHeyApiConfigured();
  const res = await fetch(`${_baseURL}/status`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
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
export async function fetchNetworkStats(): Promise<any> {
  await ensureHeyApiConfigured();
  const [priceRes, epochRes, tokenomicsRes] = await Promise.allSettled([
    fetch(`${_baseURL}/status/price`).then(r => r.ok ? r.json() : null),
    fetch(`${_baseURL}/status/epoch/status`).then(r => r.ok ? r.json() : null),
    fetch(`${_baseURL}/status/tokenomics`).then(r => r.ok ? r.json() : null),
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
    total_staked: tokenomics?.total_staked ?? 0,
    active_nodes: tokenomics?.validator_count ?? tokenomics?.active_nodes ?? 0,
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
