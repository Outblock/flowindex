import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

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

    const data = await flowApiFetch<{ data: Record<string, unknown>[] | Record<string, unknown> }>(
      `/flow/transaction/${id}`
    )

    // Backend may return { data: [tx] } or { data: tx }
    const raw = Array.isArray(data.data) ? data.data[0] : data.data
    if (!raw) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      )
    }

    const tx = raw as Record<string, unknown>
    const events = (tx.events as Record<string, unknown>[]) || []
    const args = (tx.arguments as Record<string, unknown>[]) || []
    const authorizers = (tx.authorizers as string[]) || []
    const contractImports = (tx.contract_imports as string[]) || []
    const blockHeight = String(tx.block_height ?? '')
    const eventCount = String(tx.event_count ?? events.length)
    const gasLimit = String(tx.gas_limit ?? '')
    const fee = String(tx.fee ?? '')
    const status = String(tx.status ?? 'sealed')
    const isEvm = Boolean(tx.is_evm)
    const error = String(tx.error ?? '')

    const lines = [`Tx ${tx.id}: status ${status}, proposer ${tx.proposer}, block ${blockHeight}`]
    if (isEvm) lines.push(`EVM hash: ${tx.evm_hash}`)
    if (error) lines.push(`Error: ${error}`)
    lines.push(`Events: ${eventCount}, Fee: ${fee} FLOW`)

    return NextResponse.json({
      success: true,
      output: {
        content: lines.join('\n'),
        id: String(tx.id ?? ''),
        blockHeight,
        status,
        proposer: String(tx.proposer ?? ''),
        payer: String(tx.payer ?? ''),
        authorizers,
        gasLimit,
        fee,
        eventCount,
        error,
        isEvm: String(isEvm),
        evmHash: String(tx.evm_hash ?? ''),
        contractImports,
        arguments: JSON.stringify(args),
        events: JSON.stringify(events),
        timestamp: String(tx.timestamp ?? ''),
        script: String(tx.script ?? ''),
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
