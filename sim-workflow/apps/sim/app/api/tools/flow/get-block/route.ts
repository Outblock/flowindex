import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

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

    // Backend only supports /flow/block/{height}
    // If user provides an ID, we can't look it up directly — use height
    const query = height || id
    const path = `/flow/block/${query}`
    const data = await flowApiFetch<{ data: Record<string, unknown>[] | Record<string, unknown> }>(
      path
    )

    // Backend returns { data: [block] } (array)
    const raw = Array.isArray(data.data) ? data.data[0] : data.data
    if (!raw) {
      return NextResponse.json({ success: false, error: 'Block not found' }, { status: 404 })
    }

    const block = raw as Record<string, unknown>
    const blockHeight = String(block.height ?? '')
    const txCount = String(block.tx_count ?? 0)
    const evmTxCount = String(block.evm_tx_count ?? 0)
    const totalGasUsed = String(block.total_gas_used ?? 0)
    const fees = String(block.fees ?? 0)

    return NextResponse.json({
      success: true,
      output: {
        content: `Block ${blockHeight}: ${txCount} txs (${evmTxCount} EVM), gas ${totalGasUsed}, fees ${fees} at ${block.timestamp}`,
        height: blockHeight,
        id: String(block.id ?? ''),
        parentId: String(block.parent_id ?? ''),
        timestamp: String(block.timestamp ?? ''),
        transactionCount: txCount,
        evmTransactionCount: evmTxCount,
        totalGasUsed,
        fees,
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
