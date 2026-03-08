import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowSendBlock: BlockConfig = {
  type: 'flow_send',
  name: 'Flow Send',
  description: 'Send tokens or NFTs across Flow and EVM networks',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
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
      required: true,
    },
    {
      id: 'signerAddress',
      title: 'Signer Address',
      type: 'short-input',
      placeholder: '0x... (Flow address)',
      condition: { field: 'signer', value: 'manual' },
      required: { field: 'signer', value: 'manual' },
    },
    {
      id: 'signerPrivateKey',
      title: 'Private Key',
      type: 'short-input',
      placeholder: 'Hex-encoded private key',
      condition: { field: 'signer', value: 'manual' },
      required: { field: 'signer', value: 'manual' },
    },
    {
      id: 'sendType',
      title: 'Type',
      type: 'dropdown',
      options: [
        { label: 'Token', id: 'token' },
        { label: 'NFT', id: 'nft' },
      ],
      defaultValue: 'token',
    },
    {
      id: 'sender',
      title: 'From',
      type: 'short-input',
      placeholder: '0x... (Flow or EVM address)',
      required: true,
    },
    {
      id: 'receiver',
      title: 'To',
      type: 'short-input',
      placeholder: '0x... (Flow or EVM address)',
      required: true,
    },
    {
      id: 'flowIdentifier',
      title: 'Token / Collection',
      type: 'short-input',
      placeholder: 'A.1654653399040a61.FlowToken.Vault',
      required: true,
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '10.0',
      condition: { field: 'sendType', value: 'token' },
      required: { field: 'sendType', value: 'token' },
    },
    {
      id: 'nftIds',
      title: 'NFT IDs',
      type: 'short-input',
      placeholder: '1, 2, 3 (comma-separated)',
      condition: { field: 'sendType', value: 'nft' },
      required: { field: 'sendType', value: 'nft' },
    },
    {
      id: 'network',
      title: 'Network',
      type: 'dropdown',
      options: [
        { label: 'Mainnet', id: 'mainnet' },
        { label: 'Testnet', id: 'testnet' },
      ],
      defaultValue: 'mainnet',
    },
  ],
  tools: {
    access: ['flow_send'],
    config: {
      tool: () => 'flow_send',
      params: (params) => {
        // Build signer JSON from the selected signer type
        let signerJson: string
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
          signer: signerJson,
          sendType: params.sendType as string,
          sender: params.sender as string,
          receiver: params.receiver as string,
          flowIdentifier: params.flowIdentifier as string,
          amount: params.amount as string | undefined,
          nftIds: params.nftIds as string | undefined,
          network: (params.network as string) || 'mainnet',
        }
      },
    },
  },
  inputs: {
    sender: { type: 'string', description: 'Sender address' },
    receiver: { type: 'string', description: 'Receiver address' },
    amount: { type: 'string', description: 'Token amount' },
    flowIdentifier: { type: 'string', description: 'Token/collection identifier' },
  },
  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}
