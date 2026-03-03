import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { SHA3 } from 'sha3'
import { ec as EC } from 'elliptic'

const logger = createLogger('FlowSendTransaction')

const ACCESS_NODES: Record<string, string> = {
  mainnet: 'https://rest-mainnet.onflow.org',
  testnet: 'https://rest-testnet.onflow.org',
}

const Schema = z.object({
  script: z.string().min(1, 'Transaction script is required'),
  arguments: z.string().optional().default('[]'),
  signerAddress: z.string().min(1, 'Signer address is required'),
  signerPrivateKey: z.string().min(1, 'Signer private key is required'),
  network: z.string().optional().default('mainnet'),
})

function signWithKey(privateKey: string, message: string): string {
  const ec = new EC('p256')
  const key = ec.keyFromPrivate(Buffer.from(privateKey, 'hex'))
  const sha3 = new SHA3(256)
  sha3.update(Buffer.from(message, 'hex'))
  const digest = sha3.digest()
  const sig = key.sign(digest)
  const r = sig.r.toArrayLike(Buffer, 'be', 32)
  const s = sig.s.toArrayLike(Buffer, 'be', 32)
  return Buffer.concat([r, s]).toString('hex')
}

/**
 * Creates an FCL-compatible authorization function for signing transactions.
 * Uses `unknown` cast because FCL's authorization types are complex and
 * not fully compatible with standard function signatures.
 */
function createAuthz(
  fcl: typeof import('@onflow/fcl'),
  address: string,
  privateKey: string,
  keyIndex: number = 0
) {
  const authzFn = async (account: Record<string, unknown>) => ({
    ...account,
    tempId: `${address}-${keyIndex}`,
    addr: fcl.sansPrefix(address),
    keyId: keyIndex,
    signingFunction: async (signable: { message: string }) => ({
      addr: fcl.sansPrefix(address),
      keyId: keyIndex,
      signature: signWithKey(privateKey, signable.message),
    }),
  })
  return authzFn
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { script, arguments: argsJson, signerAddress, signerPrivateKey, network } =
      Schema.parse(body)

    const accessNode = ACCESS_NODES[network]
    if (!accessNode) {
      return NextResponse.json(
        { success: false, error: `Invalid network: ${network}. Use "mainnet" or "testnet".` },
        { status: 400 }
      )
    }

    let parsedArgs: unknown[]
    try {
      parsedArgs = JSON.parse(argsJson) as unknown[]
      if (!Array.isArray(parsedArgs)) {
        throw new Error('Arguments must be a JSON array')
      }
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid arguments JSON: ${parseError instanceof Error ? parseError.message : 'parse error'}`,
        },
        { status: 400 }
      )
    }

    const fcl = await import('@onflow/fcl')

    fcl.config().put('accessNode.api', accessNode)

    logger.info(`Sending transaction on ${network} from ${signerAddress}`)

    const authz = createAuthz(fcl, signerAddress, signerPrivateKey)

    // FCL's TypeScript types don't fully support async authorization functions,
    // but the runtime handles them correctly. Cast through unknown to satisfy the compiler.
    type FclAuthz = Parameters<typeof fcl.mutate>[0] extends { proposer?: infer P } ? P : never
    const typedAuthz = authz as unknown as FclAuthz

    const txId: string = await fcl.mutate({
      cadence: script,
      args: () => parsedArgs,
      proposer: typedAuthz,
      payer: typedAuthz,
      authorizations: [typedAuthz] as unknown as FclAuthz[],
      limit: 9999,
    })

    logger.info(`Transaction submitted: ${txId}`)

    const txStatus = await fcl.tx(txId).onceSealed()
    const statusLabel = txStatus.errorMessage ? 'ERROR' : 'SEALED'

    const content = txStatus.errorMessage
      ? `Transaction ${txId} failed: ${txStatus.errorMessage}`
      : `Transaction ${txId} sealed successfully (status: ${txStatus.status})`

    return NextResponse.json({
      success: true,
      output: {
        content,
        transactionId: txId,
        status: statusLabel,
      },
    })
  } catch (error) {
    logger.error('Failed to send transaction', { error })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send transaction',
      },
      { status: 500 }
    )
  }
}
