/**
 * MCP tools for Cadence template listing, inspection, and execution.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server/server.js';
import { getTemplate, listTemplates } from '../templates/registry.js';
import { addPendingTx } from '../approval/manager.js';

// ---------------------------------------------------------------------------
// FCL network configuration
// ---------------------------------------------------------------------------

const ACCESS_NODES: Record<string, string> = {
  mainnet: 'https://rest-mainnet.onflow.org',
  testnet: 'https://rest-testnet.onflow.org',
};

async function configureFcl(network: 'mainnet' | 'testnet'): Promise<typeof import('@onflow/fcl')> {
  const fcl = await import('@onflow/fcl');
  fcl.config()
    .put('accessNode.api', ACCESS_NODES[network] ?? ACCESS_NODES.mainnet)
    .put('flow.network', network);
  return fcl;
}

// ---------------------------------------------------------------------------
// Signing / transaction execution helper
// ---------------------------------------------------------------------------

/**
 * Map Flow algo names to FCL numeric constants.
 *   SignatureAlgorithm:  ECDSA_P256 = 2, ECDSA_secp256k1 = 3
 *   HashAlgorithm:       SHA2_256 = 1, SHA3_256 = 3
 */
function sigAlgoCode(algo: string): number {
  switch (algo) {
    case 'ECDSA_P256': return 2;
    case 'ECDSA_secp256k1': return 3;
    default: return 3;
  }
}

function hashAlgoCode(algo: string): number {
  switch (algo) {
    case 'SHA2_256': return 1;
    case 'SHA3_256': return 3;
    default: return 1;
  }
}

export interface TxResult {
  status: 'sealed';
  tx_id: string;
  block_height: number;
  events: Array<{ type: string; data: unknown }>;
}

/**
 * Sign and submit a Cadence transaction via FCL, using the provided signer.
 * Reusable by the approval tools once a pending tx is approved.
 */
