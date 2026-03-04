import type { ToolConfig } from '@/tools/types'
import type { FlowFormatAddressParams } from '@/tools/flow/types'

export interface FlowFormatAddressResponse {
  success: boolean
  output: {
    content: string
    formatted: string
    isValid: boolean
  }
}

export const flowFormatAddressTool: ToolConfig<FlowFormatAddressParams, FlowFormatAddressResponse> =
  {
    id: 'flow_format_address',
    name: 'Flow Format Address',
    description: 'Validate and format a Flow address',
    version: '1.0.0',

    params: {
      address: {
        type: 'string',
        required: true,
        description: 'Flow address to format',
      },
      format: {
        type: 'string',
        required: false,
        description: 'Output format: with_prefix, without_prefix, or padded (default: with_prefix)',
      },
    },

    request: {
      url: '/api/tools/flow/format-address',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        address: params.address,
        format: params.format ?? 'with_prefix',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!data.success) {
        return {
          success: false,
          output: { content: data.error || 'Failed to format address', formatted: '', isValid: false },
          error: data.error,
        } as unknown as FlowFormatAddressResponse
      }
      return { success: true, output: data.output }
    },

    outputs: {
      content: { type: 'string', description: 'Formatted address summary' },
      formatted: { type: 'string', description: 'Formatted address' },
      isValid: { type: 'boolean', description: 'Whether the address is valid' },
    },
  }
