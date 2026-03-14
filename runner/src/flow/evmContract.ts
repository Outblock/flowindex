// runner/src/flow/evmContract.ts
import { type Abi, type AbiFunction, createPublicClient, http } from 'viem';
import type { WalletClient } from 'viem';
import type { Chain } from 'viem/chains';

export interface ContractCallResult {
  success: boolean;
  data?: any;           // Decoded return value
  rawData?: string;     // Hex return data
  txHash?: string;      // For write calls
  gasUsed?: bigint;
  error?: string;
  revertReason?: string;
}

export interface DeployedContract {
  address: `0x${string}`;
  name: string;
  abi: Abi;
  deployTxHash: string;
  chainId: number;
}

function getPublicClient(chain: Chain) {
  return createPublicClient({ chain, transport: http() });
}

/** Call a view/pure function (no tx, no gas) */
export async function callContractRead(
  chain: Chain,
  contract: DeployedContract,
  functionName: string,
  args: unknown[],
): Promise<ContractCallResult> {
  const client = getPublicClient(chain);
  try {
    const data = await client.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
    });
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.shortMessage || err.message };
  }
}

/** Send a state-changing transaction */
export async function callContractWrite(
  walletClient: WalletClient,
  contract: DeployedContract,
  functionName: string,
  args: unknown[],
  value?: bigint,
): Promise<ContractCallResult> {
  const [account] = await walletClient.getAddresses();
  if (!account) return { success: false, error: 'No EVM account connected' };

  try {
    const hash = await walletClient.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
      value,
      account,
      chain: walletClient.chain,
    });

    const client = getPublicClient(walletClient.chain!);
    const receipt = await client.waitForTransactionReceipt({ hash });

    return {
      success: receipt.status === 'success',
      txHash: hash,
      gasUsed: receipt.gasUsed,
      error: receipt.status === 'reverted' ? 'Transaction reverted' : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err.shortMessage || err.message };
  }
}

/** Estimate gas for a function call */
export async function estimateContractGas(
  chain: Chain,
  contract: DeployedContract,
  functionName: string,
  args: unknown[],
  from: `0x${string}`,
  value?: bigint,
): Promise<bigint | null> {
  const client = getPublicClient(chain);
  try {
    return await client.estimateContractGas({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
      account: from,
      value,
    });
  } catch {
    return null;
  }
}

/** Helper: get read and write functions from ABI */
export function categorizeAbiFunctions(abi: Abi) {
  const fns = abi.filter((item): item is AbiFunction => item.type === 'function');
  return {
    read: fns.filter(f => f.stateMutability === 'view' || f.stateMutability === 'pure'),
    write: fns.filter(f => f.stateMutability === 'nonpayable' || f.stateMutability === 'payable'),
  };
}
