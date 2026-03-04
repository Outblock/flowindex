import type { ToolConfig } from '@/tools/types'
import type { FlowFindProfileParams } from '@/tools/flow/types'

export interface FlowFindProfileResponse {
  success: boolean
  output: {
    content: string
    profile: Record<string, unknown>
  }
}

export const flowFindProfileTool: ToolConfig<FlowFindProfileParams, FlowFindProfileResponse> = {
  id: 'flow_find_profile',
  name: 'Flow .find Profile',
  description: 'Look up a .find profile by name',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      description: '.find name to look up (e.g. bjartek)',
    },
  },

  request: {
    url: '/api/tools/flow/find-profile',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ name: params.name }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to look up .find profile', profile: {} },
        error: data.error,
      } as unknown as FlowFindProfileResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Profile summary' },
    profile: { type: 'json', description: 'Profile data' },
  },
}
