import axios from 'axios';

const API_URL = '/api';
const WS_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}/ws`
  : `ws://${window.location.host}/ws`;

export const api = {
  getBlocks: (page = 1) => axios.get(`${API_URL}/blocks?page=${page}`).then(res => res.data),
  getBlock: (height) => axios.get(`${API_URL}/blocks/${height}`).then(res => res.data),
  getTransactions: (page = 1) => axios.get(`${API_URL}/transactions?page=${page}`).then(res => res.data),
  getTransaction: (txId) => axios.get(`${API_URL}/transactions/${txId}`).then(res => res.data),
  getAccount: (address) => axios.get(`${API_URL}/accounts/${address}`).then(res => res.data),
  getAccountTransactions: (address, page = 1) => axios.get(`${API_URL}/accounts/${address}/transactions?page=${page}`).then(res => res.data),
  getAccountTokenTransfers: (address, cursor = '', limit = 20) =>
    axios.get(`${API_URL}/accounts/${address}/token-transfers`, { params: { cursor, limit } }).then(res => res.data),
  getAccountNFTTransfers: (address, cursor = '', limit = 20) =>
    axios.get(`${API_URL}/accounts/${address}/nft-transfers`, { params: { cursor, limit } }).then(res => res.data),
  getDailyStats: () => axios.get(`${API_URL}/stats/daily`).then(res => res.data),
  getNetworkStats: () => axios.get(`${API_URL}/stats/network`).then(res => res.data),
  getStatus: () => axios.get(`${API_URL}/status`).then(res => res.data),
};
