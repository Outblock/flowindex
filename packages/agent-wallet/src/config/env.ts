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

const VALID_NETWORKS = ['mainnet', 'testnet'] as const;
const VALID_SIG_ALGOS = ['ECDSA_P256', 'ECDSA_secp256k1'] as const;
const VALID_HASH_ALGOS = ['SHA2_256', 'SHA3_256'] as const;

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

  const networkRaw = process.env.FLOW_NETWORK || 'mainnet';
  if (!(VALID_NETWORKS as readonly string[]).includes(networkRaw)) {
    throw new Error(`Invalid FLOW_NETWORK: ${networkRaw}. Must be mainnet or testnet.`);
  }
  const network = networkRaw as 'mainnet' | 'testnet';

  const sigAlgoRaw = process.env.FLOW_SIG_ALGO || 'ECDSA_secp256k1';
  if (!(VALID_SIG_ALGOS as readonly string[]).includes(sigAlgoRaw)) {
    throw new Error(`Invalid FLOW_SIG_ALGO: ${sigAlgoRaw}. Must be one of: ${VALID_SIG_ALGOS.join(', ')}`);
  }

  const hashAlgoRaw = process.env.FLOW_HASH_ALGO || 'SHA2_256';
  if (!(VALID_HASH_ALGOS as readonly string[]).includes(hashAlgoRaw)) {
    throw new Error(`Invalid FLOW_HASH_ALGO: ${hashAlgoRaw}. Must be one of: ${VALID_HASH_ALGOS.join(', ')}`);
  }

  return {
    network,
    mnemonic,
    privateKey,
    flowAddress: process.env.FLOW_ADDRESS?.trim(),
    flowKeyIndex: parseInt(process.env.FLOW_KEY_INDEX || '0', 10),
    sigAlgo: sigAlgoRaw as AgentWalletConfig['sigAlgo'],
    hashAlgo: hashAlgoRaw as AgentWalletConfig['hashAlgo'],
    evmPrivateKey,
    evmAccountIndex: parseInt(process.env.EVM_ACCOUNT_INDEX || '0', 10),
    flowindexToken,
    flowindexUrl: process.env.FLOWINDEX_URL || 'https://flowindex.io',
    approvalRequired: process.env.APPROVAL_REQUIRED !== 'false',
    etherscanApiKey: process.env.ETHERSCAN_API_KEY?.trim(),
    signerType,
  };
}
