import type { ToolConfig } from '@/tools/types'
import type { FlowGetTokenPriceParams } from '@/tools/flow/types'

export interface FlowGetTokenPriceResponse {
  success: boolean
  output: {
    content: string
    symbol: string
    price: string
    priceChange24h: string
    prices: Array<Record<string, unknown>>
  }
}

export const flowGetTokenPriceTool: ToolConfig<FlowGetTokenPriceParams, FlowGetTokenPriceResponse> = {
  id: 'flow_get_token_price',
  name: 'Flow Token Price',
  description: 'Get current token prices on Flow (FLOW, USDC, stFLOW, etc.)',
  version: '1.0.0',

  params: {
    symbol: {
      type: 'string',
      required: false,
      description: 'Token symbol (e.g. FLOW, USDC). Leave empty for all prices.',
    },
  },

  request: {
    url: '/api/tools/flow/get-token-price',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ symbol: params.symbol }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get token prices' },
        error: data.error,
      } as unknown as FlowGetTokenPriceResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Price summary' },
    symbol: { type: 'string', description: 'Token symbol queried' },
    price: { type: 'string', description: 'Current USD price' },
    priceChange24h: { type: 'string', description: '24h price change percentage' },
    prices: { type: 'array', description: 'Price entries' },
  },
}
