import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetCollectionMetadataBlock: BlockConfig = {
  type: 'flow_get_collection_metadata',
  name: 'Flow Get Collection Metadata',
  description: 'Get NFT collection metadata and statistics',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'nftType',
      title: 'NFT Type',
      type: 'short-input',
      placeholder: 'TopShot',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_collection_metadata'],
    config: {
      tool: () => 'flow_get_collection_metadata',
      params: (params) => ({ nftType: params.nftType }),
    },
  },
  inputs: {
    nftType: { type: 'string', description: 'NFT collection type' },
  },
  outputs: {
    content: { type: 'string', description: 'Collection summary' },
    nftType: { type: 'string', description: 'NFT collection type' },
    metadata: { type: 'json', description: 'Collection metadata (name, description, total supply)' },
  },
}
