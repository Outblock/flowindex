import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/blocks', () => ({
  getAllBlocks: vi.fn(() => []),
  getBlock: vi.fn(() => ({
    triggers: {
      available: ['flow_new_account'],
    },
  })),
}))
vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(() => ({
    id: 'flow_new_account',
    outputs: {
      address: { type: 'string', description: 'Newly created account address' },
      blockHeight: { type: 'number', description: 'Block height' },
    },
  })),
}))

import { extractTriggerMockPayload } from '@/lib/workflows/triggers/trigger-utils'

describe('extractTriggerMockPayload', () => {
  it('prefers a custom test payload when present', () => {
    const payload = extractTriggerMockPayload({
      blockId: 'trigger-1',
      path: 'external-trigger' as any,
      block: {
        type: 'flow_new_account_trigger',
        subBlocks: {
          selectedTriggerId: { value: 'flow_new_account' },
          testPayload_flow_new_account: {
            value: JSON.stringify({
              address: '0x1234',
              blockHeight: 999,
            }),
          },
        },
      },
    })

    expect(payload).toEqual({
      address: '0x1234',
      blockHeight: 999,
    })
  })

  it('falls back to generated mock payload when custom payload is invalid JSON', () => {
    const payload = extractTriggerMockPayload({
      blockId: 'trigger-1',
      path: 'external-trigger' as any,
      block: {
        type: 'flow_new_account_trigger',
        subBlocks: {
          selectedTriggerId: { value: 'flow_new_account' },
          testPayload_flow_new_account: {
            value: '{"address": "0x1234",',
          },
        },
      },
    })

    expect(payload).toEqual({
      address: 'mock_address',
      blockHeight: 42,
    })
  })
})
