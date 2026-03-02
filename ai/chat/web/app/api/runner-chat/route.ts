import { createMCPClient } from "@ai-sdk/mcp";
import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";

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

const SYSTEM_PROMPT = `You are a Cadence programming assistant embedded in Cadence Runner.
Your primary job is to help users write, edit, and debug Cadence smart contract code for Flow.

## Response style

- Keep chat concise and implementation-focused.
- For edit/create requests, first provide a short plan of what changed (3-6 bullets max).
- Do not paste large code in explanation text.
- Only show full code in chat when the user explicitly asks to view full code.

## Edit payload format (for editor apply)

When code should be created/modified in the editor, include machine-readable fenced blocks after the short plan.
Use one fenced block per changed file with a relative path in metadata:

\`\`\`cadence path=contracts/MyToken.cdc
// complete file content
\`\`\`

Rules:
- Include \`path=\` (or \`file=\`) metadata for every changed file block.
- Paths must be relative (no leading \`/\`, no \`..\`, no \`deps/\`).
- If only one file is changed, still include path metadata.
- Provide complete file content inside each file block (never partial snippets or unified diff).
- If the user asks a pure question (no code changes), respond without file blocks.

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

Keep responses concise and implementation-focused.`;

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

  const result = streamText({
    model: anthropic(cfg.model),
    ...(cfg.thinking && {
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 10000 },
        },
      },
    }),
    system: systemWithContext,
    messages: await convertToModelMessages(messages),
    tools: {
      ...cadenceMcp.tools,
    },
    stopWhen: stepCountIs(10),
    onFinish: async () => {
      await cadenceMcp.client?.close();
    },
  });

  return result.toUIMessageStreamResponse();
}
