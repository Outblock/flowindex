# FlowIndex Copilot API — Replace copilot.sim.ai

**Date:** 2026-03-18
**Status:** Draft
**Branch:** test-backup

## Problem

The sim-workflow copilot connects to `copilot.sim.ai`, a closed-source Go backend. Issues:
- LLM quality inconsistent
- Pricing opaque
- No control over model selection or prompt tuning

## Goal

Replace `copilot.sim.ai` with our own backend service that:
1. Uses Claude (via `@anthropic-ai/sdk`) directly — full cost transparency
2. Speaks the exact same SSE protocol — zero frontend changes
3. Implements all 16 subagents with dedicated prompts
4. Handles the tool call loop (emit tool_call → wait for mark-complete → feed result back to Claude)

## Architecture

```
sim-workflow frontend (unchanged)
  SIM_AGENT_API_URL → http://localhost:4000 (dev) or https://copilot.flowindex.io (prod)
        │
        ▼
flowindex-copilot (new service, port 4000)
  ├── POST /api/chat-completion-streaming   (main chat)
  ├── POST /api/tools/mark-complete         (tool result callback)
  ├── POST /api/subagent/{agentId}          (16 subagents)
  └── POST /api/generate-chat-title         (title generation)
        │
        ▼
  @anthropic-ai/sdk → Claude API
```

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **HTTP framework:** Hono (lightweight, SSE-native, TypeScript-first)
- **LLM SDK:** `@anthropic-ai/sdk` (direct Claude Messages API)
- **No database** — stateless; conversation history comes from frontend payload

## Directory Structure

```
sim-workflow/apps/copilot-api/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Hono app + server entry
│   ├── routes/
│   │   ├── chat-streaming.ts    # POST /api/chat-completion-streaming
│   │   ├── mark-complete.ts     # POST /api/tools/mark-complete
│   │   ├── subagent.ts          # POST /api/subagent/:agentId
│   │   └── title.ts             # POST /api/generate-chat-title
│   ├── lib/
│   │   ├── claude.ts            # Anthropic SDK wrapper + streaming
│   │   ├── sse.ts               # SSE event formatting helpers
│   │   ├── tool-state.ts        # Pending tool call state (in-memory Map)
│   │   ├── model-map.ts         # Model name resolution
│   │   └── conversation.ts      # Conversation history → Claude messages
│   └── agents/
│       ├── index.ts             # Agent registry + router
│       ├── prompts/
│       │   ├── system.ts        # Main chat system prompt
│       │   ├── build.ts         # Build subagent
│       │   ├── edit.ts          # Edit subagent
│       │   ├── debug.ts         # Debug subagent
│       │   ├── plan.ts          # Plan subagent
│       │   ├── deploy.ts        # Deploy subagent
│       │   ├── test.ts          # Test subagent
│       │   ├── research.ts      # Research subagent
│       │   ├── auth.ts          # Auth subagent
│       │   ├── knowledge.ts     # Knowledge subagent
│       │   ├── custom-tool.ts   # Custom tool subagent
│       │   ├── tour.ts          # Tour subagent
│       │   ├── info.ts          # Info subagent
│       │   ├── workflow.ts      # Workflow subagent
│       │   ├── evaluate.ts      # Evaluate subagent
│       │   ├── superagent.ts    # Superagent subagent
│       │   └── discovery.ts     # Discovery subagent
│       └── tools.ts             # Per-agent tool definitions
└── Dockerfile
```

## API Contract

### POST /api/chat-completion-streaming

**Request body** (forwarded from sim-workflow):
```typescript
{
  message: string
  workflowId: string
  userId: string
  model: string                          // e.g. "claude-sonnet-4-6"
  mode: "agent" | "ask" | "plan"
  messageId: string
  version: string                        // "3.0.0"
  context?: Array<{ type: string; content: string }>
  conversationHistory?: ConversationMessage[]
  chatId?: string
  conversationId?: string
  integrationTools?: ToolSchema[]
  credentials?: CredentialsPayload
  fileAttachments?: FileContent[]
  commands?: string[]
  prefetch?: boolean
  implicitFeedback?: string
}
```

**SSE output events:**

| Event type | Fields | When |
|---|---|---|
| `chat_id` | `chatId` | Start of stream |
| `start` | — | Stream begins |
| `content` | `content` | Text tokens |
| `reasoning` | `content`, `phase:"thinking"` | Extended thinking |
| `tool_call` | `toolCallId`, `toolName`, `data:{params}` | Claude wants to call a tool |
| `tool_result` | `toolCallId`, `success`, `result` | Tool completed (after mark-complete) |
| `tool_error` | `toolCallId`, `error` | Tool failed |
| `subagent_start` | `subagent`, `toolCallId` | Starting a subagent |
| `subagent_end` | `subagent` | Subagent finished |
| `title_updated` | `title` | Auto-generated title |
| `done` | — | Stream complete |
| `error` | `error` | Fatal error |

