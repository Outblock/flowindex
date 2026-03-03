import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sendTransaction, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { evmSendCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowEvmSend')

const Schema = z.object({
  to: z.string().min(1, 'Destination address is required'),
  data: z.string().optional().default(''),
  value: z.string().optional().default('0'),
  gasLimit: z.string().optional().default('300000'),
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
    const { to, data, value, gasLimit, signerAddress, signerPrivateKey, network } =
      Schema.parse(body)

    const cadence = evmSendCadence(network)

    // Strip 0x prefix from addresses and data for the Cadence hex decode
    const toClean = to.startsWith('0x') ? to.slice(2) : to
    const dataClean = data.startsWith('0x') ? data.slice(2) : data

    logger.info(`EVM send to ${to} on ${network} (gas: ${gasLimit})`)

    const fcl = await import('@onflow/fcl')
    const args = [
      fcl.arg(toClean, fcl.t.String),
      fcl.arg(dataClean, fcl.t.String),
      fcl.arg(gasLimit, fcl.t.UInt64),
      fcl.arg(value, fcl.t.UInt256),
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
    logger.error('EVM send failed', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'EVM transaction failed' },
      { status: 500 }
    )
  }
}
