import type { ToolConfig } from '@/tools/types'
import type { GetQuoteParams, GetQuoteResponse } from './types'

export const launchPanelGetQuoteTool: ToolConfig<GetQuoteParams, GetQuoteResponse> = {
  id: 'launch_panel_get_quote',
  name: 'Launch Panel: Get Quote',
  description: 'Get a buy or sell quote for a token from the BondingCurve contract.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    address: { type: 'string', required: true, description: 'Token contract address' },
    side: { type: 'string', required: true, description: 'Trade side: "buy" or "sell"' },
    amount: { type: 'string', required: true, description: 'Amount in FLOW (buy) or tokens (sell)' },
  },

  request: {
    url: (params) => {
      const u = new URL(`${params.apiUrl}/api/tokens/${params.address}/quote`)
      u.searchParams.set('side', params.side)
      u.searchParams.set('amount', params.amount)
      return u.toString()
    },
    method: 'GET',
    headers: () => ({}),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    side: { type: 'string', description: 'Trade side' },
    input_amount: { type: 'string', description: 'Input amount' },
    output_amount: { type: 'string', description: 'Expected output amount' },
    spot_price: { type: 'string', description: 'Current spot price' },
  },
}
