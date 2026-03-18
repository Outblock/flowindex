import { Hono } from 'hono'

const app = new Hono()

const AVAILABLE_MODELS = [
  {
    id: 'claude-haiku-4-5-20251001',
    friendlyName: 'Claude Haiku 4.5',
    provider: 'anthropic',
  },
  {
    id: 'claude-sonnet-4-6',
    friendlyName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-6',
    friendlyName: 'Claude Opus 4.6',
    provider: 'anthropic',
  },
]

app.get('/api/get-available-models', (c) => {
  return c.json({ models: AVAILABLE_MODELS })
})

export default app
