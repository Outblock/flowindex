import type { ToolConfig } from '@/tools/types'
import type { FlowGetAccountParams } from '@/tools/flow/types'

export interface FlowGetAccountResponse {
  success: boolean
  output: {
    content: string
    address: string
    balance: string
    keys: Array<Record<string, unknown>>
    contracts: string[]
  }
}

export const flowGetAccountTool: ToolConfig<FlowGetAccountParams, FlowGetAccountResponse> = {
  id: 'flow_get_account',
  name: 'Flow Get Account',
  description: 'Get Flow account details including balance, keys, and contracts',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
  },

  request: {
    url: '/api/tools/flow/get-account',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get account' },
        error: data.error,
      } as unknown as FlowGetAccountResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Account summary' },
    address: { type: 'string', description: 'Flow address' },
    balance: { type: 'string', description: 'FLOW balance' },
    keys: { type: 'array', description: 'Account keys' },
    contracts: { type: 'array', description: 'Deployed contract names' },
  },
}
