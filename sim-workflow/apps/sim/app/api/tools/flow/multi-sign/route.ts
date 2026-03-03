import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendMultiSignTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'

const logger = createLogger('FlowMultiSign')

const Schema = z.object({
  script: z.string().min(1, 'Transaction script is required'),
  arguments: z.string().optional().default('[]'),
  signers: z.string().min(1, 'Signers JSON is required'),
  network: z.string().optional().default('mainnet'),
})

interface SignerInfo {
  address: string
  privateKey: string
  keyIndex: number
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { script, arguments: argsJson, signers: signersJson, network } = Schema.parse(body)

    // Parse arguments
    let parsedArgs: unknown[]
    try {
      parsedArgs = JSON.parse(argsJson) as unknown[]
      if (!Array.isArray(parsedArgs)) {
        throw new Error('Arguments must be a JSON array')
      }
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid arguments JSON: ${e instanceof Error ? e.message : 'parse error'}`,
        },
        { status: 400 }
      )
    }

    // Parse signers
    let signers: SignerInfo[]
    try {
      signers = JSON.parse(signersJson) as SignerInfo[]
      if (!Array.isArray(signers) || signers.length === 0) {
        throw new Error('Signers must be a non-empty array')
      }
      for (const s of signers) {
        if (!s.address || !s.privateKey) {
          throw new Error('Each signer must have "address" and "privateKey" fields')
        }
        if (s.keyIndex === undefined) {
          s.keyIndex = 0
        }
      }
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid signers JSON: ${e instanceof Error ? e.message : 'parse error'}`,
        },
        { status: 400 }
      )
    }

    logger.info(`Multi-sign transaction with ${signers.length} signers on ${network}`)

    const { txId, txStatus } = await sendMultiSignTransaction({
      cadence: script,
      args: parsedArgs,
      signers,
      network,
    })

    return NextResponse.json({ success: true, output: formatTxResult(txId, txStatus) })
  } catch (error) {
    logger.error('Multi-sign transaction failed', { error })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Multi-sign transaction failed',
      },
      { status: 500 }
    )
  }
}
