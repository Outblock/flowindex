/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalAuth, mockFlowApiFetch } = vi.hoisted(() => ({
  mockCheckInternalAuth: vi.fn(),
  mockFlowApiFetch: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/app/api/tools/flow/utils', () => ({
  flowApiFetch: mockFlowApiFetch,
}))

import { POST } from './route'

const mockPricesResponse = {
  data: [
    {
      prices: {
        FLOW: { asset: 'FLOW', price: 0.85, price_change_24h: 2.5, as_of: '2026-03-20T00:00:00Z' },
        USDC: { asset: 'USDC', price: 1.0, price_change_24h: 0.01, as_of: '2026-03-20T00:00:00Z' },
        STFLOW: { asset: 'STFLOW', price: 0.92, price_change_24h: -1.2, as_of: '2026-03-20T00:00:00Z' },
      },
      token_map: {
        FlowToken: 'FLOW',
        FiatToken: 'USDC',
      },
    },
  ],
}

describe('flow/get-token-price route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true })
    mockFlowApiFetch.mockResolvedValue(mockPricesResponse)
  })

  it('returns 401 when auth fails', async () => {
    mockCheckInternalAuth.mockResolvedValue({ success: false, error: 'unauthorized' })
    const req = createMockRequest('POST', { symbol: 'FLOW' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns specific token price', async () => {
    const req = createMockRequest('POST', { symbol: 'FLOW' })
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.symbol).toBe('FLOW')
    expect(json.output.price).toBe('0.85')
    expect(json.output.priceChange24h).toBe('2.5')
    expect(json.output.content).toContain('$0.850000')
    expect(json.output.content).toContain('+2.50%')
  })

  it('resolves token via contract name mapping', async () => {
    const req = createMockRequest('POST', { symbol: 'FlowToken' })
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.symbol).toBe('FLOW')
    expect(json.output.price).toBe('0.85')
  })

  it('returns all prices when no symbol specified', async () => {
    const req = createMockRequest('POST', {})
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.prices).toHaveLength(3)
    expect(json.output.content).toContain('3 tokens with price data')
  })

  it('returns empty when token not found', async () => {
    const req = createMockRequest('POST', { symbol: 'NONEXISTENT' })
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.price).toBe('')
    expect(json.output.content).toContain('No price data found')
  })

  it('handles negative price change', async () => {
    const req = createMockRequest('POST', { symbol: 'STFLOW' })
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.priceChange24h).toBe('-1.2')
    expect(json.output.content).toContain('-1.20%')
  })

  it('returns 500 when backend fails', async () => {
    mockFlowApiFetch.mockRejectedValue(new Error('FlowIndex API timeout'))

    const req = createMockRequest('POST', { symbol: 'FLOW' })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
    expect(json.error).toContain('FlowIndex API timeout')
  })
})
