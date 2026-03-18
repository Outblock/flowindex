/**
 * @vitest-environment node
 */
import { createEnvMock, databaseMock, drizzleOrmMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { decryptApiKeyFromStorageMock, encryptApiKeyForStorageMock } = vi.hoisted(() => ({
  decryptApiKeyFromStorageMock: vi.fn().mockResolvedValue('flow-api-key'),
  encryptApiKeyForStorageMock: vi.fn(),
}))

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@sim/db', () => databaseMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    FLOWINDEX_API_URL: 'https://flowindex.test',
    FLOWINDEX_SERVICE_KEY: 'flow-service-key',
  })
)
vi.mock('@/lib/api-key/auth', () => ({
  decryptApiKeyFromStorage: decryptApiKeyFromStorageMock,
  encryptApiKeyForStorage: encryptApiKeyForStorageMock,
}))
vi.mock('@sim/db/schema', () => ({
  flowindexApiKey: {
    userId: 'flowindex_api_key.user_id',
    encryptedKey: 'flowindex_api_key.encrypted_key',
    endpointId: 'flowindex_api_key.endpoint_id',
    signingSecret: 'flowindex_api_key.signing_secret',
    updatedAt: 'flowindex_api_key.updated_at',
  },
}))

import { db } from '@sim/db'
import { extractFlowConditions, registerFlowSubscriptions } from '@/lib/flow/subscription-bridge'

const mockDb = db as any

function createSelectChain(result: any) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
}

describe('registerFlowSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.select.mockReturnValue(
      createSelectChain([
        {
          userId: 'user-1',
          encryptedKey: 'encrypted-key',
          endpointId: 'endpoint-old',
          signingSecret: 'stored-secret',
        },
      ])
    )

    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })
  })

  it('uses the endpoint matching the current callback URL when the cached endpoint points to an old path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'endpoint-old',
          url: 'https://studio.test/api/webhooks/trigger/old-path',
          signing_secret: 'old-secret',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'endpoint-new',
              url: 'https://studio.test/api/webhooks/trigger/new-path',
              signing_secret: 'new-secret',
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'sub-123' }))

    const originalFetch = global.fetch
    global.fetch = fetchMock as typeof fetch

    try {
      const result = await registerFlowSubscriptions({
        workflowId: 'workflow-1',
        triggerId: 'flow_new_account',
        conditions: {},
        callbackUrl: 'https://studio.test/api/webhooks/trigger/new-path',
        userId: 'user-1',
      })

      expect(result).toEqual({
        subscriptionId: 'sub-123',
        signingSecret: 'new-secret',
      })

      const [, subscriptionRequest] = fetchMock.mock.calls[2] as [
        string,
        { body: string; method: string },
      ]
      expect(subscriptionRequest.method).toBe('POST')
      expect(JSON.parse(subscriptionRequest.body)).toMatchObject({
        endpoint_id: 'endpoint-new',
        event_type: 'account.created',
        workflow_id: 'workflow-1',
      })
    } finally {
      global.fetch = originalFetch
    }
  })

  it('throws when FlowIndex subscription registration fails instead of silently succeeding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'endpoint-old',
          url: 'https://studio.test/api/webhooks/trigger/current-path',
          signing_secret: 'stored-secret',
        })
      )
      .mockResolvedValueOnce(
        new Response('upstream exploded', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        })
      )

    const originalFetch = global.fetch
    global.fetch = fetchMock as typeof fetch

    try {
      await expect(
        registerFlowSubscriptions({
          workflowId: 'workflow-1',
          triggerId: 'flow_new_account',
          conditions: {},
          callbackUrl: 'https://studio.test/api/webhooks/trigger/current-path',
          userId: 'user-1',
        })
      ).rejects.toThrow(
        'Failed to register Flow subscription: FlowIndex API 500: upstream exploded'
      )
    } finally {
      global.fetch = originalFetch
    }
  })
})

describe('extractFlowConditions', () => {
  it('normalizes token aliases into contract identifiers for FT-style triggers', () => {
    expect(
      extractFlowConditions('flow_ft_transfer', {
        token: 'flow',
        minAmount: '10',
        addressFilter: '0x1654653399040a61',
      })
    ).toEqual({
      token_contract: 'A.1654653399040a61.FlowToken',
      min_amount: 10,
      addresses: ['1654653399040a61'],
    })
  })

  it('derives contract filters from a full Cadence event type identifier', () => {
    expect(
      extractFlowConditions('flow_contract_event', {
        eventType: 'A.0x1654653399040a61.FlowToken.TokensDeposited',
      })
    ).toEqual({
      contract_address: '1654653399040a61',
      event_names: ['TokensDeposited'],
    })
  })

  it('preserves account and defi category filters for unified event subscriptions', () => {
    expect(
      extractFlowConditions('flow_account_event', {
        addressFilter: '0x01',
        eventCategory: 'account.contract.added',
      })
    ).toEqual({
      addresses: ['01'],
      event_types: ['account.contract.added'],
    })

    expect(
      extractFlowConditions('flow_defi_event', {
        pool: 'pair-1',
        defiDirection: 'add_liquidity',
      })
    ).toEqual({
      pair_id: 'pair-1',
      event_type: 'add_liquidity',
    })
  })
})
