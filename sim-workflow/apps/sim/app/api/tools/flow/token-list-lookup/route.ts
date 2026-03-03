import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch, buildQueryString } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  symbol: z.string().optional(),
  address: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { symbol, address } = Schema.parse(body)

    const addr = address ? address.replace(/^0x/, '').toLowerCase() : undefined
    const qs = buildQueryString({ symbol, address: addr })
    const data = await flowApiFetch<{ data: Array<Record<string, unknown>> }>(
      `/flow/v1/ft/tokens${qs}`
    )
    const tokens = data.data ?? (data as unknown as Array<Record<string, unknown>>)
    const list = Array.isArray(tokens) ? tokens : []

    const summary =
      list.length > 0
        ? `Found ${list.length} token(s): ${list.map((t) => t.symbol || t.name || 'unknown').join(', ')}`
        : 'No tokens found'

    return NextResponse.json({
      success: true,
      output: {
        content: summary,
        tokens: list,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to look up tokens',
      },
      { status: 500 }
    )
  }
}
