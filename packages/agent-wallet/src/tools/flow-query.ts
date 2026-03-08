import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from '../server/server.js';
import { FlowIndexClient } from '../flowindex/client.js';

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
        "Returns detailed information about a Flow account including keys, contracts, and storage usage.",
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
        const client = new FlowIndexClient(ctx.config.flowindexUrl);
        const data = await client.getAccount(address);
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
        "Returns the native FLOW token balance for a Flow account.",
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
        const client = new FlowIndexClient(ctx.config.flowindexUrl);
        const data = await client.getFlowBalance(address);
        return jsonText(data);
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
        "Returns all fungible token vault balances for a Flow account (FLOW, USDC, stFlow, etc.).",
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
        const client = new FlowIndexClient(ctx.config.flowindexUrl);
        const data = await client.getFtBalances(address);
        return jsonText(data);
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
        "Returns all NFT collections and items held by a Flow account.",
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
        const client = new FlowIndexClient(ctx.config.flowindexUrl);
        const data = await client.getNftCollections(address);
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
        "Returns full details for a Flow transaction by its ID, including events, status, and error messages.",
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
        const client = new FlowIndexClient(ctx.config.flowindexUrl);
        const data = await client.getTransaction(tx_id);
        return jsonText(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
