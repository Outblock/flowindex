import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  nftType: z.string().min(1, 'NFT type is required'),
  nftId: z.string().min(1, 'NFT ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { nftType, nftId } = Schema.parse(body)

    const data = await flowApiFetch<{ data: Record<string, unknown> }>(
      `/flow/v1/nft/${encodeURIComponent(nftType)}/item/${encodeURIComponent(nftId)}`
    )
    const nft = data.data ?? (data as unknown as Record<string, unknown>)

    return NextResponse.json({
      success: true,
      output: {
        content: `NFT ${nftType} #${nftId}: owner ${(nft.owner as string) || 'unknown'}`,
        nftType,
        nftId,
        metadata: nft,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get NFT',
      },
      { status: 500 }
    )
  }
}
