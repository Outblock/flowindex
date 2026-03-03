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

    const data = await flowApiFetch<{ data: { address: string } }>(
      `/flow/v1/account/${encodeURIComponent(name)}`
    )
    const account = data.data ?? (data as unknown as { address: string })
    const address = account.address || ''

    return NextResponse.json({
      success: true,
      output: {
        content: `${name} resolves to ${address || 'unknown'}`,
        name,
        address,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve name',
      },
      { status: 500 }
    )
  }
}
