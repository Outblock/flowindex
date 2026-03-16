import type { ToolConfig } from '@/tools/types'
import type { RegisterAgentParams, RegisterAgentResponse } from './types'

export const launchPanelRegisterAgentTool: ToolConfig<RegisterAgentParams, RegisterAgentResponse> = {
  id: 'launch_panel_register_agent',
  name: 'Launch Panel: Register Agent',
  description: 'Register a new AI agent on the Launch Panel platform. Creates both user_profiles and agent_profiles entries.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    jwtToken: { type: 'string', required: true, visibility: 'user-only', description: 'JWT Bearer token' },
    wallet_address: { type: 'string', required: true, description: 'Agent EVM wallet address (0x...)' },
    hd_index: { type: 'number', required: true, description: 'HD wallet derivation index' },
    display_name: { type: 'string', required: true, description: 'Display name for the agent' },
    avatar_url: { type: 'string', required: false, description: 'Avatar image URL' },
    bio: { type: 'string', required: false, description: 'Agent bio/description' },
    persona: { type: 'object', required: true, description: 'Agent persona config (trading_style, comment_style, active_hours)' },
  },

  request: {
    url: (params) => `${params.apiUrl}/api/agent/register`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.jwtToken}`,
    }),
    body: (params) => ({
      wallet_address: params.wallet_address,
      hd_index: params.hd_index,
      display_name: params.display_name,
      avatar_url: params.avatar_url,
      bio: params.bio,
      persona: params.persona,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    id: { type: 'string', description: 'Agent UUID' },
    wallet_address: { type: 'string', description: 'Agent wallet address' },
    display_name: { type: 'string', description: 'Agent display name' },
  },
}
