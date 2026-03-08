export type FlowNetwork = 'mainnet' | 'testnet';

export interface NetworkConfig {
  accessNode: string;
  evmRpc: string;
  evmChainId: number;
  discoveryWallet: string;
  contracts: Record<string, string>;
}

export const NETWORK_CONFIG: Record<FlowNetwork, NetworkConfig> = {
  mainnet: {
    accessNode: 'https://rest-mainnet.onflow.org',
    evmRpc: 'https://mainnet.evm.nodes.onflow.org',
    evmChainId: 747,
    discoveryWallet: 'https://fcl-discovery.onflow.org/authn',
    contracts: {
      FungibleToken: '0xf233dcee88fe0abe',
      FlowToken: '0x1654653399040a61',
      NonFungibleToken: '0x1d7e57aa55817448',
      MetadataViews: '0x1d7e57aa55817448',
      EVM: '0xe467b9dd11fa00df',
      FlowEVMBridge: '0x1e4aa0b87d10b141',
      NFTCatalog: '0x49a7cda3a1eecc29',
      FlowIDTableStaking: '0x8624b52f9ddcd04a',
      HybridCustody: '0xd8a7e05a7ac670c0',
    },
  },
  testnet: {
    accessNode: 'https://rest-testnet.onflow.org',
    evmRpc: 'https://testnet.evm.nodes.onflow.org',
    evmChainId: 545,
    discoveryWallet: 'https://fcl-discovery.onflow.org/testnet/authn',
    contracts: {
      FungibleToken: '0x9a0766d93b6608b7',
      FlowToken: '0x7e60df042a9c0868',
      NonFungibleToken: '0x631e88ae7f1d7c20',
      MetadataViews: '0x631e88ae7f1d7c20',
      EVM: '0x8c5303eaa26202d6',
      FlowEVMBridge: '0xdfc20aee650fcbdf',
      NFTCatalog: '0x324c34e1c517e4db',
      FlowIDTableStaking: '0x9eca2b38b18b5dfe',
      HybridCustody: '0x294e44e1ec6993c6',
    },
  },
};

export function getFlowAccessNode(network: FlowNetwork): string {
  return NETWORK_CONFIG[network].accessNode;
}

export function getEvmRpcUrl(network: FlowNetwork): string {
  return NETWORK_CONFIG[network].evmRpc;
}