### POST /api/tools/mark-complete

**Request:** `{ id: string, name: string, status: 200|500|202, message?: any, data?: any }`
**Response:** `{ ok: true }`

Resolves a pending Promise in the in-memory tool state map, allowing the Claude tool loop to continue.

### POST /api/subagent/:agentId

Same request/response format as chat-streaming. Uses a different system prompt and tool set based on `agentId`.

Valid agentIds: `debug`, `edit`, `build`, `plan`, `test`, `deploy`, `auth`, `research`, `knowledge`, `custom_tool`, `tour`, `info`, `workflow`, `evaluate`, `superagent`, `discovery`

### POST /api/generate-chat-title

**Request:** `{ message: string, model: string }`
**Response:** `{ title: string }`

## Core Flow: Tool Call Loop

```
1. Claude streams response → we emit SSE `content` events
2. Claude outputs tool_use block → we emit SSE `tool_call` event
3. We pause Claude streaming, create a Promise in pendingTools Map
4. Frontend executes tool → calls POST /api/tools/mark-complete
5. mark-complete handler resolves the Promise with tool result
6. We feed tool_result back to Claude as a new message
7. Claude continues → more content or more tool calls
8. Repeat until Claude sends stop_reason: "end_turn"
9. Emit SSE `done` event
```

```typescript
// Simplified implementation
const pendingTools = new Map<string, {
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
}>()

async function waitForToolResult(toolCallId: string): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tool timeout')), 300_000)
    pendingTools.set(toolCallId, {
      resolve: (result) => { clearTimeout(timeout); resolve(result) },
      reject: (error) => { clearTimeout(timeout); reject(error) },
    })
  })
}

// In mark-complete handler:
function handleMarkComplete(id, status, data) {
  const pending = pendingTools.get(id)
  if (pending) {
    pending.resolve({ success: status === 200, output: data })
    pendingTools.delete(id)
  }
}
```

## Subagent Design

Each subagent = same Claude API call with:
- Different `system` prompt (from `agents/prompts/{agentId}.ts`)
- Different `tools` array (from `agents/tools.ts`)
- Same SSE output protocol

The main chat agent has access to 16 "subagent tools" (e.g., `build`, `debug`). When Claude calls one:
1. We emit `tool_call` with `toolName: "build"`
2. Frontend sees it's a SUBAGENT_TOOL, sends request to `/api/subagent/build`
3. Subagent runs its own Claude conversation loop
4. Subagent emits SSE events (prefixed with `subagent: "build"`)
5. When subagent finishes, frontend calls mark-complete for the parent tool call

## Model Mapping

```typescript
const MODEL_MAP: Record<string, string> = {
  // Pass-through for explicit Claude models
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  // Map generic names
  'sonnet': 'claude-sonnet-4-6',
  'opus': 'claude-opus-4-6',
  'haiku': 'claude-haiku-4-5-20251001',
}
// Default: claude-sonnet-4-6
```

## Integration Tool Forwarding

The payload includes `integrationTools[]` — these are tool schemas for user-installed tools (Gmail, Slack, X, Gemini, etc.). We register them as Claude tools so Claude can call them. When Claude invokes one:
1. Emit `tool_call` SSE event
2. Frontend orchestrator handles execution (OAuth, API calls)
3. Frontend calls mark-complete with result
4. We feed result back to Claude

We do NOT execute these tools ourselves — the frontend handles all integration tool execution.

## Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...     # Required
PORT=4000                         # Default 4000
COPILOT_API_KEY=<shared-secret>   # Optional, for x-api-key validation
```

## Local Testing

```bash
# Terminal 1: Start copilot API
cd sim-workflow/apps/copilot-api
bun install
bun run dev  # → http://localhost:4000

# Terminal 2: Start sim-workflow with our copilot
cd sim-workflow
SIM_AGENT_API_URL=http://localhost:4000 bun run dev
```

## Implementation Plan (high-level)

1. Scaffold project (package.json, tsconfig, Hono app)
2. Implement SSE helpers + Claude streaming wrapper
3. Implement tool state management (pending tools Map)
4. Implement `/api/chat-completion-streaming` with tool loop
5. Implement `/api/tools/mark-complete`
6. Implement `/api/subagent/:agentId` with 16 agent prompts
7. Implement `/api/generate-chat-title`
8. Local testing with sim-workflow
9. Iterate on subagent prompts for quality
10. PR to main

## Out of Scope (for now)

- Conversation persistence (frontend already handles via DB)
- Stream resume / Redis buffering (frontend handles via existing buffer)
- Backend-only tools (search_patterns, search_errors, remember_debug) — will add as needed
- Production deployment (Dockerfile, GCP VM) — after local testing passes
