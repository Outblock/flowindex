import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const Schema = z.object({
  tokenIn: z.string().min(1, 'Token In is required'),
  tokenOut: z.string().min(1, 'Token Out is required'),
  amountIn: z.string().min(1, 'Amount In is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { tokenIn, tokenOut, amountIn } = Schema.parse(body)

    const url = `https://app.incrementfi.com/api/v1/swap/quote?tokenIn=${encodeURIComponent(tokenIn)}&tokenOut=${encodeURIComponent(tokenOut)}&amountIn=${encodeURIComponent(amountIn)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return NextResponse.json({
          success: true,
          output: {
            content: `IncrementFi API returned ${res.status}: ${text || 'unknown error'}`,
            quote: {},
          },
        })
      }

      const quote = await res.json()

      const amountOut = quote.amountOut || quote.amount_out || 'unknown'
      return NextResponse.json({
        success: true,
        output: {
          content: `Swap ${amountIn} ${tokenIn} -> ${amountOut} ${tokenOut}`,
          quote,
        },
      })
    } catch (fetchError) {
      clearTimeout(timeoutId)
      const msg =
        fetchError instanceof Error && fetchError.name === 'AbortError'
          ? 'IncrementFi API timed out'
          : 'IncrementFi service unavailable'
      return NextResponse.json({
        success: true,
        output: {
          content: msg,
          quote: {},
        },
      })
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get swap quote',
      },
      { status: 500 }
    )
  }
}
