import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import type { ChatRequest } from '../lib/types.js'
import { createSSEWriter } from '../lib/sse.js'
import { resolveModel } from '../lib/model-map.js'
import { buildMessages, buildContextString } from '../lib/conversation.js'
import { streamChat } from '../lib/claude.js'
import { getAgentConfig, getAgentTools, VALID_AGENT_IDS } from '../agents/index.js'

const app = new Hono()

app.post('/api/subagent/:agentId', async (c) => {
  const agentId = c.req.param('agentId')

  if (!VALID_AGENT_IDS.includes(agentId)) {
    return c.json({ error: `Unknown agent: ${agentId}` }, 400)
  }

  const config = getAgentConfig(agentId)
  if (!config) {
    return c.json({ error: `Agent config not found: ${agentId}` }, 500)
  }

  const req = await c.req.json<ChatRequest>()
  const model = resolveModel(req.model)

  // Build system prompt with context
  let systemPrompt = config.system
  const contextStr = buildContextString(req)
  if (contextStr) {
    systemPrompt += contextStr
  }

  // Build tools: respond tool only (integration tools handled via discovery in main chat)
  const tools = getAgentTools(agentId)

  // Build messages
  const messages = buildMessages(req)

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const writer = createSSEWriter(controller)

      try {
        writer.write({ type: 'subagent_start', subagent: agentId })

        await streamChat(writer, {
          model,
          system: systemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTurns: 10,
          subagentName: agentId,
        })

        writer.write({ type: 'subagent_end', subagent: agentId })
        writer.writeDone()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Subagent error'
        console.error(`[subagent/${agentId}] Error:`, msg)
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
