import { z } from 'zod';
import * as fcl from '@onflow/fcl';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from '../server/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
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

/** Ensure address has 0x prefix */
function normalizeAddr(addr: string): string {
  return addr.startsWith('0x') ? addr : `0x${addr}`;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerFlowQueryTools(server: McpServer, ctx: ServerContext): void {
  // --------------------------------------------------------------------------
  // get_account
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_account",
    {
      title: "Get Account",
      description:
        "Returns detailed information about a Flow account including balance, available balance, storage usage, and storage capacity.",
      inputSchema: {
        address: z.string().describe("Flow address (hex, with or without 0x prefix)"),
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
        const data = await ctx.cadenceService.getAccountInfo(normalizeAddr(address));
        return jsonText(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // get_flow_balance
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_flow_balance",
    {
      title: "Get FLOW Balance",
      description:
        "Returns the native FLOW token balance for a Flow account (on-chain query via Cadence script).",
      inputSchema: {
        address: z.string().describe("Flow address (hex, with or without 0x prefix)"),
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
        const addr = normalizeAddr(address);
        const info = await ctx.cadenceService.getAccountInfo(addr);
        return jsonText({
          address: addr,
          balance: info.balance,
          availableBalance: info.availableBalance,
          storageFlow: info.storageFlow,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // get_ft_balance
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_ft_balance",
    {
      title: "Get Fungible Token Balances",
      description:
        "Returns all fungible token vault balances for a Flow account (FLOW, USDC, stFlow, etc.) via on-chain Cadence script.",
      inputSchema: {
        address: z.string().describe("Flow address (hex, with or without 0x prefix)"),
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
        const balances = await ctx.cadenceService.getTokenBalanceStorage(normalizeAddr(address));
        return jsonText(balances);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // get_nft_collection
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_nft_collection",
    {
      title: "Get NFT Collections",
      description:
        "Returns all NFT collections and item IDs held by a Flow account via on-chain Cadence script.",
      inputSchema: {
        address: z.string().describe("Flow address (hex, with or without 0x prefix)"),
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
        const data = await ctx.cadenceService.getNftCollections(normalizeAddr(address));
        return jsonText(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // get_transaction
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_transaction",
    {
      title: "Get Transaction",
      description:
        "Returns full details for a Flow transaction by its ID, including status, events, and error messages (on-chain query via FCL).",
      inputSchema: {
        tx_id: z.string().describe("Flow transaction ID (64-character hex)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tx_id }: { tx_id: string }) => {
      try {
        const [tx, result] = await Promise.all([
          fcl.send([fcl.getTransaction(tx_id)]).then(fcl.decode),
          fcl.send([fcl.getTransactionStatus(tx_id)]).then(fcl.decode),
        ]);
        return jsonText({ transaction: tx, result });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
