/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  FLOW_TRIGGER_EVENT_TYPES,
  FLOW_TRIGGER_IDS_WITHOUT_SUBSCRIPTIONS,
} from '@/lib/flow/trigger-contract'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/trigger-utils'
import { getTrigger } from '@/triggers'
import { FLOW_TRIGGER_OPTIONS } from '@/triggers/flow/constants'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

const flowTriggerIds = Object.values(TRIGGER_REGISTRY)
  .filter((trigger) => trigger.provider === 'flow')
  .map((trigger) => trigger.id)
  .sort()

const subscribedFlowTriggerIds = flowTriggerIds.filter(
  (triggerId) =>
    !FLOW_TRIGGER_IDS_WITHOUT_SUBSCRIPTIONS.includes(
      triggerId as (typeof FLOW_TRIGGER_IDS_WITHOUT_SUBSCRIPTIONS)[number]
    )
)

describe('flow trigger contract', () => {
  it('keeps flow trigger options in sync with the trigger registry', () => {
    expect(FLOW_TRIGGER_OPTIONS.map((option) => option.id).sort()).toEqual(flowTriggerIds)
  })

  it('keeps Flow subscription mappings in sync with deployable Flow triggers', () => {
    expect(Object.keys(FLOW_TRIGGER_EVENT_TYPES).sort()).toEqual(subscribedFlowTriggerIds)
  })

  it.each(flowTriggerIds)('injects stable payload examples for %s in the editor', (triggerId) => {
    const registryTrigger = TRIGGER_REGISTRY[triggerId]
    const hydratedTrigger = getTrigger(triggerId)

    const samplePayloadBlock = hydratedTrigger.subBlocks.find(
      (subBlock) => subBlock.id === `samplePayload_${triggerId}`
    )
    const testPayloadBlock = hydratedTrigger.subBlocks.find(
      (subBlock) => subBlock.id === `testPayload_${triggerId}`
    )

    const expectedPayload = JSON.stringify(
      registryTrigger.samplePayload ??
        generateMockPayloadFromOutputsDefinition(registryTrigger.outputs),
      null,
      2
    )

    expect(samplePayloadBlock?.type).toBe('code')
    expect(samplePayloadBlock?.defaultValue).toBe(expectedPayload)
    expect(testPayloadBlock?.type).toBe('code')
    expect(testPayloadBlock?.defaultValue).toBe(expectedPayload)
  })
})
