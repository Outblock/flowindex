import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetBlockBlock: BlockConfig = {
  type: 'flow_get_block',
  name: 'Flow Get Block',
  description: 'Get Flow block by height or ID',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'height',
      title: 'Height',
      type: 'short-input',
      placeholder: '12345678',
    },
    {
      id: 'id',
      title: 'Block ID',
      type: 'short-input',
      placeholder: 'Block ID',
    },
  ],
  tools: {
    access: ['flow_get_block'],
    config: {
      tool: () => 'flow_get_block',
      params: (params) => ({ height: params.height, id: params.id }),
    },
  },
  inputs: {
    height: { type: 'string', description: 'Block height' },
    id: { type: 'string', description: 'Block ID' },
  },
  outputs: {
    content: { type: 'string', description: 'Block summary' },
    height: { type: 'string', description: 'Block height' },
    id: { type: 'string', description: 'Block ID' },
    parentId: { type: 'string', description: 'Parent block ID' },
    timestamp: { type: 'string', description: 'Block timestamp' },
    transactionCount: { type: 'string', description: 'Transaction count' },
  },
}
