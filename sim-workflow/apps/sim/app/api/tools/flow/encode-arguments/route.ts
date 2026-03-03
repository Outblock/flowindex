import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const Schema = z.object({
  arguments: z.string().min(1, 'Arguments JSON is required'),
  types: z.string().min(1, 'Types JSON is required'),
})

/**
 * Map a Cadence type name to its JSON-CDC type string.
 */
function cadenceTypeToJsonCdc(type: string): string {
  const typeMap: Record<string, string> = {
    Int: 'Int',
    Int8: 'Int8',
    Int16: 'Int16',
    Int32: 'Int32',
    Int64: 'Int64',
    Int128: 'Int128',
    Int256: 'Int256',
    UInt: 'UInt',
    UInt8: 'UInt8',
    UInt16: 'UInt16',
    UInt32: 'UInt32',
    UInt64: 'UInt64',
    UInt128: 'UInt128',
    UInt256: 'UInt256',
    Fix64: 'Fix64',
    UFix64: 'UFix64',
    Word8: 'Word8',
    Word16: 'Word16',
    Word32: 'Word32',
    Word64: 'Word64',
    String: 'String',
    Address: 'Address',
    Bool: 'Bool',
    Path: 'Path',
    StoragePath: 'StoragePath',
    PublicPath: 'PublicPath',
    PrivatePath: 'PrivatePath',
  }
  return typeMap[type] || type
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { arguments: argsJson, types: typesJson } = Schema.parse(body)

    let args: unknown[]
    let types: string[]
    try {
      args = JSON.parse(argsJson)
      types = JSON.parse(typesJson)
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in arguments or types' },
        { status: 400 }
      )
    }

    if (!Array.isArray(args) || !Array.isArray(types)) {
      return NextResponse.json(
        { success: false, error: 'Both arguments and types must be JSON arrays' },
        { status: 400 }
      )
    }

    if (args.length !== types.length) {
      return NextResponse.json(
        {
          success: false,
          error: `Argument count (${args.length}) does not match type count (${types.length})`,
        },
        { status: 400 }
      )
    }

    const encoded = args.map((value, i) => ({
      type: cadenceTypeToJsonCdc(types[i]),
      value: String(value),
    }))

    return NextResponse.json({
      success: true,
      output: {
        content: `Encoded ${encoded.length} argument(s): ${types.join(', ')}`,
        encoded,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to encode arguments',
      },
      { status: 500 }
    )
  }
}
