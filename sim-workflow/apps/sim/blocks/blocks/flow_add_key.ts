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
      id: 'signerAddress',
      title: 'Signer Address',
      type: 'short-input',
      placeholder: '0x...',
      required: true,
    },
    {
      id: 'signerPrivateKey',
      title: 'Signer Private Key',
      type: 'short-input',
      placeholder: 'Hex-encoded private key',
      required: true,
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
      params: (params) => ({
        publicKey: params.publicKey,
        sigAlgo: params.sigAlgo ?? 'ECDSA_P256',
        hashAlgo: params.hashAlgo ?? 'SHA3_256',
        weight: params.weight ?? '1000',
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
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
