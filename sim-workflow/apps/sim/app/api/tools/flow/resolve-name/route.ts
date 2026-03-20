import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  name: z.string().min(1, 'Name is required'),
})

/**
 * Resolve a .find name to a Flow address.
 *
 * Strategy: execute a Cadence script on mainnet that calls the FIND contract
 * via the FlowIndex execute-script proxy (which already handles FCL config).
 * Fallback: if the input looks like a hex address, look it up directly.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { name } = Schema.parse(body)

    // Strip .find / .fn suffix if present
    const cleanName = name.replace(/\.(find|fn)$/i, '').trim()

    // If it already looks like a hex address, just look it up directly
    if (/^0?x?[0-9a-fA-F]{16}$/.test(cleanName.replace(/^0x/, ''))) {
      const addr = cleanName.replace(/^0x/, '').toLowerCase()
      return NextResponse.json({
        success: true,
        output: {
          content: `${name} is already a Flow address: 0x${addr}`,
          name,
          address: `0x${addr}`,
        },
      })
    }

    // Use the FIND contract on mainnet to resolve the name
    // FIND is deployed at 0x097bafa4e0b48eef on mainnet
    const script = `
      import FIND from 0x097bafa4e0b48eef

      access(all) fun main(name: String): Address? {
        return FIND.lookupAddress(name)
      }
    `

    // Call the FlowIndex execute-script endpoint
    const scriptRes = await fetch(new URL('/api/tools/flow/execute-script', request.url).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward auth headers
        ...(request.headers.get('authorization')
          ? { authorization: request.headers.get('authorization')! }
          : {}),
        ...(request.headers.get('x-sim-internal-token')
          ? { 'x-sim-internal-token': request.headers.get('x-sim-internal-token')! }
          : {}),
      },
      body: JSON.stringify({
        script,
        arguments: JSON.stringify([{ type: 'String', value: cleanName }]),
        network: 'mainnet',
      }),
    })

    const scriptData = await scriptRes.json()

    if (scriptData.success && scriptData.output?.result) {
      const result = scriptData.output.result
      // FCL returns {type: "Optional", value: {type: "Address", value: "0x..."}} or {type: "Optional", value: null}
      let address = ''
      if (typeof result === 'string') {
        address = result
      } else if (result?.value?.value) {
        address = result.value.value
      } else if (result?.value && typeof result.value === 'string') {
        address = result.value
      }

      if (address) {
        return NextResponse.json({
          success: true,
          output: {
            content: `${cleanName}.find resolves to ${address}`,
            name: cleanName,
            address,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      output: {
        content: `${cleanName}.find could not be resolved — name not registered`,
        name: cleanName,
        address: '',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve name',
      },
      { status: 500 }
    )
  }
}
