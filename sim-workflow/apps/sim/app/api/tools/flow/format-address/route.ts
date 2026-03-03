import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const Schema = z.object({
  address: z.string().min(1, 'Address is required'),
  format: z.enum(['with_prefix', 'without_prefix', 'padded']).optional().default('with_prefix'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { address, format } = Schema.parse(body)

    // Strip 0x prefix and whitespace for validation
    const raw = address.trim().replace(/^0x/i, '').toLowerCase()

    // Validate hex characters
    const isValidHex = /^[0-9a-f]+$/.test(raw)
    if (!isValidHex || raw.length === 0 || raw.length > 16) {
      return NextResponse.json({
        success: true,
        output: {
          content: `Invalid Flow address: ${address}`,
          formatted: address,
          isValid: false,
        },
      })
    }

    let formatted: string
    switch (format) {
      case 'with_prefix':
        formatted = `0x${raw}`
        break
      case 'without_prefix':
        formatted = raw
        break
      case 'padded':
        formatted = `0x${raw.padStart(16, '0')}`
        break
    }

    return NextResponse.json({
      success: true,
      output: {
        content: `Formatted address: ${formatted}`,
        formatted,
        isValid: true,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to format address',
      },
      { status: 500 }
    )
  }
}
