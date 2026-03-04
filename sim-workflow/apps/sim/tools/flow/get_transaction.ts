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
    isEvm: string
  }
}

export const flowGetTransactionTool: ToolConfig<
  FlowGetTransactionParams,
  FlowGetTransactionResponse
> = {
  id: 'flow_get_transaction',
  name: 'Flow Get Transaction',
  description: 'Get Flow transaction details',
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
    isEvm: { type: 'string', description: 'Whether transaction is EVM' },
  },
}
