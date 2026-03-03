import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { removeKeyCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowRemoveKey')

const Schema = z.object({
  keyIndex: z.string().min(1, 'Key index is required'),
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
    const { keyIndex, signerAddress, signerPrivateKey, network } = Schema.parse(body)

    const cadence = removeKeyCadence()

    logger.info(`Removing key ${keyIndex} from ${signerAddress} on ${network}`)

    const fcl = await import('@onflow/fcl')
    const args = [fcl.arg(keyIndex, fcl.t.Int)]

    const { txId, txStatus } = await sendTransaction({
      cadence,
      args,
      signerAddress,
      signerPrivateKey,
      network,
    })

    return NextResponse.json({ success: true, output: formatTxResult(txId, txStatus) })
  } catch (error) {
    logger.error('Failed to remove key', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to remove key' },
      { status: 500 }
    )
  }
}
