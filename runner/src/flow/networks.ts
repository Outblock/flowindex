export type FlowNetwork = 'mainnet' | 'testnet';

export const NETWORK_CONFIG: Record<FlowNetwork, Record<string, string>> = {
  mainnet: {
    'accessNode.api': 'https://rest-mainnet.onflow.org',
    'discovery.wallet': 'https://fcl-discovery.onflow.org/authn',
    'flow.network': 'mainnet',
    '0xFungibleToken': '0xf233dcee88fe0abe',
    '0xFlowToken': '0x1654653399040a61',
    '0xNonFungibleToken': '0x1d7e57aa55817448',
    '0xMetadataViews': '0x1d7e57aa55817448',
    '0xEVM': '0xe467b9dd11fa00df',
  },
  testnet: {
    'accessNode.api': 'https://rest-testnet.onflow.org',
    'discovery.wallet': 'https://fcl-discovery.onflow.org/testnet/authn',
    'flow.network': 'testnet',
    '0xFungibleToken': '0x9a0766d93b6608b7',
    '0xFlowToken': '0x7e60df042a9c0868',
    '0xNonFungibleToken': '0x631e88ae7f1d7c20',
    '0xMetadataViews': '0x631e88ae7f1d7c20',
    '0xEVM': '0x8c5303eaa26202d6',
  },
};

export const EVM_NETWORKS: Record<FlowNetwork, { rpcUrl: string; chainId: number; name: string }> = {
  mainnet: {
    rpcUrl: 'https://mainnet.evm.nodes.onflow.org',
    chainId: 747,
    name: 'Flow EVM Mainnet',
  },
  testnet: {
    rpcUrl: 'https://testnet.evm.nodes.onflow.org',
    chainId: 545,
    name: 'Flow EVM Testnet',
  },
};
