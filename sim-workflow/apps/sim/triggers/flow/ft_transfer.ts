import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowFtTransferTrigger: TriggerConfig = {
  id: 'flow_ft_transfer',
  name: 'Flow FT Transfer',
  provider: 'flow',
  description: 'Triggered when a fungible token transfer occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_ft_transfer',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    includeDropdown: true,
    setupInstructions: flowSetupInstructions('fungible token transfer'),
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
        condition: { field: 'selectedTriggerId', value: 'flow_ft_transfer' },
      },
      {
        id: 'minAmount',
        title: 'Minimum Amount',
        type: 'short-input',
        placeholder: '0',
        description: 'Only trigger for transfers >= this amount',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_ft_transfer' },
      },
      {
        id: 'addressFilter',
        title: 'Address Filter',
        type: 'short-input',
        placeholder: '0x... (sender or receiver)',
        description: 'Only trigger for transfers involving this address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_ft_transfer' },
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
