import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowLargeTransferTrigger: TriggerConfig = {
  id: 'flow_large_transfer',
  name: 'Flow Large Transfer',
  provider: 'flow',
  description: 'Triggered when a large token transfer exceeds a threshold',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_large_transfer',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('large transfer'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'token',
        title: 'Token',
        type: 'dropdown',
        options: [
          { label: 'Any Token', id: 'any' },
          { label: 'FLOW', id: 'flow' },
          { label: 'USDC', id: 'usdc' },
          { label: 'stFlow', id: 'stflow' },
        ],
        value: () => 'any',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_large_transfer' },
      },
      {
        id: 'threshold',
        title: 'Threshold Amount',
        type: 'short-input',
        placeholder: '10000',
        description: 'Trigger when transfer amount exceeds this value',
        required: true,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_large_transfer' },
      },
    ],
  }),

  outputs: {
    transactionId: { type: 'string', description: 'Transaction ID' },
    from: { type: 'string', description: 'Sender address' },
    to: { type: 'string', description: 'Receiver address' },
    amount: { type: 'string', description: 'Transfer amount' },
    token: { type: 'string', description: 'Token type' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
