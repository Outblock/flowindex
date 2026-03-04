import type { ToolConfig } from '@/tools/types'
import type { FlowGetBalanceParams } from '@/tools/flow/types'

export interface FlowGetBalanceResponse {
  success: boolean
  output: {
    content: string
    address: string
    balances: Array<Record<string, unknown>>
  }
}

export const flowGetBalanceTool: ToolConfig<FlowGetBalanceParams, FlowGetBalanceResponse> = {
  id: 'flow_get_balance',
  name: 'Flow Get Balance',
  description: 'Get Flow token balances for an account',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
    token: {
      type: 'string',
      required: false,
      description: 'Token symbol filter (e.g. FLOW)',
    },
  },

  request: {
    url: '/api/tools/flow/get-balance',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address, token: params.token }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get balance' },
        error: data.error,
      } as unknown as FlowGetBalanceResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Balance summary' },
    address: { type: 'string', description: 'Flow address' },
    balances: { type: 'array', description: 'Token balances' },
  },
}
