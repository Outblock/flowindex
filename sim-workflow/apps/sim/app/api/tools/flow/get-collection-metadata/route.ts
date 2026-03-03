import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  nftType: z.string().min(1, 'NFT type is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { nftType } = Schema.parse(body)

    const data = await flowApiFetch<{ data?: Record<string, unknown>; metadata?: Record<string, unknown> }>(
      `/flow/v1/nft/${encodeURIComponent(nftType)}`
    )
    const metadata = data.data ?? data.metadata ?? {}

    const name = (metadata as Record<string, unknown>).name ?? nftType
    const totalSupply = (metadata as Record<string, unknown>).totalSupply ?? 'unknown'

    return NextResponse.json({
      success: true,
      output: {
        content: `NFT collection ${name}: total supply ${totalSupply}`,
        nftType,
        metadata,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get collection metadata',
      },
      { status: 500 }
    )
  }
}
