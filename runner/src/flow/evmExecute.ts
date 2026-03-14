import type { Abi, WalletClient } from 'viem';
import SolcWorker from './solcWorker?worker';

export interface CompilationResult {
  success: boolean;
  contracts: Array<{
    name: string;
    abi: Abi;
    bytecode: `0x${string}`;
  }>;
  errors: string[];
  warnings: string[];
}

let worker: Worker | null = null;
let nextId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new SolcWorker();
  }
  return worker;
}

export async function compileSolidity(source: string, fileName = 'Contract.sol'): Promise<CompilationResult> {
  const w = getWorker();
  const id = nextId++;

  return new Promise((resolve, reject) => {
    function handler(e: MessageEvent) {
      if (e.data.id !== id) return;
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      resolve(e.data as CompilationResult);
    }
    function errorHandler(e: ErrorEvent) {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      reject(new Error(e.message));
    }
    w.addEventListener('message', handler);
    w.addEventListener('error', errorHandler);
    w.postMessage({ id, source, fileName });
  });
}

export interface DeployResult {
  contractAddress: `0x${string}`;
  transactionHash: `0x${string}`;
  contractName: string;
}

export async function deploySolidity(
  walletClient: WalletClient,
  abi: Abi,
  bytecode: `0x${string}`,
  contractName: string,
): Promise<DeployResult> {
  const [account] = await walletClient.getAddresses();
  if (!account) throw new Error('No EVM account connected');

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    account,
    chain: walletClient.chain,
  });

  // Wait for receipt to get contract address
  const { createPublicClient, http } = await import('viem');
  const publicClient = createPublicClient({
    chain: walletClient.chain,
    transport: http(),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`Deploy tx ${hash} did not create a contract`);
  }

  return {
    contractAddress: receipt.contractAddress,
    transactionHash: hash,
    contractName,
  };
}
