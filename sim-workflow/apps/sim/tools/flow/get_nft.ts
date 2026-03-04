import type { ToolConfig } from '@/tools/types'
import type { FlowGetNftParams } from '@/tools/flow/types'

export interface FlowGetNftResponse {
  success: boolean
  output: {
    content: string
    nftType: string
    nftId: string
    metadata: Record<string, unknown>
  }
}

export const flowGetNftTool: ToolConfig<FlowGetNftParams, FlowGetNftResponse> = {
  id: 'flow_get_nft',
  name: 'Flow Get NFT',
  description: 'Get NFT metadata and ownership details',
  version: '1.0.0',

  params: {
    nftType: {
      type: 'string',
      required: true,
      description: 'NFT collection type (e.g. TopShot)',
    },
    nftId: {
      type: 'string',
      required: true,
      description: 'NFT item ID',
    },
  },

  request: {
    url: '/api/tools/flow/get-nft',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ nftType: params.nftType, nftId: params.nftId }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get NFT' },
        error: data.error,
      } as unknown as FlowGetNftResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'NFT summary' },
    nftType: { type: 'string', description: 'NFT collection type' },
    nftId: { type: 'string', description: 'NFT item ID' },
    metadata: { type: 'object', description: 'NFT metadata' },
  },
}
