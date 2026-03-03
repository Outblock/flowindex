import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

const Schema = z.object({
  endpoint: z.string().min(1, 'Endpoint is required'),
  method: z.enum(['GET', 'POST']).optional().default('GET'),
  body: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const reqBody = await request.json()
    const { endpoint, method, body: bodyStr } = Schema.parse(reqBody)

    let parsedBody: unknown
    if (bodyStr && method === 'POST') {
      try {
        parsedBody = JSON.parse(bodyStr)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON in body' },
          { status: 400 }
        )
      }
    }

    const data = await flowApiFetch<unknown>(endpoint, {
      method,
      body: parsedBody,
    })

    const summary =
      typeof data === 'object' && data !== null
        ? `FlowIndex ${method} ${endpoint}: ${JSON.stringify(data).slice(0, 200)}`
        : `FlowIndex ${method} ${endpoint}: ${String(data)}`

    return NextResponse.json({
      success: true,
      output: {
        content: summary,
        data,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'FlowIndex API request failed',
      },
      { status: 500 }
    )
  }
}
