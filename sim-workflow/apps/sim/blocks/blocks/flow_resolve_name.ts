import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowResolveNameBlock: BlockConfig = {
  type: 'flow_resolve_name',
  name: 'Flow Resolve Name',
  description: 'Resolve .find / .fn name to Flow address',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'dapper.find',
      required: true,
    },
  ],
  tools: {
    access: ['flow_resolve_name'],
    config: {
      tool: () => 'flow_resolve_name',
      params: (params) => ({ name: params.name }),
    },
  },
  inputs: {
    name: { type: 'string', description: 'Name to resolve' },
  },
  outputs: {
    content: { type: 'string', description: 'Resolution summary' },
    name: { type: 'string', description: 'Input name' },
    address: { type: 'string', description: 'Resolved Flow address' },
  },
}
