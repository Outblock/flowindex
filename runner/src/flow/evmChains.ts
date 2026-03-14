import { defineChain } from 'viem';

export const flowEvmMainnet = defineChain({
  id: 747,
  name: 'Flow EVM',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.evm.nodes.onflow.org'] },
  },
  blockExplorers: {
    default: { name: 'FlowDiver', url: 'https://evm.flowdiver.io' },
  },
});

export const flowEvmTestnet = defineChain({
  id: 545,
  name: 'Flow EVM Testnet',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.evm.nodes.onflow.org'] },
  },
  blockExplorers: {
    default: { name: 'FlowDiver', url: 'https://evm-testnet.flowdiver.io' },
  },
  testnet: true,
});
