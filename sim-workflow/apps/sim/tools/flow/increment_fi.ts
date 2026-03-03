import type { ToolConfig } from '@/tools/types'
import type { FlowIncrementFiParams } from '@/tools/flow/types'

export interface FlowIncrementFiResponse {
  success: boolean
  output: {
    content: string
    quote: Record<string, unknown>
  }
}

export const flowIncrementFiTool: ToolConfig<FlowIncrementFiParams, FlowIncrementFiResponse> = {
  id: 'flow_increment_fi',
  name: 'Flow IncrementFi Quote',
  description: 'Get a swap quote from IncrementFi DEX',
  version: '1.0.0',

  params: {
    tokenIn: {
      type: 'string',
      required: true,
      description: 'Input token identifier',
    },
    tokenOut: {
      type: 'string',
      required: true,
      description: 'Output token identifier',
    },
    amountIn: {
      type: 'string',
      required: true,
      description: 'Amount of input token',
    },
  },

  request: {
    url: '/api/tools/flow/increment-fi',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get swap quote', quote: {} },
        error: data.error,
      } as FlowIncrementFiResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Swap quote summary' },
    quote: { type: 'json', description: 'Full quote data' },
  },
}
