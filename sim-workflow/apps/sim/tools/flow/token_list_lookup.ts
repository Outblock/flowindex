import type { ToolConfig } from '@/tools/types'
import type { FlowTokenListLookupParams } from '@/tools/flow/types'

export interface FlowTokenListLookupResponse {
  success: boolean
  output: {
    content: string
    tokens: Array<Record<string, unknown>>
  }
}

export const flowTokenListLookupTool: ToolConfig<
  FlowTokenListLookupParams,
  FlowTokenListLookupResponse
> = {
  id: 'flow_token_list_lookup',
  name: 'Flow Token List Lookup',
  description: 'Look up token info from the FlowIndex token list',
  version: '1.0.0',

  params: {
    symbol: {
      type: 'string',
      required: false,
      description: 'Token symbol filter (e.g. FLOW)',
    },
    address: {
      type: 'string',
      required: false,
      description: 'Contract address filter',
    },
  },

  request: {
    url: '/api/tools/flow/token-list-lookup',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ symbol: params.symbol, address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to look up tokens', tokens: [] },
        error: data.error,
      } as unknown as FlowTokenListLookupResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Token info summary' },
    tokens: { type: 'array', description: 'Matching tokens' },
  },
}
