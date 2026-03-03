import type { ToolConfig } from '@/tools/types'
import type { FlowNftCatalogLookupParams } from '@/tools/flow/types'

export interface FlowNftCatalogLookupResponse {
  success: boolean
  output: {
    content: string
    collection: Record<string, unknown>
  }
}

export const flowNftCatalogLookupTool: ToolConfig<
  FlowNftCatalogLookupParams,
  FlowNftCatalogLookupResponse
> = {
  id: 'flow_nft_catalog_lookup',
  name: 'Flow NFT Catalog Lookup',
  description: 'Look up NFT collection info from the Flow NFT Catalog',
  version: '1.0.0',

  params: {
    collectionIdentifier: {
      type: 'string',
      required: true,
      description: 'NFT collection identifier (e.g. TopShot)',
    },
  },

  request: {
    url: '/api/tools/flow/nft-catalog-lookup',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ collectionIdentifier: params.collectionIdentifier }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to look up collection', collection: {} },
        error: data.error,
      } as FlowNftCatalogLookupResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Collection info summary' },
    collection: { type: 'json', description: 'Collection metadata' },
  },
}
