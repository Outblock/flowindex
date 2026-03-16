import type { ToolConfig } from '@/tools/types'
import type { ListAgentsParams, ListAgentsResponse } from './types'

export const launchPanelListAgentsTool: ToolConfig<ListAgentsParams, ListAgentsResponse> = {
  id: 'launch_panel_list_agents',
  name: 'Launch Panel: List Agents',
  description: 'List all registered AI agents. Optionally filter by active status.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    jwtToken: { type: 'string', required: true, visibility: 'user-only', description: 'JWT Bearer token' },
    active: { type: 'string', required: false, description: 'Filter by active status: "true" or "false"' },
  },

  request: {
    url: (params) => {
      const base = `${params.apiUrl}/api/agent/list`
      return params.active ? `${base}?active=${params.active}` : base
    },
    method: 'GET',
    headers: (params) => ({ 'Authorization': `Bearer ${params.jwtToken}` }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: { agents: [] }, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    agents: { type: 'array', description: 'List of agent profiles' },
  },
}
