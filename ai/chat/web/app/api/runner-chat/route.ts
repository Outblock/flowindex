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
import { buildSkillsPrompt, createLoadSkillTool } from "@/lib/skills";

const CADENCE_MCP_URL =
  process.env.CADENCE_MCP_URL || "https://cadence-mcp.up.railway.app/mcp";

// Mode -> model + thinking config (mirrors main chat)
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
type RunnerProjectFile = { path: string; content: string };

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
    console.error(`[runner-chat] MCP connection failed (${url}):`, e);
    return { tools: {}, client: null };
  }
}

/* ── Client-side editor tools (no execute — handled in browser) ── */

const editorTools = {
  list_files: tool({
    description: "List all editable files in the project with their paths",
    inputSchema: z.object({}),
  }),
  read_file: tool({
    description: "Read the content of a file by path",
    inputSchema: z.object({
      path: z.string().describe("File path"),
    }),
  }),
  create_file: tool({
    description: "Create a new file in the project",
    inputSchema: z.object({
      path: z
        .string()
        .describe("File path (relative, e.g. contracts/Token.cdc)"),
      content: z.string().describe("File content"),
    }),
  }),
  update_file: tool({
    description:
      "Replace the entire content of an existing file. User will review via diff.",
    inputSchema: z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("New complete file content"),
    }),
  }),
  edit_file: tool({
    description:
      "Apply search/replace patches to an existing file. User will review via diff.",
    inputSchema: z.object({
      path: z.string().describe("File path"),
      patches: z
        .array(
          z.object({
            search: z.string().describe("Exact text to find"),
            replace: z.string().describe("Replacement text"),
          })
        )
        .describe("Search/replace pairs"),
    }),
  }),
  delete_file: tool({
    description: "Delete a file from the project",
    inputSchema: z.object({
      path: z.string().describe("File path"),
    }),
  }),
  set_active_file: tool({
    description: "Switch the active editor tab to a file",
    inputSchema: z.object({
      path: z.string().describe("File path"),
    }),
  }),
};

/* ── Client-side wallet tools (no execute — handled in browser) ── */

const walletTools = {
  get_wallet_info: tool({
    description:
      "Get current wallet/signer state: connected status, address, key info, and active network",
    inputSchema: z.object({}),
  }),
  list_local_keys: tool({
    description:
      "List all locally stored keys with their linked on-chain Flow accounts",
    inputSchema: z.object({}),
  }),
  create_flow_account: tool({
    description:
      "Create a new Flow account on-chain for a local key. Returns the transaction ID.",
    inputSchema: z.object({
      keyId: z.string().describe("Local key ID to create account for"),
      network: z
        .enum(["mainnet", "testnet"])
        .optional()
        .describe("Network to create account on (default: current network)"),
    }),
  }),
  refresh_accounts: tool({
    description:
      "Discover on-chain Flow accounts linked to a local key by scanning the network",
    inputSchema: z.object({
      keyId: z.string().describe("Local key ID to refresh accounts for"),
      network: z
        .enum(["mainnet", "testnet"])
        .optional()
        .describe("Network to scan (default: current network)"),
    }),
  }),
  sign_message: tool({
    description:
      "Sign a hex-encoded message with a local key. Returns the signature.",
    inputSchema: z.object({
      keyId: z.string().describe("Local key ID to sign with"),
      message: z.string().describe("Hex-encoded message to sign"),
      hashAlgo: z
        .enum(["SHA2_256", "SHA3_256"])
        .optional()
        .describe("Hash algorithm (default: SHA3_256)"),
      sigAlgo: z
        .enum(["ECDSA_P256", "ECDSA_secp256k1"])
        .optional()
        .describe("Signature algorithm (default: ECDSA_secp256k1)"),
    }),
  }),
  switch_network: tool({
    description: "Switch the runner's active Flow network",
    inputSchema: z.object({
      network: z.enum(["mainnet", "testnet"]).describe("Target network"),
    }),
  }),
};

const SYSTEM_PROMPT = `You are a Cadence programming assistant embedded in Cadence Runner.
Your primary job is to help users write, edit, and debug Cadence smart contract code for Flow.

## CRITICAL: Always use editor tools for code changes

**NEVER output code in chat text.** When the user asks you to write, edit, fix, or create code, you MUST use the editor tools below. Do NOT put code in markdown code blocks — the user cannot use code from chat. The ONLY way to deliver code is through the tools.

## Response style

- Keep chat concise and implementation-focused.
- For edit/create requests, briefly explain what you will change (3-6 bullets max), then IMMEDIATELY call the editor tools. Do not show the code in chat.
- Only show short (1-5 line) code snippets in chat when explaining concepts or answering pure questions with no file changes needed.

## Editor tools

You have editor tools that directly manipulate project files. The user reviews changes via a diff view in the editor.

- \`list_files\` — see what files exist in the project.
- \`read_file(path)\` — read a file before editing. Always read first so you know the current content.
- \`create_file(path, content)\` — create a brand-new file with full content.
- \`update_file(path, content)\` — rewrite an existing file. Provide the complete new file content. The editor shows a diff for the user to review.
- \`edit_file(path, patches)\` — apply targeted search/replace patches to an existing file. Each patch has \`search\` (exact text to find) and \`replace\` (replacement text). Prefer this over \`update_file\` for small edits.
- \`delete_file(path)\` — remove a file.
- \`set_active_file(path)\` — switch the editor tab to a specific file.

Workflow:
1. Use \`list_files\` or \`read_file\` to understand the current code.
2. Explain your plan briefly in chat (no code).
3. Use \`create_file\`, \`update_file\`, or \`edit_file\` to make changes. The user will see a diff and can accept or reject.
4. If the user asks a question with no code changes, just answer in chat text.

## Wallet tools

You have wallet tools to query and manage Flow accounts:
- \`get_wallet_info\` — current signer address, key info, and network
- \`list_local_keys\` — all stored keys with their linked on-chain accounts
- \`create_flow_account(keyId, network)\` — create a new Flow account for a key
- \`refresh_accounts(keyId, network)\` — discover on-chain accounts linked to a key
- \`sign_message(keyId, message)\` — sign a hex message with a local key
- \`switch_network(network)\` — switch between mainnet and testnet
- \`flow_sign_and_send(code, args)\` — sign and submit a Cadence transaction (existing)

Always call \`get_wallet_info\` first to check if a signer is available before attempting transactions.

## Cadence guidelines

- Write modern Cadence 1.0 syntax (\`access(all)\`, not \`pub\`)
- Use correct entitlements/capabilities
- Scripts should use \`access(all) fun main(...)\`
- Transactions should use \`transaction { prepare(...) { ... } execute { ... } }\`
- Default imports (mainnet):
  - FungibleToken: 0xf233dcee88fe0abe
  - NonFungibleToken: 0x1d7e57aa55817448
  - MetadataViews: 0x1d7e57aa55817448
  - FlowToken: 0x1654653399040a61
  - FUSD: 0x3c5959b568896393

Keep responses concise and implementation-focused.${buildSkillsPrompt()}`;

