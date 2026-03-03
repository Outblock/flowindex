import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch, buildQueryString } from '@/app/api/tools/flow/utils'
import type { FlowEvent } from '@/tools/flow/types'

const Schema = z.object({
  eventType: z.string().min(1, 'Event type is required'),
  startHeight: z.string().optional(),
  endHeight: z.string().optional(),
  limit: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { eventType, startHeight, endHeight, limit } = Schema.parse(body)

    const qs = buildQueryString({
      type: eventType,
      start_height: startHeight,
      end_height: endHeight,
      limit: limit || '100',
    })
    const data = await flowApiFetch<{ data: FlowEvent[]; _meta?: { count?: number } }>(
      `/flow/v1/events/search${qs}`
    )
    const events = data.data ?? (data as unknown as FlowEvent[])
    const list = Array.isArray(events) ? events : []

    return NextResponse.json({
      success: true,
      output: {
        content: `Found ${list.length} events of type ${eventType}`,
        events: list,
        count: String(list.length),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get events',
      },
      { status: 500 }
    )
  }
}