export async function executeFlowTransaction(
  ctx: ServerContext,
  cadenceCode: string,
  args: unknown[],
  _signerInfo?: { address?: string; keyIndex?: number },
): Promise<TxResult> {
  const fcl = await configureFcl(ctx.config.network);

  const info = ctx.signer.info();
  const address = info.flowAddress;
  if (!address) {
    throw new Error('Signer has no Flow address configured');
  }

  const keyIndex = _signerInfo?.keyIndex ?? info.keyIndex;
  const sigAlgo = sigAlgoCode(info.sigAlgo);
  const hashAlgo = hashAlgoCode(info.hashAlgo);

  // FCL authorization function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authz = (account: any) => ({
    ...account,
    addr: fcl.sansPrefix(address),
    keyId: keyIndex,
    signingFunction: async (signable: { message: string }) => {
      const result = await ctx.signer.signFlowTransaction(signable.message);
      return {
        addr: fcl.sansPrefix(address),
        keyId: keyIndex,
        signature: result.signature,
      };
    },
    sigAlgo,
    hashAlgo,
  });

  const txId: string = await fcl.mutate({
    cadence: cadenceCode,
    args: () => args,
    proposer: authz,
    payer: authz,
    authorizations: [authz],
    limit: 9999,
  });

  // Wait for seal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sealed: any = await fcl.tx(txId).onceSealed();

  return {
    status: 'sealed',
    tx_id: txId,
    block_height: (sealed.blockHeight ?? sealed.block_height ?? 0) as number,
    events: (sealed.events ?? []).map((e: { type: string; data: unknown }) => ({
      type: e.type,
      data: e.data,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tool helpers
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

export function registerTemplateTools(server: McpServer, ctx: ServerContext): void {
  // -------------------------------------------------------------------------
  // list_templates
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_templates',
    {
      title: 'List Cadence Templates',
      description:
        'List available Cadence transaction and script templates. Optionally filter by category (base, token, collection, evm, bridge, hybrid-custody, lost-and-found).',
      inputSchema: {
        category: z.string().optional().describe('Filter by category name'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category }: { category?: string }) => {
      try {
        const templates = listTemplates(category);
        const summaries = templates.map((t) => ({
          name: t.name,
          category: t.category,
          type: t.type,
          description: t.description,
          arg_count: t.args.length,
        }));
        return jsonContent(summaries);
      } catch (error) {
        return jsonContent({ error: String(error) }, true);
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_template
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_template',
    {
      title: 'Get Cadence Template',
      description:
        'Retrieve the full Cadence source code and argument schema for a named template.',
      inputSchema: {
        name: z.string().describe('Template name (e.g. "transfer_tokens_v3")'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }: { name: string }) => {
      try {
        const template = getTemplate(name);
        if (!template) {
          return jsonContent({ error: `Template "${name}" not found` }, true);
        }
        return jsonContent(template);
      } catch (error) {
        return jsonContent({ error: String(error) }, true);
      }
    },
  );

  // -------------------------------------------------------------------------
  // execute_script
  // -------------------------------------------------------------------------
  server.registerTool(
    'execute_script',
    {
      title: 'Execute Cadence Script',
      description:
        'Execute a read-only Cadence script on the Flow network. Provide either a template_name or raw Cadence code.',
      inputSchema: {
        template_name: z.string().optional().describe('Name of a script template to use'),
        code: z.string().optional().describe('Raw Cadence script code (used if template_name is not provided)'),
        args: z.array(z.any()).optional().describe('Script arguments in FCL arg format'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ template_name, code, args }: { template_name?: string; code?: string; args?: unknown[] }) => {
      try {
        let cadence: string;
        if (template_name) {
          const tmpl = getTemplate(template_name);
          if (!tmpl) return jsonContent({ error: `Template "${template_name}" not found` }, true);
          if (tmpl.type !== 'script') return jsonContent({ error: `Template "${template_name}" is a transaction, not a script` }, true);
          cadence = tmpl.cadence;
        } else if (code) {
          cadence = code;
        } else {
          return jsonContent({ error: 'Either template_name or code must be provided' }, true);
        }

        const fcl = await configureFcl(ctx.config.network);
        const result = await fcl.query({
          cadence,
          args: () => args ?? [],
        });

        return jsonContent({ result });
      } catch (error) {
        return jsonContent({ error: String(error) }, true);
      }
    },
  );

  // -------------------------------------------------------------------------
  // execute_template
  // -------------------------------------------------------------------------
  server.registerTool(
    'execute_template',
    {
      title: 'Execute Cadence Transaction',
      description:
        'Execute a Cadence transaction template. If approval is required and the signer is headless, the transaction is queued for manual approval. Otherwise it is signed and submitted immediately.',
      inputSchema: {
        template_name: z.string().describe('Name of the transaction template to execute'),
        args: z.record(z.any()).describe('Named arguments matching the template arg schema'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ template_name, args }: { template_name: string; args: Record<string, unknown> }) => {
      try {
        const template = getTemplate(template_name);
        if (!template) {
          return jsonContent({ error: `Template "${template_name}" not found` }, true);
        }
        if (template.type !== 'transaction') {
          return jsonContent({ error: `Template "${template_name}" is a script, use execute_script instead` }, true);
        }

        // Build FCL args array in template-defined order
        const fclArgs: unknown[] = template.args.map((argDef) => {
          const val = args[argDef.name];
          if (val === undefined) {
            throw new Error(`Missing required argument: ${argDef.name}`);
          }
          return val;
        });

        // Check if approval is needed
        if (ctx.config.approvalRequired && ctx.signer.isHeadless()) {
          const txId = randomUUID();
          const summary = `${template_name}(${template.args.map((a) => `${a.name}=${JSON.stringify(args[a.name])}`).join(', ')})`;
          addPendingTx(txId, {
            template_name,
            cadence: template.cadence,
            args,
            summary,
            createdAt: Date.now(),
          });
          return jsonContent({
            status: 'pending_approval',
            tx_id: txId,
            summary,
            message: 'Transaction queued for approval. Use the approve_transaction tool to sign and submit.',
          });
        }

        // Execute immediately
        const result = await executeFlowTransaction(ctx, template.cadence, fclArgs);
        return jsonContent(result);
      } catch (error) {
        return jsonContent({ error: String(error) }, true);
      }
    },
  );
}
