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

const MAX_RESPONSE_BYTES = 120_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_JSON_ARRAY_ITEMS = 20;
const MAX_JSON_OBJECT_KEYS = 24;
const MAX_STRING_CHARS = 240;
const MAX_CADENCE_FIELDS = 16;
const MAX_CADENCE_ARRAY_ITEMS = 12;
const MAX_SUMMARIZED_EVENTS = 120;
const MAX_SCRIPT_PREVIEW_CHARS = 500;

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

function shortText(value: string, maxChars = MAX_STRING_CHARS): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}...[${value.length - maxChars} more chars]`;
}

function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function decodeBase64Utf8(value: string): string | null {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return shortText(value);
  }

  if (depth >= 5) {
    return "[depth limit]";
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_JSON_ARRAY_ITEMS)
      .map((item) => sanitizeJsonValue(item, depth + 1));
    if (value.length > MAX_JSON_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_JSON_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, MAX_JSON_OBJECT_KEYS)) {
      out[key] = sanitizeJsonValue(entry, depth + 1);
    }
    if (entries.length > MAX_JSON_OBJECT_KEYS) {
      out.__omittedKeys = entries.length - MAX_JSON_OBJECT_KEYS;
    }
    return out;
  }

  return String(value);
}

function summarizeCadenceComposite(value: any, depth: number): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (typeof value?.id === "string") {
    summary.__type = value.id;
  }

  const fields = Array.isArray(value?.fields) ? value.fields : [];
  for (const field of fields.slice(0, MAX_CADENCE_FIELDS)) {
    if (!field || typeof field.name !== "string") continue;
    summary[field.name] = summarizeCadenceValue(field.value, depth + 1);
  }

  if (fields.length > MAX_CADENCE_FIELDS) {
    summary.__omittedFields = fields.length - MAX_CADENCE_FIELDS;
  }

  return summary;
}

function summarizeCadenceValue(value: any, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return shortText(value, 120);
  }

  if (depth >= 5) {
    return "[depth limit]";
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_CADENCE_ARRAY_ITEMS)
      .map((item) => summarizeCadenceValue(item, depth + 1));
    if (value.length > MAX_CADENCE_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_CADENCE_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (typeof value.type === "string" && "value" in value) {
    switch (value.type) {
      case "String":
      case "Character":
      case "Address":
      case "Bool":
      case "UFix64":
      case "Fix64":
      case "Int":
      case "Int8":
      case "Int16":
      case "Int32":
      case "Int64":
      case "Int128":
      case "Int256":
      case "UInt":
      case "UInt8":
      case "UInt16":
      case "UInt32":
      case "UInt64":
      case "UInt128":
      case "UInt256":
      case "Word8":
      case "Word16":
      case "Word32":
      case "Word64":
      case "Word128":
      case "Word256":
        return shortText(String(value.value), 120);
      case "Optional":
        return value.value == null ? null : summarizeCadenceValue(value.value, depth + 1);
      case "Array": {
        const items = Array.isArray(value.value) ? value.value : [];
        const summarized = items
          .slice(0, MAX_CADENCE_ARRAY_ITEMS)
          .map((item: unknown) => summarizeCadenceValue(item, depth + 1));
        if (items.length > MAX_CADENCE_ARRAY_ITEMS) {
          summarized.push(`[+${items.length - MAX_CADENCE_ARRAY_ITEMS} more items]`);
        }
        return summarized;
      }
      case "Dictionary": {
        const entries = Array.isArray(value.value) ? value.value : [];
        const summarized: Record<string, unknown> = {};
        for (const entry of entries.slice(0, MAX_CADENCE_ARRAY_ITEMS)) {
          const key = summarizeCadenceValue(entry?.key, depth + 1);
          const stringKey =
            typeof key === "string" ? key : JSON.stringify(key ?? "unknown-key");
          summarized[stringKey] = summarizeCadenceValue(entry?.value, depth + 1);
        }
        if (entries.length > MAX_CADENCE_ARRAY_ITEMS) {
          summarized.__omittedEntries = entries.length - MAX_CADENCE_ARRAY_ITEMS;
        }
        return summarized;
      }
      case "Event":
      case "Struct":
      case "Resource":
      case "Enum":
        return summarizeCadenceComposite(value.value, depth + 1);
      case "Type":
        return (
          value.value?.staticType?.typeID ??
          value.value?.typeID ??
          shortText(JSON.stringify(sanitizeJsonValue(value.value, depth + 1)))
        );
      default:
        return sanitizeJsonValue(value.value, depth + 1);
    }
  }

  return sanitizeJsonValue(value, depth + 1);
}

function summarizeCadenceBase64Json(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const decoded = decodeBase64Utf8(value);
  if (!decoded) return shortText(value, 120);

  const parsed = safeJsonParse(decoded);
  return parsed == null ? shortText(decoded, 160) : summarizeCadenceValue(parsed);
}

function extractCadenceImports(script: string): string[] {
  return Array.from(
    script.matchAll(/^\s*import\s+([A-Za-z0-9_.]+)\s+from\s+0x[0-9a-fA-F]+\s*$/gm),
  )
    .map((match) => match[1])
    .slice(0, 16);
}

function summarizeFlowTransactionResponse(parsed: any): Record<string, unknown> {
  const decodedScript =
    typeof parsed?.script === "string" ? decodeBase64Utf8(parsed.script) : null;
  const argumentsSummary = Array.isArray(parsed?.arguments)
    ? parsed.arguments.slice(0, MAX_CADENCE_ARRAY_ITEMS).map(summarizeCadenceBase64Json)
    : [];

  const summary: Record<string, unknown> = {
    id: parsed?.id,
    reference_block_id: parsed?.reference_block_id,
    gas_limit: parsed?.gas_limit,
    payer: parsed?.payer,
    proposal_key: parsed?.proposal_key
      ? {
          address: parsed.proposal_key.address,
          key_index: parsed.proposal_key.key_index,
          sequence_number: parsed.proposal_key.sequence_number,
        }
      : undefined,
    authorizers: Array.isArray(parsed?.authorizers) ? parsed.authorizers : [],
    argument_count: Array.isArray(parsed?.arguments) ? parsed.arguments.length : 0,
    arguments: argumentsSummary,
    payload_signature_count: Array.isArray(parsed?.payload_signatures)
      ? parsed.payload_signatures.length
      : 0,
    envelope_signature_count: Array.isArray(parsed?.envelope_signatures)
      ? parsed.envelope_signatures.length
      : 0,
  };

  if (Array.isArray(parsed?.arguments) && parsed.arguments.length > MAX_CADENCE_ARRAY_ITEMS) {
    summary.arguments_omitted = parsed.arguments.length - MAX_CADENCE_ARRAY_ITEMS;
  }

  if (decodedScript) {
    summary.script_summary = {
      kind:
        decodedScript.includes("transaction(") || decodedScript.includes("transaction {")
          ? "transaction"
          : decodedScript.includes("fun main(")
            ? "script"
            : "unknown",
      characters: decodedScript.length,
      imports: extractCadenceImports(decodedScript),
      preview: shortText(decodedScript, MAX_SCRIPT_PREVIEW_CHARS),
    };
  }

  return summary;
}

function summarizeFlowEvent(event: any): Record<string, unknown> {
  return {
    event_index: event?.event_index,
    type: event?.type,
    payload: summarizeCadenceBase64Json(event?.payload),
  };
}

function summarizeFlowTransactionResultResponse(parsed: any): Record<string, unknown> {
  const rawEvents = Array.isArray(parsed?.events) ? parsed.events : [];
  const events = rawEvents.slice(0, MAX_SUMMARIZED_EVENTS).map(summarizeFlowEvent);
  const eventTypeCounts = new Map<string, number>();

  for (const event of rawEvents) {
    if (typeof event?.type !== "string") continue;
    eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);
  }

  const summary: Record<string, unknown> = {
    block_id: parsed?.block_id,
    collection_id: parsed?.collection_id,
    execution: parsed?.execution,
    status: parsed?.status,
    status_code: parsed?.status_code,
    error_message: parsed?.error_message,
    computation_used: parsed?.computation_used,
    event_count: rawEvents.length,
    event_type_counts: Object.fromEntries(
      Array.from(eventTypeCounts.entries()).sort((a, b) => b[1] - a[1]),
    ),
    events,
  };

  if (rawEvents.length > MAX_SUMMARIZED_EVENTS) {
    summary.events_omitted = rawEvents.length - MAX_SUMMARIZED_EVENTS;
  }

  return summary;
}

function summarizeFlowAccessResponse(url: URL, parsed: unknown): Record<string, unknown> | null {
  if (url.hostname !== "rest-mainnet.onflow.org") return null;

  if (/^\/v1\/transactions\/[^/]+$/.test(url.pathname)) {
    return summarizeFlowTransactionResponse(parsed);
  }

  if (/^\/v1\/transaction_results\/[^/]+$/.test(url.pathname)) {
    return summarizeFlowTransactionResultResponse(parsed);
  }

  return null;
}

function formatFetchBodyForModel(url: string, text: string): { body: string; normalized: boolean } {
  const parsedJson = safeJsonParse(text);
  if (parsedJson != null) {
    const parsedUrl = new URL(url);
    const endpointSummary = summarizeFlowAccessResponse(parsedUrl, parsedJson);
    const normalizedBody = JSON.stringify(
      endpointSummary ?? sanitizeJsonValue(parsedJson),
      null,
      2,
    );

    return {
      body: shortText(normalizedBody, MAX_RESPONSE_BYTES),
      normalized: true,
    };
  }

  return {
    body: shortText(text, MAX_RESPONSE_BYTES),
    normalized: false,
  };
}

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
          "Fetch data from a curated list of public APIs. Allowed domains: Flow Access API (rest-mainnet.onflow.org), Blockscout EVM API (evm.flowindex.io/api), FlowIndex API (flowindex.io/flow/v1), CoinGecko (api.coingecko.com), Increment Finance (api.increment.fi). HTTPS only. For heavy JSON endpoints, return a normalized summary instead of a raw payload dump.",
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
            const formatted = formatFetchBodyForModel(url, text);

            return {
              status: res.status,
              statusText: res.statusText,
              body: formatted.body,
              normalized: formatted.normalized,
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
