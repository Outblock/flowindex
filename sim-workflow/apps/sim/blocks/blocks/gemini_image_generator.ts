import { GeminiIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { GeminiImageResponse } from '@/tools/gemini/types'

export const GeminiImageGeneratorBlock: BlockConfig<GeminiImageResponse> = {
  type: 'gemini_image_generator',
  name: 'Gemini Image Generator',
  description: 'Generate images with Gemini',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate images using Google Gemini models. Supports Gemini 2.5 Flash, 3.1 Flash, and Nano Banana Pro with configurable aspect ratio and resolution.',
  category: 'tools',
  bgColor: '#4285F4',
  icon: GeminiIcon,
  subBlocks: [
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash-image' },
        { label: 'Gemini 3.1 Flash (Preview)', id: 'gemini-3.1-flash-image-preview' },
        { label: 'Nano Banana Pro (Preview)', id: 'nano-banana-pro-preview' },
      ],
      value: () => 'gemini-2.5-flash-image',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      required: true,
      placeholder: 'Describe the image you want to generate...',
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: [
        { label: '1:1 (Square)', id: '1:1' },
        { label: '16:9 (Landscape)', id: '16:9' },
        { label: '9:16 (Portrait)', id: '9:16' },
        { label: '4:3', id: '4:3' },
        { label: '3:4', id: '3:4' },
        { label: '3:2', id: '3:2' },
        { label: '2:3', id: '2:3' },
        { label: '21:9 (Ultra-wide)', id: '21:9' },
      ],
      value: () => '1:1',
    },
    {
      id: 'imageSize',
      title: 'Resolution',
      type: 'dropdown',
      options: [
        { label: '0.5K (512)', id: '512' },
        { label: '1K', id: '1K' },
        { label: '2K', id: '2K' },
        { label: '4K', id: '4K' },
      ],
      value: () => '1K',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Google Gemini API key',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['gemini_image'],
    config: {
      tool: () => 'gemini_image',
      params: (params) => {
        if (!params.apiKey) {
          throw new Error('API key is required')
        }
        if (!params.prompt) {
          throw new Error('Prompt is required')
        }

        return {
          model: params.model || 'gemini-2.5-flash-image',
          prompt: params.prompt,
          aspectRatio: params.aspectRatio || '1:1',
          imageSize: params.imageSize || '1K',
          apiKey: params.apiKey,
        }
      },
    },
  },
  inputs: {
    prompt: { type: 'string', description: 'Image description prompt' },
    model: { type: 'string', description: 'Gemini image model' },
    aspectRatio: { type: 'string', description: 'Image aspect ratio' },
    imageSize: { type: 'string', description: 'Image resolution' },
    apiKey: { type: 'string', description: 'Google Gemini API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Generation response' },
    image: { type: 'file', description: 'Generated image file (UserFile)' },
    metadata: { type: 'json', description: 'Generation metadata' },
  },
}
