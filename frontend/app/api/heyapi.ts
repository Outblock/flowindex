import { resolveApiBaseUrl } from '../api';

import { client as findClient } from './gen/find/client.gen';

let configured = false;
let configuring: Promise<void> | null = null;
let _baseURL = '';

export async function ensureHeyApiConfigured() {
  if (configured) return;
  if (!configuring) {
    configuring = (async () => {
      _baseURL = await resolveApiBaseUrl();
      findClient.setConfig({ baseURL: _baseURL, throwOnError: true, timeout: 8000 });
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

/** Fetch network stats: price, epoch, tokenomics (combined) */
export async function fetchNetworkStats(): Promise<any> {
  await ensureHeyApiConfigured();
  const [priceRes, epochRes, tokenomicsRes] = await Promise.allSettled([
    fetch(`${_baseURL}/status/price`).then(r => r.ok ? r.json() : null),
    fetch(`${_baseURL}/status/epoch/status`).then(r => r.ok ? r.json() : null),
    fetch(`${_baseURL}/status/tokenomics`).then(r => r.ok ? r.json() : null),
  ]);
  const price = priceRes.status === 'fulfilled' ? priceRes.value?.data?.[0] : null;
  const epoch = epochRes.status === 'fulfilled' ? epochRes.value?.data?.[0] : null;
  const tokenomics = tokenomicsRes.status === 'fulfilled' ? tokenomicsRes.value?.data?.[0] : null;
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
