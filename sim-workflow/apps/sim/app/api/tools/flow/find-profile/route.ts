import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  name: z.string().min(1, 'Name is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { name } = Schema.parse(body)

    // Strip .find suffix if user included it
    const cleanName = name.replace(/\.find$/i, '').trim()

    const data = await flowApiFetch<Record<string, unknown>>(
      `/flow/v1/resolve/${encodeURIComponent(cleanName)}`
    )

    const profile = data.data ?? data
    const address = (profile as Record<string, unknown>).address || 'not found'

    return NextResponse.json({
      success: true,
      output: {
        content: `${cleanName}.find resolves to ${address}`,
        profile,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to look up .find profile',
      },
      { status: 500 }
    )
  }
}
