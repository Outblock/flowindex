import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'
import type { FlowBlock } from '@/tools/flow/types'

const Schema = z
  .object({
    height: z.string().optional(),
    id: z.string().optional(),
  })
  .refine((d) => d.height || d.id, { message: 'Either height or id is required' })

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { height, id } = Schema.parse(body)

    const path = id ? `/flow/v1/block/id/${id}` : `/flow/v1/block/${height}`
    const data = await flowApiFetch<{ data: FlowBlock }>(path)
    const block = data.data ?? (data as unknown as FlowBlock)

    return NextResponse.json({
      success: true,
      output: {
        content: `Block ${block.height}: ${block.transactionCount} txs at ${block.timestamp}`,
        height: String(block.height),
        id: block.id,
        parentId: block.parentId,
        timestamp: block.timestamp,
        transactionCount: String(block.transactionCount),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get block',
      },
      { status: 500 }
    )
  }
}
