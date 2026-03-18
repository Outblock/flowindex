import { Hono } from 'hono'
import type { MarkCompleteRequest } from '../lib/types.js'
import { toolState } from '../lib/tool-state.js'

const app = new Hono()

app.post('/api/tools/mark-complete', async (c) => {
  const body = await c.req.json<MarkCompleteRequest>()
  const { id, name, status, message, data } = body

  if (!id || !name) {
    return c.json({ ok: false, error: 'Missing id or name' }, 400)
  }

  console.log(`[mark-complete] id=${id} name=${name} status=${status} hasData=${!!data} hasMsg=${!!message}`)
  if (data) {
    const preview = JSON.stringify(data).slice(0, 200)
    console.log(`[mark-complete] data: ${preview}`)
  }
  if (message) {
    const preview = typeof message === 'string' ? message.slice(0, 200) : JSON.stringify(message).slice(0, 200)
    console.log(`[mark-complete] message: ${preview}`)
  }

  const resolved = toolState.complete(id, status, data, message)

  if (!resolved) {
    console.warn(`[mark-complete] No pending tool for id=${id} name=${name}`)
  } else {
    console.log(`[mark-complete] Resolved ${name} → status=${status}`)
  }

  return c.json({ ok: true })
})

export default app
