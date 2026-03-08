import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowAddKeyBlock: BlockConfig = {
  type: 'flow_add_key',
  name: 'Flow Add Key',
  description: 'Add a key to a Flow account',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'publicKey',
      title: 'Public Key (hex)',
      type: 'short-input',
      placeholder: 'Hex-encoded public key',
      required: true,
    },
    {
      id: 'sigAlgo',
      title: 'Signature Algorithm',
      type: 'dropdown',
      options: [
        { label: 'ECDSA_P256', id: 'ECDSA_P256' },
        { label: 'ECDSA_secp256k1', id: 'ECDSA_secp256k1' },
      ],
    },
    {
      id: 'hashAlgo',
      title: 'Hash Algorithm',
      type: 'dropdown',
      options: [
        { label: 'SHA3_256', id: 'SHA3_256' },
        { label: 'SHA2_256', id: 'SHA2_256' },
      ],
    },
    {
      id: 'weight',
      title: 'Key Weight',
      type: 'short-input',
      placeholder: '1000',
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
    access: ['flow_add_key'],
    config: {
      tool: () => 'flow_add_key',
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
          publicKey: params.publicKey as string,
          sigAlgo: (params.sigAlgo as string) || 'ECDSA_P256',
          hashAlgo: (params.hashAlgo as string) || 'SHA3_256',
          weight: (params.weight as string) || '1000',
          signer: signerJson,
          signerAddress: params.signerAddress as string,
          signerPrivateKey: params.signerPrivateKey as string,
          network: (params.network as string) || 'mainnet',
        }
      },
    },
  },
  inputs: {
    publicKey: { type: 'string', description: 'Hex-encoded public key to add' },
    sigAlgo: { type: 'string', description: 'Signature algorithm' },
    hashAlgo: { type: 'string', description: 'Hash algorithm' },
    weight: { type: 'string', description: 'Key weight (default 1000)' },
    signerAddress: { type: 'string', description: 'Signer Flow address' },
    signerPrivateKey: { type: 'string', description: 'Signer private key' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'Key addition summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}
