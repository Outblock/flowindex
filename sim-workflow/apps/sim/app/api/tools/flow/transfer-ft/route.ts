import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { transferFtCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowTransferFT')

const Schema = z.object({
  recipient: z.string().min(1, 'Recipient address is required'),
  amount: z.string().min(1, 'Amount is required'),
  vaultPath: z.string().min(1, 'Vault storage path is required'),
  receiverPath: z.string().min(1, 'Receiver public path is required'),
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
    const { recipient, amount, vaultPath, receiverPath, signerAddress, signerPrivateKey, network } =
      Schema.parse(body)

    const cadence = transferFtCadence(network, vaultPath, receiverPath)

    logger.info(`Transferring ${amount} FT to ${recipient} on ${network}`)

    const fcl = await import('@onflow/fcl')
    const args = [
      fcl.arg(amount, fcl.t.UFix64),
      fcl.arg(recipient, fcl.t.Address),
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
    logger.error('Failed to transfer FT', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to transfer tokens' },
      { status: 500 }
    )
  }
}
