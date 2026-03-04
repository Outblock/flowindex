import { ContractFactory, type Signer } from 'ethers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvmResult =
  | { type: 'compile_result'; data: { contracts: Record<string, { abi: any[]; bytecode: string }>; errors: any[] } }
  | { type: 'deploy_submitted'; data: { txHash: string; contractName: string } }
  | { type: 'deploy_result'; data: { address: string; txHash: string; contractName: string; abi: any[] } }
  | { type: 'error'; data: { message: string } };

// ---------------------------------------------------------------------------
// Compile endpoint
// ---------------------------------------------------------------------------

const COMPILE_URL = import.meta.env.VITE_COMPILE_SOL_URL || '/compile-sol';

/**
 * Send Solidity sources to the server compiler and return a flattened
 * contract map.  Server returns contracts keyed as "SourceName:ContractName";
 * we flatten to just "ContractName" for easier consumption.
 */
export async function compileSolidity(
  sources: Record<string, string>,
): Promise<EvmResult> {
  try {
    const res = await fetch(COMPILE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { type: 'error', data: { message: `Compilation server error: ${res.status} ${text}` } };
    }

    const json = await res.json();

    // Server may return errors alongside (or instead of) contracts
    const errors: any[] = json.errors ?? [];
    const rawContracts: Record<string, { abi: any[]; evm?: { bytecode?: { object?: string } } }> =
      json.contracts ?? {};

    // Flatten "Source:Contract" keys → "Contract" and normalise shape
    const contracts: Record<string, { abi: any[]; bytecode: string }> = {};

    for (const [key, value] of Object.entries(rawContracts)) {
      // The server may already flatten, or use "FileName.sol:ContractName"
      const name = key.includes(':') ? key.split(':').pop()! : key;
      const bytecode =
        // Prefer top-level bytecode if the server already simplified
        (value as any).bytecode ??
        // Otherwise dig into standard solc output
        value.evm?.bytecode?.object ??
        '';
      contracts[name] = { abi: value.abi, bytecode };
    }

    return { type: 'compile_result', data: { contracts, errors } };
  } catch (err) {
    return {
      type: 'error',
      data: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

/**
 * Deploy a compiled Solidity contract via an ethers.js Signer (MetaMask).
 *
 * Calls `onResult` twice:
 *   1. `deploy_submitted` — immediately after the tx is sent
 *   2. `deploy_result`    — once the tx is mined and the address is known
 */
export async function deploySolidityContract(
  signer: Signer,
  contractName: string,
  abi: any[],
  bytecode: string,
  constructorArgs: any[] = [],
  onResult: (result: EvmResult) => void,
): Promise<void> {
  try {
    const factory = new ContractFactory(abi, bytecode, signer);
    const contract = await factory.deploy(...constructorArgs);

    const txHash = contract.deploymentTransaction()?.hash ?? '';
    onResult({ type: 'deploy_submitted', data: { txHash, contractName } });

    await contract.waitForDeployment();
    const address = await contract.getAddress();

    onResult({
      type: 'deploy_result',
      data: { address, txHash, contractName, abi },
    });
  } catch (err) {
    onResult({
      type: 'error',
      data: { message: err instanceof Error ? err.message : String(err) },
    });
  }
}
