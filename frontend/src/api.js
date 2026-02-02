import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export const api = {
  getBlocks: () => axios.get(`${API_URL}/blocks`),
  getBlock: (height) => axios.get(`${API_URL}/blocks/${height}`),
  getTransactions: () => axios.get(`${API_URL}/transactions`),
  getTransaction: (txId) => axios.get(`${API_URL}/transactions/${txId}`),
  getStatus: () => axios.get(`${API_URL}/status`),
};
