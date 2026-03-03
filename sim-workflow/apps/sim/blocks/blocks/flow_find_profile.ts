import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowFindProfileBlock: BlockConfig = {
  type: 'flow_find_profile',
  name: 'Flow .find Profile',
  description: 'Look up a .find profile by name',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'bjartek',
      required: true,
    },
  ],
  tools: {
    access: ['flow_find_profile'],
    config: {
      tool: () => 'flow_find_profile',
      params: (params) => ({ name: params.name }),
    },
  },
  inputs: {
    name: { type: 'string', description: '.find name to look up' },
  },
  outputs: {
    content: { type: 'string', description: 'Profile summary' },
    profile: { type: 'json', description: 'Profile data' },
  },
}
