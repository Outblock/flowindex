import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const logger = createLogger('FlowExecuteScript')

const ACCESS_NODES: Record<string, string> = {
  mainnet: 'https://rest-mainnet.onflow.org',
  testnet: 'https://rest-testnet.onflow.org',
}

const Schema = z.object({
  script: z.string().min(1, 'Script is required'),
  arguments: z.string().optional().default('[]'),
  network: z.string().optional().default('mainnet'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { script, arguments: argsJson, network } = Schema.parse(body)

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

    logger.info(`Executing Cadence script on ${network}`)

    const result: unknown = await fcl.query({
      cadence: script,
      args: () => parsedArgs,
    })

    const content = JSON.stringify(result, null, 2)

    return NextResponse.json({
      success: true,
      output: {
        content,
        result,
      },
    })
  } catch (error) {
    logger.error('Failed to execute script', { error })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute script',
      },
      { status: 500 }
    )
  }
}
