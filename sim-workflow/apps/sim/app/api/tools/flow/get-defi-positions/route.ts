import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch, buildQueryString } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  address: z.string().min(1, 'Address is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { address } = Schema.parse(body)
    const addr = address.replace(/^0x/, '').toLowerCase()

    const data = await flowApiFetch<{ data?: Array<Record<string, unknown>>; positions?: Array<Record<string, unknown>> }>(
      `/defi/events${buildQueryString({ address: addr })}`
    )
    const positions = data.data ?? data.positions ?? []

    return NextResponse.json({
      success: true,
      output: {
        content: `DeFi positions for ${addr}: ${positions.length} position(s)`,
        address: addr,
        positions,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get DeFi positions',
      },
      { status: 500 }
    )
  }
}
