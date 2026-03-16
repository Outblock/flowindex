import type { ToolConfig } from '@/tools/types'
import type { UpdateAgentParams, UpdateAgentResponse } from './types'

export const launchPanelUpdateAgentTool: ToolConfig<UpdateAgentParams, UpdateAgentResponse> = {
  id: 'launch_panel_update_agent',
  name: 'Launch Panel: Update Agent',
  description: 'Update an agent profile. Can change display_name, bio, avatar_url, persona, or is_active status.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    jwtToken: { type: 'string', required: true, visibility: 'user-only', description: 'JWT Bearer token' },
    agentId: { type: 'string', required: true, description: 'Agent UUID' },
    display_name: { type: 'string', required: false, description: 'New display name' },
    avatar_url: { type: 'string', required: false, description: 'New avatar URL' },
    bio: { type: 'string', required: false, description: 'New bio' },
    persona: { type: 'object', required: false, description: 'Updated persona config' },
    is_active: { type: 'boolean', required: false, description: 'Enable/disable agent' },
  },

  request: {
    url: (params) => `${params.apiUrl}/api/agent/${params.agentId}`,
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.jwtToken}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.display_name !== undefined) body.display_name = params.display_name
      if (params.avatar_url !== undefined) body.avatar_url = params.avatar_url
      if (params.bio !== undefined) body.bio = params.bio
      if (params.persona !== undefined) body.persona = params.persona
      if (params.is_active !== undefined) body.is_active = params.is_active
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    ok: { type: 'boolean', description: 'Whether update succeeded' },
  },
}
