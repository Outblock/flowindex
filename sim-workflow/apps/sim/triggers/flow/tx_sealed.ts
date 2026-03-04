import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowTxSealedTrigger: TriggerConfig = {
  id: 'flow_tx_sealed',
  name: 'Flow Transaction Sealed',
  provider: 'flow',
  description: 'Triggered when a transaction is sealed on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_tx_sealed',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('transaction sealed'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'addressFilter',
        title: 'Address Filter',
        type: 'short-input',
        placeholder: '0x... (proposer, payer, or authorizer)',
        description: 'Only trigger for transactions involving this address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_tx_sealed' },
      },
    ],
  }),

  outputs: {
    transactionId: { type: 'string', description: 'Transaction ID' },
    proposer: { type: 'string', description: 'Proposer address' },
    payer: { type: 'string', description: 'Payer address' },
    authorizers: { type: 'array', description: 'Authorizer addresses' },
    status: { type: 'string', description: 'Transaction status' },
    blockHeight: { type: 'number', description: 'Block height' },
    isEvm: { type: 'boolean', description: 'Whether this is an EVM transaction' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
