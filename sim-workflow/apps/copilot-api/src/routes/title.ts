import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import type { TitleRequest } from '../lib/types.js'
import { resolveModel } from '../lib/model-map.js'

const anthropic = new Anthropic()
const app = new Hono()

app.post('/api/generate-chat-title', async (c) => {
  const body = await c.req.json<TitleRequest>()
  const model = resolveModel(body.model)

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 50,
      system: 'Generate a concise chat title (max 6 words) for this conversation. Return ONLY the title, no quotes or punctuation.',
      messages: [{ role: 'user', content: body.message }],
    })

    const text = response.content[0]
    const title = text?.type === 'text' ? text.text.trim() : body.message.slice(0, 50)

    return c.json({ title })
  } catch (err) {
    console.error('[title] Error:', err)
    // Fallback: truncate the message
    return c.json({ title: body.message.slice(0, 50).replace(/\n/g, ' ').trim() })
  }
})

export default app
