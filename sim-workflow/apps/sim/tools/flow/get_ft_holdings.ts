import type { ToolConfig } from '@/tools/types'
import type { FlowGetFtHoldingsParams } from '@/tools/flow/types'

export interface FlowGetFtHoldingsResponse {
  success: boolean
  output: {
    content: string
    address: string
    holdings: Array<Record<string, unknown>>
  }
}

export const flowGetFtHoldingsTool: ToolConfig<FlowGetFtHoldingsParams, FlowGetFtHoldingsResponse> = {
  id: 'flow_get_ft_holdings',
  name: 'Flow Get FT Holdings',
  description: 'Get all fungible token holdings for an account',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
  },

  request: {
    url: '/api/tools/flow/get-ft-holdings',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get FT holdings' },
        error: data.error,
      } as unknown as FlowGetFtHoldingsResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Holdings summary' },
    address: { type: 'string', description: 'Flow address' },
    holdings: { type: 'array', description: 'Token holdings' },
  },
}
