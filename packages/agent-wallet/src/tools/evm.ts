import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { flowMainnet, flowTestnet } from 'viem/chains';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from '../server/server.js';
import { LocalSigner } from '../signer/local.js';

// ---------------------------------------------------------------------------
// Minimal ERC-20 ABI for balanceOf / transfer / decimals / symbol
// ---------------------------------------------------------------------------

const ERC20_ABI = [
  {
    type: 'function' as const,
    name: 'balanceOf',
    stateMutability: 'view' as const,
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function' as const,
    name: 'decimals',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function' as const,
    name: 'symbol',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function' as const,
    name: 'transfer',
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChain(network: string): Chain {
  return network === 'mainnet' ? flowMainnet : flowTestnet;
}

const clientCache = new Map<string, PublicClient>();

function getPublicClient(network: string): PublicClient {
  if (!clientCache.has(network)) {
    const chain = getChain(network);
    clientCache.set(
      network,
      createPublicClient({ chain, transport: http() }),
    );
  }
  return clientCache.get(network)!;
}

function getEvmAccount(ctx: ServerContext) {
  // Try LocalSigner first — it may have derived an EVM key
  if (ctx.signer instanceof LocalSigner) {
    const pk = ctx.signer.getEvmPrivateKey();
    if (pk) {
      const hex = pk.startsWith('0x') ? pk : `0x${pk}`;
      return privateKeyToAccount(hex as Hex);
    }
  }

  // Explicit EVM private key from config
  if (ctx.config.evmPrivateKey) {
    const pk = ctx.config.evmPrivateKey;
    const hex = pk.startsWith('0x') ? pk : `0x${pk}`;
    return privateKeyToAccount(hex as Hex);
  }

  // Derive from mnemonic
  if (ctx.config.mnemonic) {
    return mnemonicToAccount(ctx.config.mnemonic, {
      addressIndex: ctx.config.evmAccountIndex,
    });
  }

  throw new Error(
    'No EVM account available. Provide EVM_PRIVATE_KEY, FLOW_MNEMONIC, or use a local signer.',
  );
}

/** JSON replacer that converts BigInt to string. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function jsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, bigintReplacer, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: String(error) }, null, 2),
      },
    ],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerEvmTools(server: McpServer, ctx: ServerContext): void {
  // --------------------------------------------------------------------------
  // evm_wallet_address
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_wallet_address",
    {
      title: "EVM Wallet Address",
      description:
        "Returns the current EVM EOA address derived from the configured signer.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const account = getEvmAccount(ctx);
        return jsonText({
          address: account.address,
          network: ctx.config.network,
          chain_id: getChain(ctx.config.network).id,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_get_balance
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_get_balance",
    {
      title: "EVM Get Balance",
      description:
        "Returns the native FLOW balance of an EVM address on Flow EVM.",
      inputSchema: {
        address: z.string().describe("EVM address (0x...)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ address }: { address: string }) => {
      try {
        const client = getPublicClient(ctx.config.network);
        const balance = await client.getBalance({ address: address as Address });
        return jsonText({
          address,
          balance_wei: balance.toString(),
          balance_flow: formatEther(balance),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_get_token_balance
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_get_token_balance",
    {
      title: "EVM Get Token Balance",
      description:
        "Returns the ERC-20 token balance for an address, including symbol and decimals.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 token contract address (0x...)"),
        owner: z.string().describe("Address to check balance for (0x...)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ token_address, owner }: { token_address: string; owner: string }) => {
      try {
        const client = getPublicClient(ctx.config.network);
        const contractAddr = token_address as Address;

        const [rawBalance, decimals, symbol] = await Promise.all([
          client.readContract({
            address: contractAddr,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [owner as Address],
          }),
          client.readContract({
            address: contractAddr,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }),
          client.readContract({
            address: contractAddr,
            abi: ERC20_ABI,
            functionName: 'symbol',
          }),
        ]);

        return jsonText({
          token_address,
          owner,
          symbol,
          decimals: Number(decimals),
          balance_raw: (rawBalance as bigint).toString(),
          balance_formatted: formatUnits(rawBalance as bigint, Number(decimals)),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_transfer
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_transfer",
    {
      title: "EVM Transfer Native FLOW",
      description:
        "Sends native FLOW on Flow EVM from the agent wallet to a recipient address.",
      inputSchema: {
        to: z.string().describe("Recipient EVM address (0x...)"),
        amount: z.string().describe("Amount in FLOW (e.g. '1.5')"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, amount }: { to: string; amount: string }) => {
      try {
        const account = getEvmAccount(ctx);
        const chain = getChain(ctx.config.network);
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(),
        });

        const hash = await walletClient.sendTransaction({
          to: to as Address,
          value: parseEther(amount),
        });

        return jsonText({
          tx_hash: hash,
          from: account.address,
          to,
          amount,
          network: ctx.config.network,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_transfer_erc20
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_transfer_erc20",
    {
      title: "EVM Transfer ERC-20 Token",
      description:
        "Transfers an ERC-20 token on Flow EVM from the agent wallet to a recipient.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 token contract address (0x...)"),
        to: z.string().describe("Recipient EVM address (0x...)"),
        amount: z.string().describe("Amount in human-readable units (e.g. '100.0')"),
        decimals: z.number().optional().describe("Token decimals (default: 18). Query evm_get_token_balance first if unsure."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ token_address, to, amount, decimals }: {
      token_address: string;
      to: string;
      amount: string;
      decimals?: number;
    }) => {
      try {
        const account = getEvmAccount(ctx);
        const chain = getChain(ctx.config.network);
        const client = getPublicClient(ctx.config.network);

        // Resolve decimals if not provided
        const tokenDecimals = decimals ?? Number(
          await client.readContract({
            address: token_address as Address,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }),
        );

        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(),
        });

        const parsedAmount = parseUnits(amount, tokenDecimals);

        const hash = await walletClient.writeContract({
          address: token_address as Address,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [to as Address, parsedAmount],
        });

        return jsonText({
          tx_hash: hash,
          from: account.address,
          to,
          token_address,
          amount,
          decimals: tokenDecimals,
          network: ctx.config.network,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_read_contract
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_read_contract",
    {
      title: "EVM Read Contract",
      description:
        "Calls a read-only (view/pure) function on an EVM smart contract. Provide the ABI as a JSON array.",
      inputSchema: {
        contract_address: z.string().describe("Contract address (0x...)"),
        abi: z.string().describe("ABI JSON array (e.g. '[{\"type\":\"function\",...}]')"),
        function_name: z.string().describe("Name of the function to call"),
        args: z.string().optional().describe("Arguments as a JSON array (e.g. '[\"0xabc...\", 42]')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ contract_address, abi, function_name, args }: {
      contract_address: string;
      abi: string;
      function_name: string;
      args?: string;
    }) => {
      try {
        const client = getPublicClient(ctx.config.network);
        const parsedAbi = JSON.parse(abi);
        const parsedArgs = args ? JSON.parse(args) : [];

        const result = await client.readContract({
          address: contract_address as Address,
          abi: parsedAbi,
          functionName: function_name,
          args: parsedArgs,
        });

        return jsonText({ result });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_write_contract
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_write_contract",
    {
      title: "EVM Write Contract",
      description:
        "Calls a state-changing function on an EVM smart contract. Returns the transaction hash.",
      inputSchema: {
        contract_address: z.string().describe("Contract address (0x...)"),
        abi: z.string().describe("ABI JSON array (e.g. '[{\"type\":\"function\",...}]')"),
        function_name: z.string().describe("Name of the function to call"),
        args: z.string().optional().describe("Arguments as a JSON array (e.g. '[\"0xabc...\", 42]')"),
        value: z.string().optional().describe("Native FLOW to send with the call (in FLOW, e.g. '0.5')"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ contract_address, abi, function_name, args, value }: {
      contract_address: string;
      abi: string;
      function_name: string;
      args?: string;
      value?: string;
    }) => {
      try {
        const account = getEvmAccount(ctx);
        const chain = getChain(ctx.config.network);
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(),
        });

        const parsedAbi = JSON.parse(abi);
        const parsedArgs = args ? JSON.parse(args) : [];

        const hash = await walletClient.writeContract({
          address: contract_address as Address,
          abi: parsedAbi,
          functionName: function_name,
          args: parsedArgs,
          ...(value ? { value: parseEther(value) } : {}),
        });

        return jsonText({
          tx_hash: hash,
          from: account.address,
          contract_address,
          function_name,
          network: ctx.config.network,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // evm_get_transaction
  // --------------------------------------------------------------------------
  server.registerTool(
    "evm_get_transaction",
    {
      title: "EVM Get Transaction",
      description:
        "Returns details of an EVM transaction by its hash, including status, block number, gas used, and receipt.",
      inputSchema: {
        tx_hash: z.string().describe("Transaction hash (0x...)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tx_hash }: { tx_hash: string }) => {
      try {
        const client = getPublicClient(ctx.config.network);

        const [tx, receipt] = await Promise.all([
          client.getTransaction({ hash: tx_hash as Hex }),
          client.getTransactionReceipt({ hash: tx_hash as Hex }).catch(() => null),
        ]);

        return jsonText({
          transaction: tx,
          receipt,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
