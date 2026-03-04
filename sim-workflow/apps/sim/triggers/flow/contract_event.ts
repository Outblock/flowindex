import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowContractEventTrigger: TriggerConfig = {
  id: 'flow_contract_event',
  name: 'Flow Contract Event',
  provider: 'flow',
  description: 'Triggered when a specific contract event is emitted on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_contract_event',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('contract event'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'eventType',
        title: 'Event Type',
        type: 'short-input',
        placeholder: 'A.0x1654653399040a61.FlowToken.TokensDeposited',
        description: 'Full Cadence event type identifier',
        required: true,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_contract_event' },
      },
    ],
  }),

  outputs: {
    eventType: { type: 'string', description: 'Event type identifier' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'number', description: 'Block height' },
    data: { type: 'json', description: 'Event payload data' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
