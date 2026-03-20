import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetEventsBlock: BlockConfig = {
  type: 'flow_get_events',
  name: 'Flow Search Events',
  description: 'Search Flow event types by name pattern',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'eventType',
      title: 'Event Name / Pattern',
      type: 'short-input',
      placeholder: 'TokensDeposited',
      required: true,
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
    },
  ],
  tools: {
    access: ['flow_get_events'],
    config: {
      tool: () => 'flow_get_events',
      params: (params) => ({
        eventType: params.eventType,
        limit: params.limit,
      }),
    },
  },
  inputs: {
    eventType: { type: 'string', description: 'Event name or pattern to search' },
    limit: { type: 'string', description: 'Max results' },
  },
  outputs: {
    content: { type: 'string', description: 'Search results summary' },
    events: { type: 'array', description: 'Matching event types with occurrence counts' },
    count: { type: 'string', description: 'Number of event types found' },
  },
}
