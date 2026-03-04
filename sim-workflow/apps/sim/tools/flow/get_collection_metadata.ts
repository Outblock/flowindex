import type { ToolConfig } from '@/tools/types'
import type { FlowGetCollectionMetadataParams } from '@/tools/flow/types'

export interface FlowGetCollectionMetadataResponse {
  success: boolean
  output: {
    content: string
    nftType: string
    metadata: Record<string, unknown>
  }
}

export const flowGetCollectionMetadataTool: ToolConfig<FlowGetCollectionMetadataParams, FlowGetCollectionMetadataResponse> = {
  id: 'flow_get_collection_metadata',
  name: 'Flow Get Collection Metadata',
  description: 'Get NFT collection metadata and statistics',
  version: '1.0.0',

  params: {
    nftType: {
      type: 'string',
      required: true,
      description: 'NFT collection type (e.g. TopShot)',
    },
  },

  request: {
    url: '/api/tools/flow/get-collection-metadata',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ nftType: params.nftType }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get collection metadata' },
        error: data.error,
      } as unknown as FlowGetCollectionMetadataResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Collection summary' },
    nftType: { type: 'string', description: 'NFT collection type' },
    metadata: { type: 'json', description: 'Collection metadata (name, description, total supply)' },
  },
}
