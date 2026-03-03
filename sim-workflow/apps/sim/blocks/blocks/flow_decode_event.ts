import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowDecodeEventBlock: BlockConfig = {
  type: 'flow_decode_event',
  name: 'Flow Decode Event',
  description: 'Parse a Cadence event JSON string into structured fields',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'eventData',
      title: 'Event Data (JSON)',
      type: 'code',
      placeholder: '{"type":"A.1654653399040a61.FlowToken.TokensDeposited","value":{"fields":[...]}}',
      required: true,
    },
  ],
  tools: {
    access: ['flow_decode_event'],
    config: {
      tool: () => 'flow_decode_event',
      params: (params) => ({ eventData: params.eventData }),
    },
  },
  inputs: {
    eventData: { type: 'string', description: 'Cadence event JSON string' },
  },
  outputs: {
    content: { type: 'string', description: 'Decoded event summary' },
    eventType: { type: 'string', description: 'Event type identifier' },
    fields: { type: 'json', description: 'Parsed event fields' },
  },
}
