import { defineEventHandler, readBody, createError } from 'h3'

const BACKEND_URL = process.env.SIMULATOR_BACKEND_URL || 'http://localhost:8080'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const resp = await fetch(`${BACKEND_URL}/flow/v1/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })

  const text = await resp.text()

  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    throw createError({
      statusCode: resp.status || 502,
      statusMessage: text,
    })
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
