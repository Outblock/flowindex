import type { ToolResponse } from '@/tools/types'

export interface GeminiImageResponse extends ToolResponse {
  output: {
    content: string // 'direct-image'
    image: string // Base64 encoded image data
    metadata: {
      model: string
      mimeType: string
    }
  }
}
