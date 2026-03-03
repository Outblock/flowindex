import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowNftCatalogLookupBlock: BlockConfig = {
  type: 'flow_nft_catalog_lookup',
  name: 'Flow NFT Catalog Lookup',
  description: 'Look up NFT collection info from the Flow NFT Catalog',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'collectionIdentifier',
      title: 'Collection Identifier',
      type: 'short-input',
      placeholder: 'TopShot',
      required: true,
    },
  ],
  tools: {
    access: ['flow_nft_catalog_lookup'],
    config: {
      tool: () => 'flow_nft_catalog_lookup',
      params: (params) => ({ collectionIdentifier: params.collectionIdentifier }),
    },
  },
  inputs: {
    collectionIdentifier: { type: 'string', description: 'NFT collection identifier' },
  },
  outputs: {
    content: { type: 'string', description: 'Collection info summary' },
    collection: { type: 'json', description: 'Collection metadata' },
  },
}
