import { defineEventHandler, readBody, createError } from 'h3'

const BACKEND_URL = process.env.SIMULATOR_BACKEND_URL || 'http://localhost:8080'
const MAX_RETRIES = 5
const RETRY_DELAY_MS = 800

function isPendingBlockError(data: Record<string, unknown>): boolean {
  const err = (data.error ?? data.message ?? '') as string
  return err.includes('pending block') && err.includes('currently being executed')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callBackend(body: unknown): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BACKEND_URL}/flow/v1/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await resp.text()

  try {
    return JSON.parse(text)
  } catch {
    throw createError({
      statusCode: resp.status || 502,
      statusMessage: text,
    })
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  let data: Record<string, unknown> = {}

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    data = await callBackend(body)

    if (!isPendingBlockError(data) || attempt === MAX_RETRIES) break

    await sleep(RETRY_DELAY_MS * (attempt + 1))
  }

  // Normalize snake_case → camelCase and always return JSON
  return {
    success: data.success ?? false,
    error: data.error ?? (data.message as string) ?? null,
    events: (data.events as unknown[]) ?? [],
    balanceChanges: (data.balance_changes ?? data.balanceChanges ?? []) as unknown[],
    computationUsed: (data.computation_used ?? data.computationUsed ?? 0) as number,
  }
})
