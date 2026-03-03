import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'
import type { FlowTransaction } from '@/tools/flow/types'

const Schema = z.object({
  id: z.string().min(1, 'Transaction ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { id } = Schema.parse(body)

    const data = await flowApiFetch<{ data: FlowTransaction }>(`/flow/v1/transaction/${id}`)
    const tx = data.data ?? (data as unknown as FlowTransaction)

    return NextResponse.json({
      success: true,
      output: {
        content: `Tx ${tx.id}: status ${tx.status}, proposer ${tx.proposer}, block ${tx.blockHeight}${tx.isEvm ? ' (EVM)' : ''}`,
        id: tx.id,
        blockHeight: String(tx.blockHeight),
        status: tx.status,
        proposer: tx.proposer,
        payer: tx.payer,
        authorizers: tx.authorizers || [],
        isEvm: String(tx.isEvm ?? false),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get transaction',
      },
      { status: 500 }
    )
  }
}
