/**
 * MCP tools for the transaction approval flow:
 *   confirm_transaction  — approve and execute a pending tx
 *   cancel_transaction   — discard a pending tx
 *   list_pending         — show all queued pending txs
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server/server.js';
import { getPendingTx, removePendingTx, listPendingTxs } from '../approval/manager.js';
import { executeFlowTransaction, buildFclArgs } from './templates.js';
import { getTemplate } from '../templates/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonContent(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerApprovalTools(server: McpServer, ctx: ServerContext): void {
  // -------------------------------------------------------------------------
  // confirm_transaction
  // -------------------------------------------------------------------------
  server.registerTool(
    'confirm_transaction',
    {
      title: 'Confirm Pending Transaction',
      description:
        'Approve and execute a pending transaction that was queued for manual approval. Signs and submits the transaction on-chain.',
      inputSchema: {
        tx_id: z.string().describe('The pending transaction ID to confirm'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ tx_id }: { tx_id: string }) => {
      try {
        const pending = getPendingTx(tx_id);
        if (!pending) {
          return jsonContent({ error: `No pending transaction found with id "${tx_id}"` }, true);
        }

        // Remove from the queue before executing so it cannot be double-confirmed
        removePendingTx(tx_id);

        // Re-resolve the template to get the correct arg ordering and types
        const template = getTemplate(pending.template_name);
        if (!template) {
          return jsonContent({ error: `Template "${pending.template_name}" no longer found` }, true);
        }
        const rawValues = template.args.map((a) => pending.args[a.name]);
        const fclArgs = await buildFclArgs(rawValues, template.args);

        const result = await executeFlowTransaction(ctx, pending.cadence, fclArgs);
        return jsonContent(result);
      } catch (error) {
        return jsonContent({ error: String(error) }, true);
      }
    },
  );

  // -------------------------------------------------------------------------
  // cancel_transaction
  // -------------------------------------------------------------------------
  server.registerTool(
    'cancel_transaction',
    {
      title: 'Cancel Pending Transaction',
      description:
        'Cancel and discard a pending transaction that was queued for approval. The transaction will not be submitted.',
      inputSchema: {
        tx_id: z.string().describe('The pending transaction ID to cancel'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tx_id }: { tx_id: string }) => {
      const removed = removePendingTx(tx_id);
      return jsonContent({ cancelled: removed, tx_id });
    },
  );

  // -------------------------------------------------------------------------
  // list_pending
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_pending',
    {
      title: 'List Pending Transactions',
      description:
        'List all transactions currently queued and awaiting approval.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const pending = listPendingTxs();
      return jsonContent({ count: pending.length, transactions: pending });
    },
  );
}
