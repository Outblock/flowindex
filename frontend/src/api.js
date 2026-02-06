import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const WS_BASE = (() => {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  if (API_URL.startsWith('https://')) return API_URL.replace('https://', 'wss://');
  if (API_URL.startsWith('http://')) return API_URL.replace('http://', 'ws://');
  return window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.host}`;
})();
export const WS_URL = WS_BASE.endsWith('/ws') ? WS_BASE : `${WS_BASE}/ws`;

export const api = {
  getBlocks: (cursor = '', limit = 10) =>
    axios.get(`${API_URL}/blocks`, { params: { cursor, limit } }).then(res => res.data),
  getBlock: (height) => axios.get(`${API_URL}/blocks/${height}`).then(res => res.data),
  getTransactions: (cursor = '', limit = 10) =>
    axios.get(`${API_URL}/transactions`, { params: { cursor, limit } }).then(res => res.data),
  getTransaction: (txId) => axios.get(`${API_URL}/transactions/${txId}`).then(res => res.data),
  getAccount: (address) => axios.get(`${API_URL}/accounts/${address}`).then(res => res.data),
  getAccountContractCode: (address, name) =>
    axios.get(`${API_URL}/accounts/${address}/contracts/${encodeURIComponent(name)}`).then(res => res.data),
  getAccountTransactions: (address, cursor = '', limit = 20) =>
    axios.get(`${API_URL}/accounts/${address}/transactions`, { params: { cursor, limit } }).then(res => res.data),
  getAccountTokenTransfers: (address, cursor = '', limit = 20) =>
    axios.get(`${API_URL}/accounts/${address}/token-transfers`, { params: { cursor, limit } }).then(res => res.data),
  getAccountNFTTransfers: (address, cursor = '', limit = 20) =>
    axios.get(`${API_URL}/accounts/${address}/nft-transfers`, { params: { cursor, limit } }).then(res => res.data),
  getAccountStorageOverview: (address) =>
    axios.get(`${API_URL}/accounts/${address}/storage`).then(res => res.data),
  getAccountStorageLinks: (address, domain) =>
    axios.get(`${API_URL}/accounts/${address}/storage/links`, { params: { domain } }).then(res => res.data),
  getAccountStorageItem: (address, path, { raw = false, uuid = '' } = {}) =>
    axios.get(`${API_URL}/accounts/${address}/storage/item`, { params: { path, raw, uuid } }).then(res => res.data),
  getDailyStats: () => axios.get(`${API_URL}/stats/daily`).then(res => res.data),
  getNetworkStats: () => axios.get(`${API_URL}/stats/network`).then(res => res.data),
  getStatus: () => axios.get(`${API_URL}/status`).then(res => res.data),
};
