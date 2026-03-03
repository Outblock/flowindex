import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowFlowIndexApiBlock: BlockConfig = {
  type: 'flow_flowindex_api',
  name: 'Flow FlowIndex API',
  description: 'Generic FlowIndex API query',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'endpoint',
      title: 'Endpoint',
      type: 'short-input',
      placeholder: '/flow/v1/blocks?limit=5',
      required: true,
    },
    {
      id: 'method',
      title: 'Method',
      type: 'dropdown',
      options: [
        { label: 'GET', id: 'GET' },
        { label: 'POST', id: 'POST' },
      ],
    },
    {
      id: 'body',
      title: 'Body (JSON)',
      type: 'code',
      placeholder: '{}',
    },
  ],
  tools: {
    access: ['flow_flowindex_api'],
    config: {
      tool: () => 'flow_flowindex_api',
      params: (params) => ({
        endpoint: params.endpoint,
        method: params.method ?? 'GET',
        body: params.body,
      }),
    },
  },
  inputs: {
    endpoint: { type: 'string', description: 'API endpoint path' },
    method: { type: 'string', description: 'HTTP method' },
    body: { type: 'string', description: 'Request body (JSON)' },
  },
  outputs: {
    content: { type: 'string', description: 'API response summary' },
    data: { type: 'json', description: 'Full API response' },
  },
}
