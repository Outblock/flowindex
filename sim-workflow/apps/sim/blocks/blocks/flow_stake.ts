import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowStakeBlock: BlockConfig = {
  type: 'flow_stake',
  name: 'Flow Stake',
  description: 'Stake FLOW tokens via FlowIDTableStaking',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '100.0',
      required: true,
    },
    {
      id: 'nodeId',
      title: 'Node ID (optional for delegator)',
      type: 'short-input',
      placeholder: 'Node ID hex string',
    },
    {
      id: 'signer',
      title: 'Signer',
      type: 'dropdown',
      options: [
        { label: 'Use Default', id: 'default' },
        { label: 'Manual Key', id: 'manual' },
      ],
      placeholder: 'Select a signer...',
      defaultValue: 'default',
    },
    {
      id: 'signerAddress',
      title: 'Signer Address',
      type: 'short-input',
      placeholder: '0x...',
      condition: { field: 'signer', value: 'manual' },
      required: { field: 'signer', value: 'manual' },
    },
    {
      id: 'signerPrivateKey',
      title: 'Signer Private Key',
      type: 'short-input',
      placeholder: 'Hex-encoded private key',
      condition: { field: 'signer', value: 'manual' },
      required: { field: 'signer', value: 'manual' },
    },
    {
      id: 'network',
      title: 'Network',
      type: 'dropdown',
      options: [
        { label: 'Mainnet', id: 'mainnet' },
        { label: 'Testnet', id: 'testnet' },
      ],
    },
  ],
  tools: {
    access: ['flow_stake'],
    config: {
      tool: () => 'flow_stake',
      params: (params) => {
        let signerJson: string | undefined
        const signerValue = params.signer as string
        if (signerValue === 'manual') {
          signerJson = JSON.stringify({
            signerMode: 'legacy',
            signerAddress: params.signerAddress,
            signerPrivateKey: params.signerPrivateKey,
          })
        } else if (typeof signerValue === 'string' && signerValue.startsWith('cloud:')) {
          signerJson = JSON.stringify({
            signerMode: 'cloud',
            signerKeyId: signerValue.replace('cloud:', ''),
          })
        } else if (typeof signerValue === 'string' && signerValue.startsWith('passkey:')) {
          signerJson = JSON.stringify({
            signerMode: 'passkey',
            signerCredentialId: signerValue.replace('passkey:', ''),
          })
        } else {
          signerJson = JSON.stringify({
            signerMode: 'legacy',
            signerAddress: params.signerAddress,
            signerPrivateKey: params.signerPrivateKey,
          })
        }

        return {
          amount: params.amount as string,
          nodeId: params.nodeId as string | undefined,
          signer: signerJson,
          signerAddress: params.signerAddress as string,
          signerPrivateKey: params.signerPrivateKey as string,
          network: (params.network as string) || 'mainnet',
        }
      },
    },
  },
  inputs: {
    amount: { type: 'string', description: 'Amount of FLOW to stake' },
    nodeId: { type: 'string', description: 'Node ID for delegator staking' },
    signerAddress: { type: 'string', description: 'Signer Flow address' },
    signerPrivateKey: { type: 'string', description: 'Signer private key' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}
