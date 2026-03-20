import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { flowApiFetch } from '@/app/api/tools/flow/utils'

interface PriceEntry {
  asset: string
  price: number
  price_change_24h?: number
  as_of?: string
}

const Schema = z.object({
  symbol: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }

    const body = await request.json()
    const { symbol } = Schema.parse(body)

    // Fetch all token prices from FlowIndex
    const data = await flowApiFetch<{
      data: Array<{ prices: Record<string, PriceEntry>; token_map: Record<string, string> }>
    }>('/status/prices')

    const raw = data.data?.[0] ?? (data as unknown as { prices: Record<string, PriceEntry>; token_map: Record<string, string> })
    const allPrices = raw.prices ?? {}
    const tokenMap = raw.token_map ?? {}

    if (symbol) {
      // Look up specific token
      const upper = symbol.toUpperCase()
      const price = allPrices[upper]

      if (price) {
        const change = price.price_change_24h
        const changeStr = change != null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h)` : ''
        return NextResponse.json({
          success: true,
          output: {
            content: `${upper}: $${price.price.toFixed(6)}${changeStr}`,
            symbol: upper,
            price: String(price.price),
            priceChange24h: change != null ? String(change) : '',
            prices: [price],
          },
        })
      }

      // Try mapping from contract name
      const mapped = tokenMap[symbol] || tokenMap[symbol.toLowerCase()]
      if (mapped && allPrices[mapped]) {
        const p = allPrices[mapped]
        const change = p.price_change_24h
        const changeStr = change != null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h)` : ''
        return NextResponse.json({
          success: true,
          output: {
            content: `${mapped}: $${p.price.toFixed(6)}${changeStr}`,
            symbol: mapped,
            price: String(p.price),
            priceChange24h: change != null ? String(change) : '',
            prices: [p],
          },
        })
      }

      return NextResponse.json({
        success: true,
        output: {
          content: `No price data found for "${symbol}"`,
          symbol: upper,
          price: '',
          priceChange24h: '',
          prices: [],
        },
      })
    }

    // No symbol specified — return all prices
    const entries = Object.entries(allPrices)
      .sort(([, a], [, b]) => (b.price ?? 0) - (a.price ?? 0))
    const summary = entries
      .slice(0, 10)
      .map(([sym, p]) => {
        const change = p.price_change_24h
        const changeStr = change != null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)` : ''
        return `${sym}: $${p.price.toFixed(6)}${changeStr}`
      })
      .join(', ')

    return NextResponse.json({
      success: true,
      output: {
        content: `${entries.length} tokens with price data. Top: ${summary}`,
        symbol: '',
        price: '',
        priceChange24h: '',
        prices: entries.map(([, p]) => p),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get token prices',
      },
      { status: 500 }
    )
  }
}
