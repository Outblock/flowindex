import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

async function resolveApiBaseUrl(): Promise<string> {
  if (!import.meta.env.SSR) {
    return normalizeBaseUrl(API_URL);
  }

  // In SSR, VITE_API_URL is often relative (eg "/api"), which is invalid in Node.
  // Prefer an internal origin if provided (eg "http://127.0.0.1:8080"), otherwise
  // fall back to localhost (works for docker-compose + containerized deploys where
  // Nginx listens on :8080 and proxies /api to the backend).
  if (isAbsoluteHttpUrl(API_URL)) return normalizeBaseUrl(API_URL);

  // NOTE: Avoid importing any server-only TanStack modules from this file because
  // it is part of the client bundle too (and would pull in node:stream, etc).
  const internalOrigin =
    (typeof process !== 'undefined' && process.env && process.env.SSR_API_ORIGIN) ||
    'http://127.0.0.1:8080';

  return normalizeBaseUrl(new URL(API_URL, internalOrigin).toString());
}

const WS_BASE = (() => {
  // WebSocket is client-only. Keep this branch dead in SSR bundles.
  if (import.meta.env.SSR) return '';

  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  if (API_URL.startsWith('https://')) return API_URL.replace('https://', 'wss://');
  if (API_URL.startsWith('http://')) return API_URL.replace('http://', 'ws://');
  return window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.host}`;
})();

export const WS_URL = import.meta.env.SSR
  ? ''
  : (WS_BASE.endsWith('/ws') ? WS_BASE : `${WS_BASE}/ws`);

export const api = {
  getBlocks: (cursor = '', limit = 10) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/blocks`, { params: { cursor, limit } }).then(res => res.data),
    ),
  getBlock: (height) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/blocks/${height}`).then(res => res.data),
    ),
  getTransactions: (cursor = '', limit = 10) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/transactions`, { params: { cursor, limit } }).then(res => res.data),
    ),
  getTransaction: (txId) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/transactions/${txId}`).then(res => res.data),
    ),
  getAccount: (address) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}`).then(res => res.data),
    ),
  getAccountContractCode: (address, name) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/contracts/${encodeURIComponent(name)}`).then(res => res.data),
    ),
  getAccountTransactions: (address, cursor = '', limit = 20) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/transactions`, { params: { cursor, limit } }).then(res => res.data),
    ),
  getAccountTokenTransfers: (address, cursor = '', limit = 20) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/token-transfers`, { params: { cursor, limit } }).then(res => res.data),
    ),
  getAccountNFTTransfers: (address, cursor = '', limit = 20) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/nft-transfers`, { params: { cursor, limit } }).then(res => res.data),
    ),
  getAccountStorageOverview: (address) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/storage`).then(res => res.data),
    ),
  getAccountStorageLinks: (address, domain) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/storage/links`, { params: { domain } }).then(res => res.data),
    ),
  getAccountStorageItem: (address, path, { raw = false, uuid = '' } = {}) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/accounts/${address}/storage/item`, { params: { path, raw, uuid } }).then(res => res.data),
    ),
  getDailyStats: () =>
    resolveApiBaseUrl().then((base) => axios.get(`${base}/stats/daily`).then(res => res.data)),
  getNetworkStats: () =>
    resolveApiBaseUrl().then((base) => axios.get(`${base}/stats/network`).then(res => res.data)),
  getStatus: () =>
    resolveApiBaseUrl().then((base) => axios.get(`${base}/status`).then(res => res.data)),

  // Find-style API (defaulted to v2 via the /api reverse proxy)
  listFlowAccounts: (limit = 20, offset = 0, { height = '', sort_by = 'block_height' } = {}) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/flow/v1/account`, { params: { limit, offset, height, sort_by } }).then(res => res.data),
    ),
  listFlowContracts: (limit = 25, offset = 0, { address = '', identifier = '' } = {}) =>
    resolveApiBaseUrl().then((base) =>
      axios.get(`${base}/flow/v1/contract`, { params: { limit, offset, address, identifier } }).then(res => res.data),
    ),
};
