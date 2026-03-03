import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  address: z.string().min(1, 'Address is required'),
  contractName: z.string().min(1, 'Contract name is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { address, contractName } = Schema.parse(body)
    const addr = address.replace(/^0x/, '').toLowerCase()

    const data = await flowApiFetch<{ data?: { code?: string }; code?: string }>(
      `/flow/v1/account/${addr}/contract/${contractName}`
    )
    const code = data.data?.code ?? data.code ?? ''

    return NextResponse.json({
      success: true,
      output: {
        content: `Contract ${contractName} on ${addr}: ${code.length} bytes of Cadence source`,
        address: addr,
        contractName,
        code,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get contract code',
      },
      { status: 500 }
    )
  }
}
