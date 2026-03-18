import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const { getTriggerMock } = vi.hoisted(() => ({
  getTriggerMock: vi.fn(),
}))

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
  getTrigger: getTriggerMock,
}))

import { extractTriggerMockPayload } from '@/lib/workflows/triggers/trigger-utils'

describe('extractTriggerMockPayload', () => {
  it('uses a trigger sample payload when no custom test payload is provided', () => {
    getTriggerMock.mockReturnValue({
      id: 'flow_new_account',
      samplePayload: {
        eventType: 'account.created',
        address: '0x1234',
        blockHeight: 999,
      },
      outputs: {
        address: {
          type: 'string',
          description: 'Newly created account address',
        },
        blockHeight: { type: 'number', description: 'Block height' },
      },
    })

    const payload = extractTriggerMockPayload({
      blockId: 'trigger-1',
      path: 'external-trigger' as any,
      block: {
        type: 'flow_new_account_trigger',
        subBlocks: {
          selectedTriggerId: { value: 'flow_new_account' },
        },
      },
    })

    expect(payload).toEqual({
      eventType: 'account.created',
      address: '0x1234',
      blockHeight: 999,
    })
  })

  it('prefers a custom test payload when present', () => {
    getTriggerMock.mockReturnValue({
      id: 'flow_new_account',
      outputs: {
        address: {
          type: 'string',
          description: 'Newly created account address',
        },
        blockHeight: { type: 'number', description: 'Block height' },
      },
    })

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
    getTriggerMock.mockReturnValue({
      id: 'flow_new_account',
      outputs: {
        address: {
          type: 'string',
          description: 'Newly created account address',
        },
        blockHeight: { type: 'number', description: 'Block height' },
      },
    })

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
