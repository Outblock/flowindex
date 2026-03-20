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
  buildQueryString: (params: Record<string, string | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    if (entries.length === 0) return ''
    return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
  },
}))

import { POST } from './route'

describe('flow/get-events route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true })
  })

  it('returns 401 when auth fails', async () => {
    mockCheckInternalAuth.mockResolvedValue({ success: false, error: 'unauthorized' })
    const req = createMockRequest('POST', { eventType: 'TokensDeposited' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('sends name param to backend (not type)', async () => {
    mockFlowApiFetch.mockResolvedValue({
      data: [
        { type: 'A.0x1.FlowToken.TokensDeposited', contract_address: '0x1', contract_name: 'FlowToken', event_name: 'TokensDeposited', count: 42 },
      ],
    })

    const req = createMockRequest('POST', { eventType: 'TokensDeposited', limit: '10' })
    const res = await POST(req)
    const json = await res.json()

    // Verify the backend was called with name= not type=
    expect(mockFlowApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('name=TokensDeposited')
    )
    expect(mockFlowApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('type=')
    )
    expect(json.success).toBe(true)
    expect(json.output.events).toHaveLength(1)
    expect(json.output.count).toBe('1')
    expect(json.output.content).toContain('TokensDeposited')
  })

  it('defaults limit to 20', async () => {
    mockFlowApiFetch.mockResolvedValue({ data: [] })

    const req = createMockRequest('POST', { eventType: 'TokensDeposited' })
    await POST(req)

    expect(mockFlowApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=20')
    )
  })

  it('returns empty results gracefully', async () => {
    mockFlowApiFetch.mockResolvedValue({ data: [] })

    const req = createMockRequest('POST', { eventType: 'NonExistentEvent' })
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.events).toHaveLength(0)
    expect(json.output.count).toBe('0')
    expect(json.output.content).toContain('No events found')
  })

  it('returns 500 when eventType is missing', async () => {
    const req = createMockRequest('POST', {})
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('returns 500 when backend fails', async () => {
    mockFlowApiFetch.mockRejectedValue(new Error('FlowIndex API 500'))

    const req = createMockRequest('POST', { eventType: 'TokensDeposited' })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
    expect(json.error).toContain('FlowIndex API 500')
  })
})
