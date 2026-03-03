import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { batchTransferCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowBatchTransfer')

const Schema = z.object({
  recipients: z.string().min(1, 'Recipients JSON is required'),
  signerAddress: z.string().min(1, 'Signer address is required'),
  signerPrivateKey: z.string().min(1, 'Signer private key is required'),
  network: z.string().optional().default('mainnet'),
})

interface Recipient {
  address: string
  amount: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { recipients: recipientsJson, signerAddress, signerPrivateKey, network } =
      Schema.parse(body)

    let recipients: Recipient[]
    try {
      recipients = JSON.parse(recipientsJson) as Recipient[]
      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error('Recipients must be a non-empty array')
      }
      for (const r of recipients) {
        if (!r.address || !r.amount) {
          throw new Error('Each recipient must have "address" and "amount" fields')
        }
      }
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid recipients JSON: ${e instanceof Error ? e.message : 'parse error'}`,
        },
        { status: 400 }
      )
    }

    if (recipients.length > 50) {
      return NextResponse.json(
        { success: false, error: 'Maximum 50 recipients per batch transfer' },
        { status: 400 }
      )
    }

    const cadence = batchTransferCadence(network, recipients.length)

    logger.info(`Batch transferring FLOW to ${recipients.length} recipients on ${network}`)

    const fcl = await import('@onflow/fcl')

    // Build args: a0, a1, ..., m0, m1, ...
    const args: unknown[] = []
    for (const r of recipients) {
      args.push(fcl.arg(r.address, fcl.t.Address))
    }
    for (const r of recipients) {
      args.push(fcl.arg(r.amount, fcl.t.UFix64))
    }

    const { txId, txStatus } = await sendTransaction({
      cadence,
      args,
      signerAddress,
      signerPrivateKey,
      network,
    })

    return NextResponse.json({ success: true, output: formatTxResult(txId, txStatus) })
  } catch (error) {
    logger.error('Batch transfer failed', { error })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Batch transfer failed',
      },
      { status: 500 }
    )
  }
}
