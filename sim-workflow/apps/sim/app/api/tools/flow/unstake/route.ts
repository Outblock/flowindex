import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { unstakeCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowUnstake')

const Schema = z.object({
  amount: z.string().min(1, 'Amount is required'),
  signerAddress: z.string().min(1, 'Signer address is required'),
  signerPrivateKey: z.string().min(1, 'Signer private key is required'),
  network: z.string().optional().default('mainnet'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { amount, signerAddress, signerPrivateKey, network } = Schema.parse(body)

    const cadence = unstakeCadence(network)

    logger.info(`Unstaking ${amount} FLOW on ${network}`)

    const fcl = await import('@onflow/fcl')
    // Pass empty nodeID and nil delegatorID — the staking collection figures out the right one
    const args = [
      fcl.arg('', fcl.t.String),
      fcl.arg(null, fcl.t.Optional(fcl.t.UInt32)),
      fcl.arg(amount, fcl.t.UFix64),
    ]

    const { txId, txStatus } = await sendTransaction({
      cadence,
      args,
      signerAddress,
      signerPrivateKey,
      network,
    })

    return NextResponse.json({ success: true, output: formatTxResult(txId, txStatus) })
  } catch (error) {
    logger.error('Failed to unstake FLOW', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to unstake FLOW' },
      { status: 500 }
    )
  }
}
