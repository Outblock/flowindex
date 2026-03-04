import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowScheduleTrigger: TriggerConfig = {
  id: 'flow_schedule',
  name: 'Flow Schedule',
  provider: 'flow',
  description: 'Triggered on a schedule to run Flow blockchain queries or actions',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_schedule',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('scheduled check'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'cronExpression',
        title: 'Cron Expression',
        type: 'short-input',
        placeholder: '*/5 * * * *',
        description: 'Cron schedule (e.g. every 5 minutes: */5 * * * *)',
        required: true,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_schedule' },
      },
    ],
  }),

  outputs: {
    triggeredAt: { type: 'string', description: 'Trigger timestamp' },
    scheduleName: { type: 'string', description: 'Schedule identifier' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
