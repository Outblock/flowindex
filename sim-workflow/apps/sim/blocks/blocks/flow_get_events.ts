import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetEventsBlock: BlockConfig = {
  type: 'flow_get_events',
  name: 'Flow Get Events',
  description: 'Search Flow events by type and block range',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'eventType',
      title: 'Event Type',
      type: 'short-input',
      placeholder: 'A.1654653399040a61.FlowToken.TokensDeposited',
      required: true,
    },
    {
      id: 'startHeight',
      title: 'Start Height',
      type: 'short-input',
      placeholder: 'Start block height',
    },
    {
      id: 'endHeight',
      title: 'End Height',
      type: 'short-input',
      placeholder: 'End block height',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
    },
  ],
  tools: {
    access: ['flow_get_events'],
    config: {
      tool: () => 'flow_get_events',
      params: (params) => ({
        eventType: params.eventType,
        startHeight: params.startHeight,
        endHeight: params.endHeight,
        limit: params.limit,
      }),
    },
  },
  inputs: {
    eventType: { type: 'string', description: 'Event type' },
    startHeight: { type: 'string', description: 'Start block height' },
    endHeight: { type: 'string', description: 'End block height' },
    limit: { type: 'string', description: 'Max results' },
  },
  outputs: {
    content: { type: 'string', description: 'Events summary' },
    events: { type: 'array', description: 'Event records' },
    count: { type: 'string', description: 'Number of events returned' },
  },
}