function sanitizeProjectFiles(files?: RunnerProjectFile[]): RunnerProjectFile[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => typeof f?.path === "string" && typeof f?.content === "string")
    .map((f) => ({
      path: f.path.trim(),
      content: f.content,
    }))
    .filter((f) => f.path.length > 0)
    .slice(0, 24);
}

function buildProjectContext({
  network,
  activeFile,
  editorCode,
  projectFiles,
}: {
  network?: string;
  activeFile?: string;
  editorCode?: string;
  projectFiles: RunnerProjectFile[];
}): string {
  const header = [`## Runner context`, `Network: ${network || "mainnet"}`];
  if (activeFile) header.push(`Active file: ${activeFile}`);

  if (projectFiles.length === 0) {
    if (!editorCode) return header.join("\n");
    return `${header.join("\n")}\n\n## Current editor code\n\`\`\`cadence\n${editorCode}\n\`\`\``;
  }

  const list = ["## Editable files", ...projectFiles.map((f) => `- ${f.path}`)];

  const fileBlocks: string[] = [];
  let totalChars = 0;
  const MAX_TOTAL_CHARS = 50_000;
  for (const file of projectFiles) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const remaining = MAX_TOTAL_CHARS - totalChars;
    const content =
      file.content.length > remaining
        ? `${file.content.slice(0, remaining)}\n// [truncated]`
        : file.content;
    totalChars += content.length;
    fileBlocks.push(
      `### ${file.path}${activeFile && file.path === activeFile ? " (active)" : ""}\n\`\`\`cadence\n${content}\n\`\`\``
    );
  }

  return `${header.join("\n")}\n\n${list.join("\n")}\n\n## File contents\n${fileBlocks.join("\n\n")}`;
}

export async function POST(req: Request) {
  const {
    messages,
    editorCode,
    projectFiles,
    activeFile,
    network,
    mode: rawMode,
  }: {
    messages: UIMessage[];
    editorCode?: string;
    projectFiles?: RunnerProjectFile[];
    activeFile?: string;
    network?: string;
    mode?: string;
  } = await req.json();

  const mode: ChatMode =
    rawMode && rawMode in MODE_CONFIG ? (rawMode as ChatMode) : "balanced";
  const cfg = MODE_CONFIG[mode];

  const systemWithContext = `${SYSTEM_PROMPT}\n\n${buildProjectContext({
    network,
    activeFile,
    editorCode,
    projectFiles: sanitizeProjectFiles(projectFiles),
  })}`;

  const cadenceMcp = await safeMcpTools(CADENCE_MCP_URL);

  const allTools = {
    ...editorTools,
    ...walletTools,
    ...cadenceMcp.tools,
    loadSkill: createLoadSkillTool(),
  };

  const result = streamText({
    model: anthropic(cfg.model),
    providerOptions: {
      anthropic: {
        contextManagement: {
          edits: [
            {
              type: "compact_20260112" as const,
              trigger: { type: "input_tokens" as const, value: 150_000 },
              instructions:
                "Summarize the conversation concisely. Preserve: code changes made, " +
                "file paths modified, Cadence errors encountered, and user requirements. " +
                "Drop verbose tool outputs and file contents already applied.",
            },
          ],
        },
        ...(cfg.thinking && {
          thinking: { type: "enabled", budgetTokens: 10000 },
        }),
      } satisfies AnthropicLanguageModelOptions,
    },
    system: systemWithContext,
    messages: await convertToModelMessages(messages),
    tools: allTools,
    stopWhen: stepCountIs(10),
    onFinish: async () => {
      await cadenceMcp.client?.close();
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: cfg.thinking,
    messageMetadata({ part }) {
      if (part.type === "finish") {
        const anthropicMetadata = (part as any).providerMetadata?.anthropic;
        return {
          usage: (part as any).totalUsage ?? (part as any).usage,
          model: cfg.model,
          contextManagement: anthropicMetadata?.contextManagement,
        };
      }
      return undefined;
    },
  });
}
