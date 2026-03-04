import type { ToolConfig } from '@/tools/types'
import type { FlowWithdrawRewardsParams } from '@/tools/flow/types'

export interface FlowWithdrawRewardsResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowWithdrawRewardsTool: ToolConfig<
  FlowWithdrawRewardsParams,
  FlowWithdrawRewardsResponse
> = {
  id: 'flow_withdraw_rewards',
  name: 'Flow Withdraw Rewards',
  description: 'Withdraw staking rewards from FlowIDTableStaking',
  version: '1.0.0',

  params: {
    amount: {
      type: 'string',
      required: true,
      description: 'Amount of rewards to withdraw',
    },
    signerAddress: {
      type: 'string',
      required: true,
      description: 'Flow address of the signer',
    },
    signerPrivateKey: {
      type: 'string',
      required: true,
      description: 'Hex-encoded private key of the signer',
    },
    network: {
      type: 'string',
      required: false,
      description: 'Flow network: mainnet or testnet (default: mainnet)',
    },
  },

  request: {
    url: '/api/tools/flow/withdraw-rewards',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      amount: params.amount,
      signerAddress: params.signerAddress,
      signerPrivateKey: params.signerPrivateKey,
      network: params.network ?? 'mainnet',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to withdraw rewards',
          transactionId: '',
          status: 'ERROR',
        },
        error: data.error,
      } as unknown as FlowWithdrawRewardsResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}
