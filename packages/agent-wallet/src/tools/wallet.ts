import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from '../server/server.js';

/** Go API envelope: { data: {...}, error: {...} } */
interface ApiEnvelope<T> {
  data?: T;
  error?: { message: string };
}

export function registerWalletTools(server: McpServer, ctx: ServerContext): void {
  // --------------------------------------------------------------------------
  // wallet_status — read-only, returns signer info
  // --------------------------------------------------------------------------
  server.registerTool(
    "wallet_status",
    {
      title: "Wallet Status",
      description:
        "Returns the current wallet configuration: signer type, Flow address, EVM address, key index, algorithms, network, and approval mode.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const info = ctx.signer.info();
        const result = {
          signer_type: info.type,
          flow_address: info.flowAddress || null,
          evm_address: info.evmAddress || null,
          key_index: info.keyIndex,
          sig_algo: info.sigAlgo,
          hash_algo: info.hashAlgo,
          network: ctx.config.network,
          approval_required: ctx.config.approvalRequired,
          headless: ctx.signer.isHeadless(),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --------------------------------------------------------------------------
  // wallet_login — initiate cloud-interactive login flow
  // --------------------------------------------------------------------------
  server.registerTool(
    "wallet_login",
    {
      title: "Wallet Login",
      description:
        "Initiates an interactive login flow for cloud wallet. Returns a login URL that the user must visit to authenticate. Only needed for cloud-interactive signer type.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const resp = await fetch(
          `${ctx.config.flowindexUrl}/api/v1/wallet/agent/login`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        );

        if (!resp.ok) {
          const body = await resp.text();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Login request failed (${resp.status}): ${body}` },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const envelope = (await resp.json()) as ApiEnvelope<{
          session_id: string;
          login_url: string;
          expires_in: number;
        }>;

        if (envelope.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: envelope.error.message },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const data = envelope.data!;
        const result = {
          status: "pending",
          login_url: data.login_url,
          session_id: data.session_id,
          message:
            "Please open the login URL in a browser to authenticate. Then call wallet_login_status with the session_id to complete login.",
          expires_in: data.expires_in,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --------------------------------------------------------------------------
  // wallet_login_status — check login status and finalize auth
  // --------------------------------------------------------------------------
  server.registerTool(
    "wallet_login_status",
    {
      title: "Wallet Login Status",
      description:
        "Checks the status of an interactive login session. If authenticated, activates the cloud signer with the received token.",
      inputSchema: {
        session_id: z.string().describe("The session_id returned by wallet_login"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ session_id }: { session_id: string }) => {
      try {
        const resp = await fetch(
          `${ctx.config.flowindexUrl}/api/v1/wallet/agent/login/${encodeURIComponent(session_id)}`
        );

        if (!resp.ok) {
          const body = await resp.text();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: `Status check failed (${resp.status}): ${body}`,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const envelope = (await resp.json()) as ApiEnvelope<{
          status: string;
          token?: string;
        }>;

        if (envelope.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: envelope.error.message },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const data = envelope.data!;

        if (data.status === 'completed' && data.token) {
          // Activate the cloud signer with the received token
          ctx.cloudSigner.setToken(data.token);
          await ctx.cloudSigner.init();

          // If using cloud-interactive, swap the active signer
          if (ctx.config.signerType === 'cloud-interactive') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx as any).signer = ctx.cloudSigner;
          }

          const info = ctx.cloudSigner.info();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "authenticated",
                    flow_address: info.flowAddress,
                    evm_address: info.evmAddress,
                    key_index: info.keyIndex,
                    message: "Login successful. Wallet is now active.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Not yet authenticated
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: data.status || "pending",
                  authenticated: false,
                  message:
                    "Login not yet completed. Please visit the login URL and try again.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
