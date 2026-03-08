import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { resolveSignerFromParams, extractFiAuthFromRequest } from '@/lib/flow/signer-resolver'
import type { SignerParams } from '@/lib/flow/signer-resolver'
import { ACCESS_NODES, formatTxResult } from '@/app/api/tools/flow/tx-helpers'
import { transferFlowCadence } from '@/app/api/tools/flow/cadence-templates'

const logger = createLogger('FlowSend')

const Schema = z.object({
  signer: z.string().min(1, 'Signer configuration is required'),
  sendType: z.enum(['token', 'nft']),
  sender: z.string().min(1, 'Sender address is required'),
  receiver: z.string().min(1, 'Receiver address is required'),
  flowIdentifier: z.string().min(1, 'Flow identifier is required'),
  amount: z.string().optional(),
  nftIds: z.string().optional(),
  network: z.string().optional().default('mainnet'),
})

/** Check whether an address looks like an EVM address (40 hex chars, with or without 0x) */
function isEvmAddress(addr: string): boolean {
  const clean = addr.startsWith('0x') ? addr.slice(2) : addr
  return /^[0-9a-fA-F]{40}$/.test(clean)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { signer: signerJson, sendType, sender, receiver, flowIdentifier, amount, nftIds, network } =
      Schema.parse(body)

    // Validate send-type-specific fields
    if (sendType === 'token' && !amount) {
      return NextResponse.json(
        { success: false, error: 'amount is required for token sends' },
        { status: 400 }
      )
    }
    if (sendType === 'nft' && !nftIds) {
      return NextResponse.json(
        { success: false, error: 'nftIds is required for NFT sends' },
        { status: 400 }
      )
    }

    // Detect cross-VM (Flow <-> EVM) sends
    const senderIsEvm = isEvmAddress(sender)
    const receiverIsEvm = isEvmAddress(receiver)
    if (senderIsEvm || receiverIsEvm) {
      return NextResponse.json(
        { success: false, error: 'Cross-VM (Flow <-> EVM) sends are not yet supported. Coming in a future update.' },
        { status: 501 }
      )
    }

    // NFT sends are not yet implemented
    if (sendType === 'nft') {
      return NextResponse.json(
        { success: false, error: 'NFT sends are not yet supported. Coming in a future update.' },
        { status: 501 }
      )
    }

    // Parse signer configuration
    let signerParams: SignerParams
    try {
      signerParams = JSON.parse(signerJson) as SignerParams
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid signer JSON configuration' },
        { status: 400 }
      )
    }

    // Resolve signer
    const fiAuth = extractFiAuthFromRequest(request)
    const { authz } = await resolveSignerFromParams(signerParams, fiAuth ?? undefined)

    // Validate network
    const accessNode = ACCESS_NODES[network]
    if (!accessNode) {
      return NextResponse.json(
        { success: false, error: `Invalid network: ${network}. Use "mainnet" or "testnet".` },
        { status: 400 }
      )
    }

    // Configure FCL
    const fcl = await import('@onflow/fcl')
    fcl.config().put('accessNode.api', accessNode)

    // Build Cadence transaction for Flow-to-Flow token transfer
    const cadence = transferFlowCadence(network)
    const args = [
      fcl.arg(amount!, fcl.t.UFix64),
      fcl.arg(receiver, fcl.t.Address),
    ]

    logger.info(`Sending ${amount} of ${flowIdentifier} from ${sender} to ${receiver} on ${network}`)

    // FCL authorization type helper
    type FclAuthz = Parameters<typeof fcl.mutate>[0] extends { proposer?: infer P } ? P : never
    const typedAuthz = authz as unknown as FclAuthz

    const txId: string = await fcl.mutate({
      cadence,
      args: () => args,
      proposer: typedAuthz,
      payer: typedAuthz,
      authorizations: [typedAuthz] as unknown as FclAuthz[],
      limit: 9999,
    })

    logger.info(`Transaction submitted: ${txId}`)

    const txStatus = await fcl.tx(txId).onceSealed()

    return NextResponse.json({
      success: true,
      output: formatTxResult(txId, txStatus),
    })
  } catch (error) {
    logger.error('Failed to send', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send' },
      { status: 500 }
    )
  }
}
