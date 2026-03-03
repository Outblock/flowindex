import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const logger = createLogger('FlowEvmCall')

const EVM_RPC_NODES: Record<string, string> = {
  mainnet: 'https://mainnet.evm.nodes.onflow.org',
  testnet: 'https://testnet.evm.nodes.onflow.org',
}

const Schema = z.object({
  to: z.string().min(1, 'Contract address is required'),
  data: z.string().min(1, 'Calldata is required'),
  value: z.string().optional().default('0x0'),
  network: z.string().optional().default('mainnet'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { to, data, value, network } = Schema.parse(body)

    const rpcUrl = EVM_RPC_NODES[network]
    if (!rpcUrl) {
      return NextResponse.json(
        { success: false, error: `Invalid network: ${network}. Use "mainnet" or "testnet".` },
        { status: 400 }
      )
    }

    logger.info(`EVM eth_call to ${to} on ${network}`)

    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to,
            data,
            value,
          },
          'latest',
        ],
        id: 1,
      }),
    })

    const rpcData = (await rpcResponse.json()) as {
      result?: string
      error?: { message: string; code: number }
    }

    if (rpcData.error) {
      return NextResponse.json(
        { success: false, error: `EVM call error: ${rpcData.error.message}` },
        { status: 400 }
      )
    }

    const result = rpcData.result ?? '0x'

    return NextResponse.json({
      success: true,
      output: {
        content: `EVM call to ${to} returned ${result.length > 66 ? result.slice(0, 66) + '...' : result}`,
        result,
      },
    })
  } catch (error) {
    logger.error('EVM call failed', { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'EVM call failed' },
      { status: 500 }
    )
  }
}
