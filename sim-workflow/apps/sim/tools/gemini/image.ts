import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GeminiImageTool')

export const geminiImageTool: ToolConfig = {
  id: 'gemini_image',
  name: 'Gemini Image Generator',
  description: "Generate images using Google's Gemini models",
  version: '1.0.0',

  params: {
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'The Gemini model to use (gemini-2.5-flash-image, gemini-3.1-flash-image-preview, nano-banana-pro-preview)',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A text description of the desired image',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio of the generated image (e.g. 1:1, 16:9, 9:16, 3:4, 4:3)',
    },
    imageSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image resolution: 512, 1K, 2K, or 4K',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Google Gemini API key',
    },
  },

  request: {
    url: (params) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${params.model || 'gemini-2.5-flash-image'}:generateContent`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    }),
    body: (params) => {
      const imageConfig: Record<string, string> = {}
      if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio
      if (params.imageSize) imageConfig.imageSize = params.imageSize

      return {
        contents: [
          {
            parts: [{ text: params.prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
        },
      }
    },
  },

  transformResponse: async (response, params) => {
    try {
      const data = await response.json()

      if (data.error) {
        logger.error('Gemini API error:', data.error)
        throw new Error(data.error.message || 'Gemini image generation failed')
      }

      const parts = data.candidates?.[0]?.content?.parts
      if (!parts || parts.length === 0) {
        logger.error('No parts in Gemini response:', data)
        throw new Error('No image data found in response')
      }

      let base64Image: string | null = null
      let mimeType = 'image/png'

      for (const part of parts) {
        if (part.inlineData) {
          base64Image = part.inlineData.data
          mimeType = part.inlineData.mimeType || 'image/png'
          logger.info('Found inline image data in Gemini response', `length: ${base64Image!.length}`)
          break
        }
      }

      if (!base64Image) {
        logger.error('No inline image data found in Gemini response parts:', parts)
        throw new Error('No image data found in response')
      }

      const modelName = params?.model || 'gemini-2.5-flash-image'

      return {
        success: true,
        output: {
          content: 'direct-image',
          image: base64Image,
          metadata: {
            model: modelName,
            mimeType,
          },
        },
      }
    } catch (error) {
      logger.error('Error in Gemini image generation response handling:', error)
      throw error
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Generated image data',
      properties: {
        content: { type: 'string', description: 'Image identifier' },
        image: { type: 'string', description: 'Base64 encoded image data' },
        metadata: {
          type: 'object',
          description: 'Image generation metadata',
          properties: {
            model: { type: 'string', description: 'Model used for image generation' },
            mimeType: { type: 'string', description: 'MIME type of the generated image' },
          },
        },
      },
    },
  },
}
