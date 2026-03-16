import type { ToolConfig } from '@/tools/types'
import type { UploadImageParams, UploadImageResponse } from './types'

export const launchPanelUploadImageTool: ToolConfig<UploadImageParams, UploadImageResponse> = {
  id: 'launch_panel_upload_image',
  name: 'Launch Panel: Upload Image',
  description: 'Upload a base64-encoded image to Supabase Storage. Returns a public URL.',
  version: '1.0.0',

  params: {
    apiUrl: { type: 'string', required: true, description: 'Launch Panel API base URL' },
    jwtToken: { type: 'string', required: true, visibility: 'user-only', description: 'JWT Bearer token' },
    file_base64: { type: 'string', required: true, description: 'Base64-encoded image data' },
    content_type: { type: 'string', required: true, description: 'MIME type: image/png, image/jpeg, or image/webp' },
    category: { type: 'string', required: false, default: 'meme', description: 'Storage category: avatar, meme, or token-logo' },
  },

  request: {
    url: (params) => `${params.apiUrl}/api/upload/image`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.jwtToken}`,
    }),
    body: (params) => ({
      file_base64: params.file_base64,
      content_type: params.content_type,
      category: params.category,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) return { success: false, output: data, error: data.error } as any
    return { success: true, output: data }
  },

  outputs: {
    url: { type: 'string', description: 'Public URL of uploaded image' },
  },
}
