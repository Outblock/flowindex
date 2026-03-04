import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowAccountEventTrigger: TriggerConfig = {
  id: 'flow_account_event',
  name: 'Flow Account Event',
  provider: 'flow',
  description: 'Triggered when an account-related event occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_account_event',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('account event'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'eventCategory',
        title: 'Event Category',
        type: 'dropdown',
        options: [
          { label: 'Any Account Event', id: 'any' },
          { label: 'Account Created', id: 'account.created' },
          { label: 'Key Added', id: 'account.key.added' },
          { label: 'Key Removed', id: 'account.key.removed' },
          { label: 'Contract Added', id: 'account.contract.added' },
          { label: 'Contract Updated', id: 'account.contract.updated' },
          { label: 'Contract Removed', id: 'account.contract.removed' },
        ],
        value: () => 'any',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_account_event' },
      },
      {
        id: 'addressFilter',
        title: 'Address Filter',
        type: 'short-input',
        placeholder: '0x... (optional)',
        description: 'Only trigger for events on this account',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_account_event' },
      },
    ],
  }),

  outputs: {
    eventType: { type: 'string', description: 'Account event type' },
    address: { type: 'string', description: 'Account address' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'number', description: 'Block height' },
    data: { type: 'json', description: 'Event data' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
