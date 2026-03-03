import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowNftTransferTrigger: TriggerConfig = {
  id: 'flow_nft_transfer',
  name: 'Flow NFT Transfer',
  provider: 'flow',
  description: 'Triggered when an NFT transfer occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_nft_transfer',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('NFT transfer'),
    extraFields: [
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'e.g. TopShot (leave empty for all)',
        description: 'Filter by NFT collection name',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_nft_transfer' },
      },
      {
        id: 'addressFilter',
        title: 'Address Filter',
        type: 'short-input',
        placeholder: '0x... (sender or receiver)',
        description: 'Only trigger for transfers involving this address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_nft_transfer' },
      },
    ],
  }),

  outputs: {
    transactionId: { type: 'string', description: 'Transaction ID' },
    from: { type: 'string', description: 'Sender address' },
    to: { type: 'string', description: 'Receiver address' },
    nftId: { type: 'string', description: 'NFT ID' },
    nftType: { type: 'string', description: 'NFT type/collection' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
