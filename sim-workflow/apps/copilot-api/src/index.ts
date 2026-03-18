import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import chatStreaming from './routes/chat-streaming.js'
import markComplete from './routes/mark-complete.js'
import subagent from './routes/subagent.js'
import title from './routes/title.js'
import models from './routes/models.js'

const app = new Hono()

// CORS — allow sim-workflow dev server
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'https://sim.flowindex.io'],
  allowHeaders: ['Content-Type', 'x-api-key'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}))

// Optional API key validation
app.use('/api/*', async (c, next) => {
  const apiKey = process.env.COPILOT_API_KEY
  if (apiKey) {
    const provided = c.req.header('x-api-key')
    if (provided && provided !== apiKey) {
      return c.json({ error: 'Invalid API key' }, 401)
    }
    // If no key provided, allow through (sim-workflow may not send it in dev)
  }
  await next()
})

// Health check
app.get('/health', (c) => c.json({ ok: true, service: 'flowindex-copilot' }))

// Mount routes
app.route('/', chatStreaming)
app.route('/', markComplete)
app.route('/', subagent)
app.route('/', title)
app.route('/', models)

// Start server
const port = parseInt(process.env.PORT ?? '4000', 10)

console.log(`\n  flowindex-copilot`)
console.log(`  → http://localhost:${port}`)
console.log(`  → Health:  http://localhost:${port}/health`)
console.log(`  → Chat:    POST /api/chat-completion-streaming`)
console.log(`  → Tools:   POST /api/tools/mark-complete`)
console.log(`  → Models:  GET  /api/get-available-models`)
console.log(`  → Title:   POST /api/generate-chat-title\n`)

serve({ fetch: app.fetch, port })
