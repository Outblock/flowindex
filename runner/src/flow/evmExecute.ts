import type { Abi, WalletClient } from 'viem';
import SolcWorker from './solcWorker?worker';
import { parseRevertReason, extractRevertData } from './evmRevert';

export interface CompilationResult {
  success: boolean;
  contracts: Array<{
    name: string;
    abi: Abi;
    bytecode: `0x${string}`;
    /** Which source file this contract was defined in */
    sourceFile?: string;
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

/**
 * Extract the solc version from a pragma directive.
 * e.g. `pragma solidity ^0.8.24;` -> "0.8.24"
 *      `pragma solidity >=0.8.0 <0.9.0;` -> "0.8.0"
 * Returns undefined if no pragma found.
 */
export function detectPragmaVersion(source: string): string | undefined {
  const match = source.match(/pragma\s+solidity\s+[\^~>=<]*\s*(\d+\.\d+\.\d+)/);
  return match?.[1];
}

/**
 * Compile a single Solidity source file.
 * Optionally specify a solc version (otherwise uses the bundled compiler).
 */
export async function compileSolidity(
  source: string,
  fileName = 'Contract.sol',
  solcVersion?: string,
): Promise<CompilationResult> {
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
    w.postMessage({ id, source, fileName, solcVersion });
  });
}

/**
 * Compile multiple Solidity source files together.
 * @param primaryFile - The main .sol filename (used for display/reference)
 * @param allSolFiles - All .sol files keyed by path (e.g. {"Contract.sol": "...", "lib/Utils.sol": "..."})
 * @param solcVersion - Optional solc version override (e.g. "0.8.24")
 */
export async function compileSolidityMultiFile(
  primaryFile: string,
  allSolFiles: Record<string, string>,
  solcVersion?: string,
): Promise<CompilationResult> {
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
    w.postMessage({ id, source: '', fileName: primaryFile, sources: allSolFiles, solcVersion });
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
  constructorArgs?: unknown[],
): Promise<DeployResult> {
  const [account] = await walletClient.getAddresses();
  if (!account) throw new Error('No EVM account connected');

  try {
    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      account,
      chain: walletClient.chain,
      args: constructorArgs,
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
  } catch (err: any) {
    const revertData = extractRevertData(err);
    const parsed = revertData ? parseRevertReason(revertData, abi) : null;
    throw new Error(parsed?.message || err.shortMessage || err.message);
  }
}
