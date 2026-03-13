import { createMCPClient } from "@ai-sdk/mcp";
import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getSystemPrompt } from "@/lib/system-prompt";
import { buildSkillsPrompt, createLoadSkillTool } from "@/lib/skills";

const MCP_URL = process.env.MCP_SERVER_URL || "http://localhost:8085/mcp";
const CADENCE_MCP_URL =
  process.env.CADENCE_MCP_URL || "https://cadence-mcp.up.railway.app/mcp";
const EVM_MCP_URL =
  process.env.EVM_MCP_URL || "https://flow-evm-mcp.up.railway.app/mcp";

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

// Mode -> model + thinking config
const MODE_CONFIG = {
  fast: {
    model: "claude-haiku-4-5-20251001",
    thinking: false,
  },
  balanced: {
    model: "claude-sonnet-4-6",
    thinking: false,
  },
  deep: {
    model: "claude-opus-4-6",
    thinking: true,
  },
} as const;

type ChatMode = keyof typeof MODE_CONFIG;

// ---------------------------------------------------------------------------
// Pre-processing: strip failed tool results to reduce token waste
// ---------------------------------------------------------------------------

/**
 * Strip failed/errored tool invocations from message parts — they add no
 * value to the conversation and waste tokens. Compaction handles the rest.
 */
function stripFailedToolCalls(m: UIMessage): UIMessage {
  const parts = (m.parts as any[]).filter((part: any) => {
    if (
      part.type === "tool-invocation" &&
      (part.state === "output-error" || part.state === "error")
    ) {
      return false;
    }
    return true;
  });

  // If all parts were stripped, keep a minimal text part so the message isn't empty
  if (parts.length === 0) {
    return { ...m, parts: [{ type: "text" as const, text: "(tool calls failed)" }] } as UIMessage;
  }

  return { ...m, parts } as UIMessage;
}

// Try to connect to an MCP server and fetch its tools. Returns empty on failure.
async function safeMcpTools(
  url: string
): Promise<{
  tools: Record<string, any>;
  client: Awaited<ReturnType<typeof createMCPClient>> | null;
}> {
  try {
    const client = await createMCPClient({ transport: { type: "http", url } });
    const tools = await client.tools();
    return { tools, client };
  } catch (e) {
    console.error(`[chat] MCP connection failed (${url}):`, e);
    return { tools: {}, client: null };
  }
}

export async function POST(req: Request) {
  const { messages: rawMessages, mode: rawMode } =
    (await req.json()) as { messages: Record<string, unknown>[]; mode?: string };

  // Normalize messages: ensure every message has a parts array (handles
  // clients that send plain {role, content} without parts).
  // Also patch incomplete tool invocations so the API doesn't reject the
  // conversation with "Tool result is missing for tool call ...".
  const messages = rawMessages.map((m) => {
    if (!Array.isArray(m.parts)) {
      const content = m.content;
      return {
        ...m,
        parts: content
          ? [{ type: "text" as const, text: String(content) }]
          : [],
      } as unknown as UIMessage;
    }

    // Patch assistant messages: any tool-invocation that isn't completed
    // gets marked as an error so convertToModelMessages produces a valid
    // tool_result block instead of leaving it dangling.
    if (m.role === "assistant") {
      const parts = (m.parts as any[]).map((part: any) => {
        if (
          part.type === "tool-invocation" &&
          part.state !== "output-available" &&
          part.state !== "result"
        ) {
          return {
            ...part,
            state: "output-error",
            errorText:
              part.errorText || "Tool call did not complete (timeout or connection lost).",
          };
        }
        return part;
      });
      return { ...m, parts } as unknown as UIMessage;
    }

    return m as unknown as UIMessage;
  });

  const mode: ChatMode =
    rawMode && rawMode in MODE_CONFIG ? (rawMode as ChatMode) : "balanced";
  const cfg = MODE_CONFIG[mode];

  const [mcp, cadenceMcp, evmMcp] = await Promise.all([
    safeMcpTools(MCP_URL),
    safeMcpTools(CADENCE_MCP_URL),
    safeMcpTools(EVM_MCP_URL),
  ]);

  // Strip failed tool calls before sending to the API
  const cleanedMessages = messages.map(stripFailedToolCalls);

  const result = streamText({
    model: anthropic(cfg.model),
    providerOptions: {
      anthropic: {
        // Enable native compaction: when input exceeds the trigger threshold,
        // Claude automatically summarises older context instead of failing.
        contextManagement: {
          edits: [
            {
              type: "compact_20260112" as const,
              trigger: { type: "input_tokens" as const, value: 150_000 },
              instructions:
                "Summarize the conversation concisely. Preserve: key questions asked, " +
                "SQL queries and their results, important data points, decisions made, " +
                "and any error context. Drop verbose tool outputs.",
            },
          ],
        },
        ...(cfg.thinking && {
          thinking: { type: "enabled", budgetTokens: 10000 },
        }),
      } satisfies AnthropicLanguageModelOptions,
    },
    system: getSystemPrompt() + buildSkillsPrompt(),
    messages: await convertToModelMessages(cleanedMessages),
    tools: {
      ...mcp.tools,
      ...cadenceMcp.tools,
      ...evmMcp.tools,

      // Skills — on-demand specialized knowledge
      loadSkill: createLoadSkillTool(),

      // Web search — built-in Anthropic provider tool
      web_search: anthropic.tools.webSearch_20250305() as any,

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
    stopWhen: stepCountIs(15),
    onFinish: async () => {
      await Promise.all(
        [mcp.client?.close(), cadenceMcp.client?.close(), evmMcp.client?.close()].filter(
          Boolean,
        ),
      );
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: cfg.thinking,
    messageMetadata({ part }) {
      // Send token usage on finish so the client can show context window usage
      if (part.type === "finish") {
        return {
          usage: (part as any).totalUsage ?? (part as any).usage,
          model: cfg.model,
        };
      }
      return undefined;
    },
  });
}
