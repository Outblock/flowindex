import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetTransactionBlock: BlockConfig = {
  type: 'flow_get_transaction',
  name: 'Flow Get Transaction',
  description: 'Get Flow transaction details by ID',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'id',
      title: 'Transaction ID',
      type: 'short-input',
      placeholder: 'e.g. a1b2c3d4...',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_transaction'],
    config: {
      tool: () => 'flow_get_transaction',
      params: (params) => ({ id: params.id }),
    },
  },
  inputs: {
    id: { type: 'string', description: 'Transaction ID' },
  },
  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    id: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'string', description: 'Block height' },
    status: { type: 'string', description: 'Transaction status' },
    proposer: { type: 'string', description: 'Proposer address' },
    payer: { type: 'string', description: 'Payer address' },
    authorizers: { type: 'array', description: 'Authorizer addresses' },
    gasLimit: { type: 'string', description: 'Gas limit' },
    fee: { type: 'string', description: 'Transaction fee in FLOW' },
    eventCount: { type: 'string', description: 'Number of events' },
    error: { type: 'string', description: 'Error message if failed' },
    isEvm: { type: 'string', description: 'Whether transaction is EVM' },
    evmHash: { type: 'string', description: 'EVM transaction hash' },
    contractImports: { type: 'array', description: 'Imported contracts' },
    arguments: { type: 'string', description: 'Transaction arguments (JSON)' },
    events: { type: 'string', description: 'Transaction events (JSON)' },
    timestamp: { type: 'string', description: 'Transaction timestamp' },
    script: { type: 'string', description: 'Cadence script' },
  },
}
