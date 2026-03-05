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

const SYSTEM_PROMPT = `You are a Cadence programming assistant embedded in Cadence Runner.
Your primary job is to help users write, edit, and debug Cadence smart contract code for Flow.

## Response style

- Keep chat concise and implementation-focused.
- For edit/create requests, briefly explain what you will change (3-6 bullets max), then use the editor tools.
- **Never paste full file code in chat text.** Use the editor tools to write code into files.
- Only show short code snippets in chat when explaining concepts or answering questions.

## Editor tools

You have editor tools that directly manipulate project files. The user reviews changes via a diff view in the editor. **Always use these tools for any file operation — never output raw code blocks with path metadata.**

- \`list_files\` — see what files exist in the project.
- \`read_file(path)\` — read a file before editing. Always read first so you know the current content.
- \`create_file(path, content)\` — create a brand-new file with full content.
- \`update_file(path, content)\` — rewrite an existing file. Provide the complete new file content. The editor shows a diff for the user to review.
- \`edit_file(path, patches)\` — apply targeted search/replace patches to an existing file. Each patch has \`search\` (exact text to find) and \`replace\` (replacement text). Prefer this over \`update_file\` for small edits.
- \`delete_file(path)\` — remove a file.
- \`set_active_file(path)\` — switch the editor tab to a specific file.

Workflow:
1. Use \`list_files\` or \`read_file\` to understand the current code.
2. Explain your plan briefly in chat.
3. Use \`create_file\`, \`update_file\`, or \`edit_file\` to make changes. The user will see a diff and can accept or reject.
4. If the user asks a question with no code changes, just answer in chat text.

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
    ...cadenceMcp.tools,
    loadSkill: createLoadSkillTool(),
  };

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
    tools: allTools,
    stopWhen: stepCountIs(10),
    onFinish: async () => {
      await cadenceMcp.client?.close();
    },
  });

  return result.toUIMessageStreamResponse();
}
