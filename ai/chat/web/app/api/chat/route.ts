import { createMCPClient } from "@ai-sdk/mcp";
import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getSystemPrompt } from "@/lib/system-prompt";

const MCP_URL = process.env.MCP_SERVER_URL || "http://localhost:8085/mcp";
const CADENCE_MCP_URL =
  process.env.CADENCE_MCP_URL || "https://cadence-mcp.up.railway.app/mcp";
const EVM_MCP_URL =
  process.env.EVM_MCP_URL || "http://localhost:3002/sse";

/* ── Curated API whitelist ── */

const API_WHITELIST = [
  "https://rest-mainnet.onflow.org/",
  "https://evm.flowindex.io/api/",
  "https://flowindex.io/flow/v1/",
  "https://api.coingecko.com/",
  "https://api.increment.fi/",
];

const MAX_RESPONSE_BYTES = 1_000_000; // 1 MB
const FETCH_TIMEOUT_MS = 30_000;

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return API_WHITELIST.some((prefix) => url.startsWith(prefix));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const { messages, thinking }: { messages: UIMessage[]; thinking?: boolean } =
    await req.json();

  const [mcpClient, cadenceMcp] = await Promise.all([
    createMCPClient({ transport: { type: "http", url: MCP_URL } }),
    createMCPClient({ transport: { type: "http", url: CADENCE_MCP_URL } }),
  ]);

  // EVM MCP is optional — gracefully degrade if unavailable
  let evmMcp: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  try {
    evmMcp = await createMCPClient({ transport: { type: "sse", url: EVM_MCP_URL } });
  } catch (e) {
    console.warn("[chat] EVM MCP unavailable:", (e as Error).message);
  }

  const [mcpTools, cadenceTools, evmTools] = await Promise.all([
    mcpClient.tools(),
    cadenceMcp.tools(),
    evmMcp ? evmMcp.tools() : Promise.resolve({}),
  ]);

  const result = streamText({
    model: anthropic(process.env.LLM_MODEL || "claude-sonnet-4-6"),
    system: getSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools: {
      ...mcpTools,
      ...cadenceTools,
      ...evmTools,

      // Web search — built-in Anthropic tool
      web_search: anthropic.tools.webSearch(),

      // Curated API fetch
      fetch_api: tool({
        description:
          "Fetch data from a curated list of public APIs. Allowed domains: Flow Access API (rest-mainnet.onflow.org), Blockscout EVM API (evm.flowindex.io/api), FlowIndex API (flowindex.io/flow/v1), CoinGecko (api.coingecko.com), Increment Finance (api.increment.fi). HTTPS only.",
        inputSchema: z.object({
          url: z.string().url().describe("Full HTTPS URL to fetch"),
          method: z
            .enum(["GET", "POST"])
            .default("GET")
            .describe("HTTP method"),
          body: z
            .string()
            .optional()
            .describe("Request body for POST (JSON string)"),
          headers: z
            .record(z.string())
            .optional()
            .describe("Optional HTTP headers"),
        }),
        execute: async ({ url, method, body, headers }) => {
          if (!isUrlAllowed(url)) {
            return {
              error: `URL not allowed. Allowed prefixes: ${API_WHITELIST.join(", ")}`,
            };
          }

          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            FETCH_TIMEOUT_MS,
          );

          try {
            const res = await fetch(url, {
              method,
              headers: {
                Accept: "application/json",
                ...headers,
                ...(body ? { "Content-Type": "application/json" } : {}),
              },
              body: method === "POST" ? body : undefined,
              signal: controller.signal,
            });

            const text = await res.text();
            const truncated =
              text.length > MAX_RESPONSE_BYTES
                ? text.slice(0, MAX_RESPONSE_BYTES) + "\n...[truncated]"
                : text;

            return {
              status: res.status,
              statusText: res.statusText,
              body: truncated,
            };
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : "Unknown error";
            return { error: message };
          } finally {
            clearTimeout(timer);
          }
        },
      }),

      createChart: tool({
        description:
          "Create a chart visualization from data. Use this after running a SQL query to visualize the results. Supports bar, line, pie, doughnut, and horizontal bar charts.",
        inputSchema: z.object({
          chartType: z
            .enum(["bar", "line", "pie", "doughnut", "horizontalBar"])
            .describe("The type of chart to render"),
          title: z.string().describe("Chart title"),
          labels: z
            .array(z.string())
            .describe("Labels for the x-axis or pie slices"),
          datasets: z
            .array(
              z.object({
                label: z.string().describe("Dataset label"),
                data: z.array(z.number()).describe("Data values"),
              }),
            )
            .describe("One or more datasets to plot"),
        }),
        execute: async ({ chartType, title, labels, datasets }) => {
          return { chartType, title, labels, datasets };
        },
      }),
    },
    ...(thinking
      ? {
          providerOptions: {
            anthropic: {
              thinking: { type: "enabled" as const, budgetTokens: 10000 },
            },
          },
        }
      : {}),
    stopWhen: stepCountIs(15),
    onFinish: async () => {
      await Promise.all([mcpClient.close(), cadenceMcp.close(), evmMcp?.close()].filter(Boolean));
    },
  });

  return result.toUIMessageStreamResponse();
}
