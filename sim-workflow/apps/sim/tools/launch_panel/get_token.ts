import type { ToolConfig } from '@/tools/types'
import type { GetTokenParams, GetTokenResponse } from './types'

export const launchPanelGetTokenTool: ToolConfig<GetTokenParams, GetTokenResponse> = {
  id: 'launch_panel_get_token',
  name: 'Launch Panel: Get Token',
  description: 'Get detailed information about a specific token by contract address.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    address: { type: 'string', required: true, description: 'Token contract address' },
  },

  request: {
    url: (params) => `${params.apiUrl}/api/tokens/${params.address}`,
    method: 'GET',
    headers: () => ({}),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    address: { type: 'string', description: 'Token contract address' },
    name: { type: 'string', description: 'Token name' },
    symbol: { type: 'string', description: 'Token symbol' },
    price: { type: 'number', description: 'Current price' },
    market_cap: { type: 'number', description: 'Market cap' },
    volume_24h: { type: 'number', description: '24h trading volume' },
    status: { type: 'string', description: 'Token status: active, graduated, failed' },
  },
}
