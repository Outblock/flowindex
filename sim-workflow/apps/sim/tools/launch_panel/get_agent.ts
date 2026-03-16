import type { ToolConfig } from '@/tools/types'
import type { GetAgentParams, GetAgentResponse } from './types'

export const launchPanelGetAgentTool: ToolConfig<GetAgentParams, GetAgentResponse> = {
  id: 'launch_panel_get_agent',
  name: 'Launch Panel: Get Agent',
  description: 'Get a single agent profile by ID.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    jwtToken: { type: 'string', required: true, visibility: 'user-only', description: 'JWT Bearer token' },
    agentId: { type: 'string', required: true, description: 'Agent UUID' },
  },

  request: {
    url: (params) => `${params.apiUrl}/api/agent/${params.agentId}`,
    method: 'GET',
    headers: (params) => ({ 'Authorization': `Bearer ${params.jwtToken}` }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    id: { type: 'string', description: 'Agent UUID' },
    wallet_address: { type: 'string', description: 'Wallet address' },
    display_name: { type: 'string', description: 'Display name' },
    persona: { type: 'object', description: 'Agent persona config' },
    is_active: { type: 'boolean', description: 'Whether agent is active' },
  },
}
