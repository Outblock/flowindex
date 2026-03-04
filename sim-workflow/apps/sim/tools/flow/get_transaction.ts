import type { ToolConfig } from '@/tools/types'
import type { FlowGetTransactionParams } from '@/tools/flow/types'

export interface FlowGetTransactionResponse {
  success: boolean
  output: {
    content: string
    id: string
    blockHeight: string
    status: string
    proposer: string
    payer: string
    authorizers: string[]
    gasLimit: string
    fee: string
    eventCount: string
    error: string
    isEvm: string
    evmHash: string
    contractImports: string[]
    arguments: string
    events: string
    timestamp: string
    script: string
  }
}

export const flowGetTransactionTool: ToolConfig<
  FlowGetTransactionParams,
  FlowGetTransactionResponse
> = {
  id: 'flow_get_transaction',
  name: 'Flow Get Transaction',
  description: 'Get Flow transaction details by ID',
  version: '1.0.0',

  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Transaction ID',
    },
  },

  request: {
    url: '/api/tools/flow/get-transaction',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ id: params.id }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get transaction' },
        error: data.error,
      } as unknown as FlowGetTransactionResponse
    }
    return { success: true, output: data.output }
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
