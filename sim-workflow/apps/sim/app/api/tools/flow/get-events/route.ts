import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch, buildQueryString } from '@/app/api/tools/flow/utils'

interface EventSearchResult {
  type: string
  contract_address: string
  contract_name: string
  event_name: string
  count: number
}

const Schema = z.object({
  eventType: z.string().min(1, 'Event type / search term is required'),
  limit: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { eventType, limit } = Schema.parse(body)

    const qs = buildQueryString({
      name: eventType,
      limit: limit || '20',
    })
    const data = await flowApiFetch<{ data: EventSearchResult[]; _meta?: { count?: number } }>(
      `/flow/events/search${qs}`
    )
    const events = data.data ?? (data as unknown as EventSearchResult[])
    const list = Array.isArray(events) ? events : []

    const summary = list
      .map((e) => `${e.type} (${e.count} occurrences)`)
      .join(', ')

    return NextResponse.json({
      success: true,
      output: {
        content: list.length > 0
          ? `Found ${list.length} event types matching "${eventType}": ${summary}`
          : `No events found matching "${eventType}"`,
        events: list,
        count: String(list.length),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search events',
      },
      { status: 500 }
    )
  }
}
