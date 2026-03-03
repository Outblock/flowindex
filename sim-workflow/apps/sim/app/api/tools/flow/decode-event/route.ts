import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const Schema = z.object({
  eventData: z.string().min(1, 'Event data is required'),
})

/**
 * Recursively extract fields from Cadence JSON-CDC value objects.
 */
function extractCadenceValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  const v = value as Record<string, unknown>

  // Cadence JSON-CDC has { type, value } structure
  if ('type' in v && 'value' in v) {
    const cadenceType = v.type as string

    // Composite types (Struct, Resource, Event, etc.) have fields array
    if (cadenceType === 'Event' || cadenceType === 'Struct' || cadenceType === 'Resource') {
      const composite = v.value as { id?: string; fields?: Array<{ name: string; value: unknown }> }
      const result: Record<string, unknown> = {}
      if (composite.fields) {
        for (const field of composite.fields) {
          result[field.name] = extractCadenceValue(field.value)
        }
      }
      return result
    }

    // Array type
    if (cadenceType === 'Array') {
      const arr = v.value as unknown[]
      return arr.map(extractCadenceValue)
    }

    // Optional type
    if (cadenceType === 'Optional') {
      return v.value === null ? null : extractCadenceValue(v.value)
    }

    // Dictionary type
    if (cadenceType === 'Dictionary') {
      const entries = v.value as Array<{ key: unknown; value: unknown }>
      const result: Record<string, unknown> = {}
      for (const entry of entries) {
        const key = String(extractCadenceValue(entry.key))
        result[key] = extractCadenceValue(entry.value)
      }
      return result
    }

    // Primitive types — just return the value
    return v.value
  }

  // Plain object with fields array (top-level event)
  if ('fields' in v && Array.isArray(v.fields)) {
    const result: Record<string, unknown> = {}
    for (const field of v.fields as Array<{ name: string; value: unknown }>) {
      result[field.name] = extractCadenceValue(field.value)
    }
    return result
  }

  return v
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { eventData } = Schema.parse(body)

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(eventData)
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in eventData' },
        { status: 400 }
      )
    }

    const eventType = (parsed.type as string) || 'Unknown'
    const fields = extractCadenceValue(parsed) as Record<string, unknown>

    const fieldNames = Object.keys(fields)
    const summary = `Event ${eventType} with ${fieldNames.length} field(s): ${fieldNames.join(', ')}`

    return NextResponse.json({
      success: true,
      output: {
        content: summary,
        eventType,
        fields,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to decode event',
      },
      { status: 500 }
    )
  }
}
