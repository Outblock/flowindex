import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  collectionIdentifier: z.string().min(1, 'Collection identifier is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { collectionIdentifier } = Schema.parse(body)

    const data = await flowApiFetch<Record<string, unknown>>(
      `/flow/v1/nft/collections/${encodeURIComponent(collectionIdentifier)}`
    )

    const collection = data.data ?? data
    const name = (collection as Record<string, unknown>).name || collectionIdentifier

    return NextResponse.json({
      success: true,
      output: {
        content: `NFT collection: ${name}`,
        collection,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to look up NFT collection',
      },
      { status: 500 }
    )
  }
}
