import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction } from '@/app/api/tools/flow/tx-helpers'
import { createAccountCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowCreateAccount')

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
    const { publicKey, sigAlgo, hashAlgo, signerAddress, signerPrivateKey, network } =
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

    const cadence = createAccountCadence()

    logger.info(`Creating account on ${network} with ${sigAlgo}/${hashAlgo}`)

    const fcl = await import('@onflow/fcl')
    const args = [
      fcl.arg(publicKey, fcl.t.String),
      fcl.arg(String(sigAlgoNum), fcl.t.UInt8),
      fcl.arg(String(hashAlgoNum), fcl.t.UInt8),
    ]

    const { txId, txStatus } = await sendTransaction({
      cadence,
      args,
      signerAddress,
      signerPrivateKey,
      network,
    })

    const statusLabel = txStatus.errorMessage ? 'ERROR' : 'SEALED'

    // Try to extract the new account address from events
    let newAddress = ''
    const events = (txStatus as unknown as { events?: Array<{ type: string; data: Record<string, string> }> }).events
    if (events) {
      const accountCreated = events.find(
        (e) => e.type === 'flow.AccountCreated'
      )
      if (accountCreated?.data?.address) {
        newAddress = accountCreated.data.address
      }
    }

    const content = txStatus.errorMessage
      ? `Account creation failed: ${txStatus.errorMessage}`
      : `Account created successfully. Address: ${newAddress || 'unknown'}, TX: ${txId}`

    return NextResponse.json({
      success: true,
      output: {
        content,
        transactionId: txId,
        address: newAddress,
        status: statusLabel,
      },
    })
  } catch (error) {
    logger.error('Failed to create account', { error })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create account',
      },
      { status: 500 }
    )
  }
}
