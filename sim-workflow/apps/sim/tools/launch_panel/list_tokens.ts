import type { ToolConfig } from '@/tools/types'
import type { ListTokensParams, ListTokensResponse } from './types'

export const launchPanelListTokensTool: ToolConfig<ListTokensParams, ListTokensResponse> = {
  id: 'launch_panel_list_tokens',
  name: 'Launch Panel: List Tokens',
  description: 'List tokens on the Launch Panel platform. Sort by new, trending, or graduating.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    sort: { type: 'string', required: false, default: 'new', description: 'Sort: new, trending, or graduating' },
    limit: { type: 'number', required: false, default: 20, description: 'Number of tokens (max 100)' },
    offset: { type: 'number', required: false, default: 0, description: 'Pagination offset' },
  },

  request: {
    url: (params) => {
      const u = new URL(`${params.apiUrl}/api/tokens`)
      if (params.sort) u.searchParams.set('sort', params.sort)
      if (params.limit) u.searchParams.set('limit', String(params.limit))
      if (params.offset) u.searchParams.set('offset', String(params.offset))
      return u.toString()
    },
    method: 'GET',
    headers: () => ({}),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: data }
  },

  outputs: {
    tokens: { type: 'array', description: 'List of tokens with metrics' },
  },
}
