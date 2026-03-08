export type SignerType = 'local-key' | 'local-mnemonic' | 'cloud' | 'cloud-interactive' | 'none';

export interface AgentWalletConfig {
  network: 'mainnet' | 'testnet';
  mnemonic?: string;
  privateKey?: string;
  flowAddress?: string;
  flowKeyIndex: number;
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1';
  hashAlgo: 'SHA2_256' | 'SHA3_256';
  evmPrivateKey?: string;
  evmAccountIndex: number;
  flowindexToken?: string;
  flowindexUrl: string;
  approvalRequired: boolean;
  etherscanApiKey?: string;
  signerType: SignerType;
}

export function loadConfig(): AgentWalletConfig {
  const mnemonic = process.env.FLOW_MNEMONIC?.trim();
  const privateKey = process.env.FLOW_PRIVATE_KEY?.trim();
  const evmPrivateKey = process.env.EVM_PRIVATE_KEY?.trim();
  const flowindexToken = process.env.FLOWINDEX_TOKEN?.trim();

  let signerType: SignerType;
  if (mnemonic) {
    signerType = 'local-mnemonic';
  } else if (privateKey) {
    signerType = 'local-key';
  } else if (flowindexToken) {
    signerType = 'cloud';
  } else {
    signerType = 'cloud-interactive';
  }

  const network = (process.env.FLOW_NETWORK || 'mainnet') as 'mainnet' | 'testnet';

  return {
    network,
    mnemonic,
    privateKey,
    flowAddress: process.env.FLOW_ADDRESS?.trim(),
    flowKeyIndex: parseInt(process.env.FLOW_KEY_INDEX || '0', 10),
    sigAlgo: (process.env.FLOW_SIG_ALGO || 'ECDSA_secp256k1') as AgentWalletConfig['sigAlgo'],
    hashAlgo: (process.env.FLOW_HASH_ALGO || 'SHA2_256') as AgentWalletConfig['hashAlgo'],
    evmPrivateKey,
    evmAccountIndex: parseInt(process.env.EVM_ACCOUNT_INDEX || '0', 10),
    flowindexToken,
    flowindexUrl: process.env.FLOWINDEX_URL || 'https://flowindex.io',
    approvalRequired: process.env.APPROVAL_REQUIRED !== 'false',
    etherscanApiKey: process.env.ETHERSCAN_API_KEY?.trim(),
    signerType,
  };
}
