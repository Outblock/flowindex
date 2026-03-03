import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

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

    const data = await flowApiFetch<{ data: Array<Record<string, unknown>> }>(
      `/flow/v1/account/${addr}/nft`
    )
    const collections = Array.isArray(data.data) ? data.data : []

    return NextResponse.json({
      success: true,
      output: {
        content: `Account ${addr}: ${collections.length} NFT collection(s)`,
        address: addr,
        collections,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get NFT inventory',
      },
      { status: 500 }
    )
  }
}
