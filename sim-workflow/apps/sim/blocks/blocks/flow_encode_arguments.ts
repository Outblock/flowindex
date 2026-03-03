import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowEncodeArgumentsBlock: BlockConfig = {
  type: 'flow_encode_arguments',
  name: 'Flow Encode Arguments',
  description: 'Convert JSON values to FCL argument format',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'arguments',
      title: 'Arguments (JSON)',
      type: 'code',
      placeholder: '["100.0", "0x1654653399040a61"]',
      required: true,
    },
    {
      id: 'types',
      title: 'Cadence Types (JSON)',
      type: 'code',
      placeholder: '["UFix64", "Address"]',
      required: true,
    },
  ],
  tools: {
    access: ['flow_encode_arguments'],
    config: {
      tool: () => 'flow_encode_arguments',
      params: (params) => ({
        arguments: params.arguments,
        types: params.types,
      }),
    },
  },
  inputs: {
    arguments: { type: 'string', description: 'JSON array of argument values' },
    types: { type: 'string', description: 'JSON array of Cadence type names' },
  },
  outputs: {
    content: { type: 'string', description: 'Encoded arguments summary' },
    encoded: { type: 'json', description: 'FCL-formatted arguments' },
  },
}
