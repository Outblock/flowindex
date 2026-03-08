import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowTransferFlowBlock: BlockConfig = {
  type: 'flow_transfer_flow',
  name: 'Flow Transfer FLOW',
  description: 'Transfer FLOW tokens to another account',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'recipient',
      title: 'Recipient Address',
      type: 'short-input',
      placeholder: '0x1654653399040a61',
      required: true,
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '10.0',
      required: true,
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
    access: ['flow_transfer_flow'],
    config: {
      tool: () => 'flow_transfer_flow',
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
          recipient: params.recipient as string,
          amount: params.amount as string,
          signer: signerJson,
          signerAddress: params.signerAddress as string,
          signerPrivateKey: params.signerPrivateKey as string,
          network: (params.network as string) || 'mainnet',
        }
      },
    },
  },
  inputs: {
    recipient: { type: 'string', description: 'Recipient Flow address' },
    amount: { type: 'string', description: 'Amount of FLOW to transfer' },
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
