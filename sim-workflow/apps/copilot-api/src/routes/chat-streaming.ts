import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import type { ChatRequest } from '../lib/types.js'
import { createSSEWriter } from '../lib/sse.js'
import { resolveModel } from '../lib/model-map.js'
import { buildMessages, buildContextString } from '../lib/conversation.js'
import { streamChat, buildToolDiscoveryTool, buildLoadToolTool, ToolRegistry } from '../lib/claude.js'
import { WORKFLOW_TOOLS } from '../lib/workflow-tools.js'
import { MAIN_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from '../agents/prompts/system.js'

const app = new Hono()

app.post('/api/chat-completion-streaming', async (c) => {
  const req = await c.req.json<ChatRequest>()
  const model = resolveModel(req.model)
  const chatId = req.chatId ?? uuid()

  console.log(`[chat] mode=${req.mode} model=${model} integrationTools=${req.integrationTools?.length ?? 0} msg="${req.message.slice(0, 80)}"`)

  // Build tool registry from integration tools (for on-demand discovery)
  const registry = new ToolRegistry(req.integrationTools ?? [])

  // Build system prompt based on mode
  const effectiveMode = req.mode === 'agent' ? 'build' : req.mode
  let systemPrompt: string
  switch (effectiveMode) {
    case 'ask':
      systemPrompt = ASK_SYSTEM_PROMPT
      break
    case 'plan':
      systemPrompt = PLAN_SYSTEM_PROMPT
      break
    default:
      systemPrompt = MAIN_SYSTEM_PROMPT
  }

  // Append context if present
  const contextStr = buildContextString(req)
  if (contextStr) {
    systemPrompt += contextStr
  }

  // Add tool registry summary to system prompt
  if (registry.size > 0) {
    systemPrompt += `\n\n## Available Integration Tools\n\nThere are ${registry.size} integration tools available (Gmail, Slack, X/Twitter, Gemini, etc.). Use \`search_available_tools\` to find tools by keyword, then \`load_tool\` to get the full schema before calling them.\n`
  }

  // Build tools:
  // 1. Workflow tools (edit_workflow, get_blocks_and_tools, etc.) — executed by frontend via mark-complete
  // 2. Integration tool discovery (search_available_tools, load_tool) — executed server-side
  const tools = [
    ...WORKFLOW_TOOLS,
    ...(registry.size > 0 ? [buildToolDiscoveryTool(), buildLoadToolTool()] : []),
  ]

  console.log(`[chat] model=${model} tools=${tools.length} (${WORKFLOW_TOOLS.length} workflow + ${registry.size > 0 ? '2 discovery' : '0'})`)

  // Build messages from conversation history
  const messages = buildMessages(req)

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const writer = createSSEWriter(controller)

      try {
        // Emit initial events
        writer.write({ type: 'chat_id', chatId })
        writer.write({ type: 'start' })

        // Stream the chat
        await streamChat(writer, {
          model,
          system: systemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTurns: 10,
          toolRegistry: registry,
        })

        // Generate title for new chats
        if (!req.chatId && req.message) {
          const title = req.message.slice(0, 50).replace(/\n/g, ' ').trim()
          writer.write({ type: 'title_updated', title })
        }

        writer.writeDone()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Internal error'
        console.error('[chat-streaming] Error:', msg)
        writer.writeError(msg)
      } finally {
        writer.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

export default app
