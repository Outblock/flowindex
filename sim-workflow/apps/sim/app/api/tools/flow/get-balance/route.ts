import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch, buildQueryString } from '@/app/api/tools/flow/utils'

interface FtBalance {
  token: string
  balance: string
  symbol?: string
}

const Schema = z.object({
  address: z.string().min(1, 'Address is required'),
  token: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { address, token } = Schema.parse(body)
    const addr = address.replace(/^0x/, '').toLowerCase()

    const qs = buildQueryString({ token })
    const data = await flowApiFetch<{ data: FtBalance[] }>(`/flow/v1/account/${addr}/ft${qs}`)
    const balances = data.data ?? (data as unknown as FtBalance[])
    const list = Array.isArray(balances) ? balances : []

    const summary = list.map((b) => `${b.symbol || b.token}: ${b.balance}`).join(', ')

    return NextResponse.json({
      success: true,
      output: {
        content: `Balances for ${addr}: ${summary || 'none found'}`,
        address: addr,
        balances: list,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get balance',
      },
      { status: 500 }
    )
  }
}
