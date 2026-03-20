import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const Schema = z.object({
  name: z.string().min(1, 'Name is required'),
})

/**
 * Look up a .find profile by name.
 *
 * Uses Cadence script to call FIND.lookup on mainnet.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { name } = Schema.parse(body)

    // Strip .find suffix if user included it
    const cleanName = name.replace(/\.(find|fn)$/i, '').trim()

    // Use the FIND contract on mainnet to look up the profile
    // FIND is deployed at 0x097bafa4e0b48eef on mainnet
    const script = `
      import FIND from 0x097bafa4e0b48eef
      import Profile from 0x097bafa4e0b48eef

      access(all) fun main(name: String): {String: AnyStruct}? {
        let addr = FIND.lookupAddress(name)
        if addr == nil { return nil }

        let account = getAccount(addr!)
        let profile = account.capabilities.borrow<&Profile.User>(/public/findProfile)

        var result: {String: AnyStruct} = {
          "address": addr!.toString(),
          "findName": name
        }

        if profile != nil {
          result["name"] = profile!.getName()
          result["description"] = profile!.getDescription()
          result["avatar"] = profile!.getAvatar()
          result["tags"] = profile!.getTags()
        }

        return result
      }
    `

    // Call the execute-script endpoint
    const scriptRes = await fetch(new URL('/api/tools/flow/execute-script', request.url).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      // Parse the Cadence result — could be nested JSON-CDC or already decoded
      let profile: Record<string, unknown> = {}

      if (typeof result === 'object' && result !== null) {
        // If it's a JSON-CDC Optional with value
        if (result.value && typeof result.value === 'object') {
          const fields = result.value.value || result.value
          if (Array.isArray(fields)) {
            // JSON-CDC Dictionary format: [{key: {value: "..."}, value: {value: "..."}}]
            for (const entry of fields) {
              const k = entry.key?.value ?? entry.key
              const v = entry.value?.value ?? entry.value
              if (k) profile[String(k)] = v
            }
          } else {
            profile = fields as Record<string, unknown>
          }
        } else {
          profile = result as Record<string, unknown>
        }
      }

      const address = profile.address || ''
      const displayName = profile.name || profile.findName || cleanName

      if (address) {
        return NextResponse.json({
          success: true,
          output: {
            content: `${cleanName}.find — ${displayName} (${address})`,
            profile,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      output: {
        content: `${cleanName}.find — profile not found`,
        profile: {},
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to look up .find profile',
      },
      { status: 500 }
    )
  }
}
