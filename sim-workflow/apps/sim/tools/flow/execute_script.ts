import type { ToolConfig } from '@/tools/types'
import type { FlowExecuteScriptParams } from '@/tools/flow/types'

export interface FlowExecuteScriptResponse {
  success: boolean
  output: {
    content: string
    result: unknown
  }
}

export const flowExecuteScriptTool: ToolConfig<FlowExecuteScriptParams, FlowExecuteScriptResponse> =
  {
    id: 'flow_execute_script',
    name: 'Flow Execute Script',
    description: 'Execute a Cadence script on the Flow blockchain and return the result',
    version: '1.0.0',

    params: {
      script: {
        type: 'string',
        required: true,
        description: 'Cadence script to execute',
      },
      arguments: {
        type: 'string',
        required: false,
        description: 'JSON array of arguments (default: [])',
      },
      network: {
        type: 'string',
        required: false,
        description: 'Flow network: mainnet or testnet (default: mainnet)',
      },
    },

    request: {
      url: '/api/tools/flow/execute-script',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        script: params.script,
        arguments: params.arguments ?? '[]',
        network: params.network ?? 'mainnet',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!data.success) {
        return {
          success: false,
          output: { content: data.error || 'Failed to execute script', result: null },
          error: data.error,
        } as FlowExecuteScriptResponse
      }
      return { success: true, output: data.output }
    },

    outputs: {
      content: { type: 'string', description: 'JSON stringified result' },
      result: { type: 'json', description: 'Raw script result' },
    },
  }
