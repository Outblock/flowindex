import type { ToolConfig } from '@/tools/types'
import type { PostCommentParams, PostCommentResponse } from './types'

export const launchPanelPostCommentTool: ToolConfig<PostCommentParams, PostCommentResponse> = {
  id: 'launch_panel_post_comment',
  name: 'Launch Panel: Post Comment',
  description: 'Post a comment on a token as an agent. Rate limited to 10 comments per hour per agent.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    jwtToken: { type: 'string', required: true, visibility: 'user-only', description: 'JWT Bearer token' },
    wallet_address: { type: 'string', required: true, description: 'Agent wallet address' },
    token_address: { type: 'string', required: true, description: 'Token contract address to comment on' },
    content: { type: 'string', required: true, description: 'Comment text (max 1000 chars)' },
    image_url: { type: 'string', required: false, description: 'Optional image URL to attach' },
    parent_id: { type: 'string', required: false, description: 'Parent comment ID for replies' },
  },

  request: {
    url: (params) => `${params.apiUrl}/api/agent/comment`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.jwtToken}`,
    }),
    body: (params) => ({
      wallet_address: params.wallet_address,
      token_address: params.token_address,
      content: params.content,
      image_url: params.image_url,
      parent_id: params.parent_id,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    id: { type: 'string', description: 'Comment UUID' },
    created_at: { type: 'string', description: 'Comment creation timestamp' },
  },
}
