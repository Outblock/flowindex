import { defineEventHandler, readBody, createError } from 'h3'
import { decodeEvents, buildSummary, buildSummaryItems } from '@flowindex/event-decoder'
import type { RawEvent } from '@flowindex/event-decoder'

const BACKEND_URL = process.env.SIMULATOR_BACKEND_URL || 'http://localhost:9090'

/**
 * POST /api/simulate
 * Decoded simulation — returns human-readable event summaries,
 * token transfers, NFT transfers, system events, and more.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const resp = await fetch(`${BACKEND_URL}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
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

  const success = (data.success ?? false) as boolean
  const error = (data.error ?? (data.message as string) ?? null) as string | null
  const rawEvents = ((data.events as unknown[]) ?? []) as RawEvent[]
  const balanceChanges = (data.balance_changes ?? data.balanceChanges ?? []) as unknown[]
  const computationUsed = (data.computation_used ?? data.computationUsed ?? 0) as number

  // Decode events using the shared event-decoder package
  const cadenceScript = (body as Record<string, unknown>)?.cadence as string | undefined
  const decoded = rawEvents.length > 0 ? decodeEvents(rawEvents, cadenceScript) : null
  const summary = decoded ? buildSummary(decoded) : ''
  const summaryItems = decoded ? buildSummaryItems(decoded) : []

  return {
    success,
    error,
    computationUsed,
    balanceChanges,
    // Decoded output
    summary,
    summaryItems,
    transfers: decoded?.transfers ?? [],
    nftTransfers: decoded?.nftTransfers ?? [],
    evmExecutions: decoded?.evmExecutions ?? [],
    evmLogTransfers: decoded?.evmLogTransfers ?? [],
    systemEvents: decoded?.systemEvents ?? [],
    defiEvents: decoded?.defiEvents ?? [],
    stakingEvents: decoded?.stakingEvents ?? [],
    fee: decoded?.fee ?? 0,
    tags: decoded?.tags ?? [],
    // Raw events still available
    events: rawEvents,
  }
})
