import type { Abi, WalletClient } from 'viem';

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

export async function compileSolidity(source: string, fileName = 'Contract.sol'): Promise<CompilationResult> {
  // Dynamic import to avoid loading solc WASM on startup
  const solcModule = await import('solc');
  const solc = solcModule.default || solcModule;

  const input = {
    language: 'Solidity',
    sources: { [fileName]: { content: source } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (output.errors) {
    for (const err of output.errors) {
      if (err.severity === 'error') errors.push(err.formattedMessage || err.message);
      else warnings.push(err.formattedMessage || err.message);
    }
  }

  if (errors.length > 0 || !output.contracts) {
    return { success: false, contracts: [], errors, warnings };
  }

  const contracts: CompilationResult['contracts'] = [];
  const fileContracts = output.contracts[fileName];
  if (fileContracts) {
    for (const [name, contract] of Object.entries(fileContracts) as [string, any][]) {
      contracts.push({
        name,
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
      });
    }
  }

  return { success: true, contracts, errors, warnings };
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
