import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { transferNftCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowTransferNFT')

const Schema = z.object({
  recipient: z.string().min(1, 'Recipient address is required'),
  nftId: z.string().min(1, 'NFT ID is required'),
  collectionStoragePath: z.string().min(1, 'Collection storage path is required'),
  collectionPublicPath: z.string().min(1, 'Collection public path is required'),
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
    const {
      recipient,
      nftId,
      collectionStoragePath,
      collectionPublicPath,
      signerAddress,
      signerPrivateKey,
      network,
    } = Schema.parse(body)

    const cadence = transferNftCadence(network, collectionStoragePath, collectionPublicPath)

    logger.info(`Transferring NFT #${nftId} to ${recipient} on ${network}`)

    const fcl = await import('@onflow/fcl')
    const args = [
      fcl.arg(recipient, fcl.t.Address),
      fcl.arg(nftId, fcl.t.UInt64),
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
    logger.error('Failed to transfer NFT', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to transfer NFT' },
      { status: 500 }
    )
  }
}
