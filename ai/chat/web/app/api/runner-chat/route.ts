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

const SYSTEM_PROMPT = `You are a Cadence programming assistant embedded in a code editor (Cadence Runner).
Your primary job is to help users write, edit, and debug Cadence smart contract code for the Flow blockchain.

## How you work

The user's current editor code is provided as context with each message. When they ask you to modify, fix, or write code:

1. **Always return the COMPLETE updated code** wrapped in a single \`\`\`cadence code block
2. The code block will have a "Replace" button the user can click to replace their editor content
3. If the user asks a question (not a code change), respond conversationally without a code block

## Code guidelines

- Write modern Cadence 1.0 syntax (access(all), not pub)
- Use proper entitlements and capabilities
- Scripts must have \`access(all) fun main()\` entry point
- Transactions need \`transaction { prepare(signer: auth(Storage) &Account) { } execute { } }\`
- Import core contracts using mainnet addresses:
  - FungibleToken: 0xf233dcee88fe0abe
  - NonFungibleToken: 0x1d7e57aa55817448
  - MetadataViews: 0x1d7e57aa55817448
  - FlowToken: 0x1654653399040a61
  - FUSD: 0x3c5959b568896393

## When fixing errors

The user may paste error messages. Analyze the error, explain what went wrong briefly, then provide the corrected complete code in a cadence code block.

## When writing new code

If the user asks to write something from scratch, provide the complete runnable code. Add brief comments explaining key parts.

Keep responses concise. Prioritize working code over long explanations.`;

export async function POST(req: Request) {
  const {
    messages,
    editorCode,
    network,
    mode: rawMode,
  }: {
    messages: UIMessage[];
    editorCode?: string;
    network?: string;
    mode?: string;
  } = await req.json();

  const mode: ChatMode =
    rawMode && rawMode in MODE_CONFIG ? (rawMode as ChatMode) : "balanced";
  const cfg = MODE_CONFIG[mode];

  // Prepend editor context to the conversation
  const systemWithContext = editorCode
    ? `${SYSTEM_PROMPT}\n\n## Current editor code (${network || "mainnet"}):\n\`\`\`cadence\n${editorCode}\n\`\`\``
    : SYSTEM_PROMPT;

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
