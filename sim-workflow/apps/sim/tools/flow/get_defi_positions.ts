import type { ToolConfig } from '@/tools/types'
import type { FlowGetDefiPositionsParams } from '@/tools/flow/types'

export interface FlowGetDefiPositionsResponse {
  success: boolean
  output: {
    content: string
    address: string
    positions: Array<Record<string, unknown>>
  }
}

export const flowGetDefiPositionsTool: ToolConfig<FlowGetDefiPositionsParams, FlowGetDefiPositionsResponse> = {
  id: 'flow_get_defi_positions',
  name: 'Flow Get DeFi Positions',
  description: 'Get DeFi positions (IncrementFi, etc.) for an account',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
  },

  request: {
    url: '/api/tools/flow/get-defi-positions',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get DeFi positions' },
        error: data.error,
      } as unknown as FlowGetDefiPositionsResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'DeFi positions summary' },
    address: { type: 'string', description: 'Flow address' },
    positions: { type: 'array', description: 'DeFi position records' },
  },
}
