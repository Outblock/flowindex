import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { addKeyCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowAddKey')

const SIG_ALGO_MAP: Record<string, number> = {
  ECDSA_P256: 1,
  ECDSA_secp256k1: 2,
}

const HASH_ALGO_MAP: Record<string, number> = {
  SHA2_256: 1,
  SHA3_256: 3,
}

const Schema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
  sigAlgo: z.string().optional().default('ECDSA_P256'),
  hashAlgo: z.string().optional().default('SHA3_256'),
  weight: z.string().optional().default('1000'),
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
    const { publicKey, sigAlgo, hashAlgo, weight, signerAddress, signerPrivateKey, network } =
      Schema.parse(body)

    const sigAlgoNum = SIG_ALGO_MAP[sigAlgo]
    const hashAlgoNum = HASH_ALGO_MAP[hashAlgo]

    if (!sigAlgoNum) {
      return NextResponse.json(
        { success: false, error: `Invalid signature algorithm: ${sigAlgo}` },
        { status: 400 }
      )
    }
    if (!hashAlgoNum) {
      return NextResponse.json(
        { success: false, error: `Invalid hash algorithm: ${hashAlgo}` },
        { status: 400 }
      )
    }

    const cadence = addKeyCadence()

    logger.info(`Adding key to ${signerAddress} on ${network}`)

    const fcl = await import('@onflow/fcl')
    const args = [
      fcl.arg(publicKey, fcl.t.String),
      fcl.arg(String(sigAlgoNum), fcl.t.UInt8),
      fcl.arg(String(hashAlgoNum), fcl.t.UInt8),
      fcl.arg(`${weight}.0`, fcl.t.UFix64),
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
    logger.error('Failed to add key', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to add key' },
      { status: 500 }
    )
  }
}
