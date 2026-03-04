import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowWhaleActivityTrigger: TriggerConfig = {
  id: 'flow_whale_activity',
  name: 'Flow Whale Activity',
  provider: 'flow',
  description: 'Triggered when a watched whale address performs any transaction',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_whale_activity',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('whale activity'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'addressList',
        title: 'Whale Addresses',
        type: 'long-input',
        placeholder: '0x...\n0x...\n(one per line)',
        description: 'List of addresses to monitor (one per line)',
        required: true,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_whale_activity' },
      },
    ],
  }),

  outputs: {
    address: { type: 'string', description: 'Whale address that transacted' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    role: { type: 'string', description: 'Role in transaction (proposer, payer, authorizer)' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
