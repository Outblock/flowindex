import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetBlockBlock: BlockConfig = {
  type: 'flow_get_block',
  name: 'Flow Get Block',
  description: 'Get Flow block by height',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'height',
      title: 'Block Height',
      type: 'short-input',
      placeholder: 'e.g. 144092842',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_block'],
    config: {
      tool: () => 'flow_get_block',
      params: (params) => ({ height: params.height }),
    },
  },
  inputs: {
    height: { type: 'string', description: 'Block height' },
  },
  outputs: {
    content: { type: 'string', description: 'Block summary' },
    height: { type: 'string', description: 'Block height' },
    id: { type: 'string', description: 'Block ID' },
    parentId: { type: 'string', description: 'Parent block ID' },
    timestamp: { type: 'string', description: 'Block timestamp' },
    transactionCount: { type: 'string', description: 'Transaction count' },
    evmTransactionCount: { type: 'string', description: 'EVM transaction count' },
    totalGasUsed: { type: 'string', description: 'Total gas used' },
    fees: { type: 'string', description: 'Total fees' },
  },
}
