import { createPublicClient, http, type PublicClient, defineChain } from 'viem'

const flowMainnet = defineChain({
  id: 747,
  name: 'Flow',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.evm.nodes.onflow.org'] } },
  blockExplorers: { default: { name: 'FlowScan', url: 'https://evm.flowscan.io' } },
})

let _client: PublicClient | null = null

export function getEvmClient(): PublicClient {
  if (typeof window === 'undefined') {
    throw new Error('getEvmClient() must only be called client-side')
  }
  if (!_client) {
    _client = createPublicClient({
      chain: flowMainnet,
      transport: http('https://mainnet.evm.nodes.onflow.org'),
      batch: { multicall: true },
    })
  }
  return _client
}
