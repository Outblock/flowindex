import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'
import type { FlowAccountInfo } from '@/tools/flow/types'

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

    const data = await flowApiFetch<{ data: FlowAccountInfo }>(`/flow/v1/account/${addr}`)
    const account = data.data ?? (data as unknown as FlowAccountInfo)

    const contractNames = Array.isArray(account.contracts) ? account.contracts : []

    return NextResponse.json({
      success: true,
      output: {
        content: `Account ${addr}: balance ${account.balance || '0'} FLOW, ${contractNames.length} contracts`,
        address: addr,
        balance: String(account.balance || '0'),
        keys: account.keys || [],
        contracts: contractNames,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get account',
      },
      { status: 500 }
    )
  }
}
