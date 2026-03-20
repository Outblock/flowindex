/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalAuth } = vi.hoisted(() => ({
  mockCheckInternalAuth: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/app/api/tools/flow/utils', () => ({
  flowApiFetch: vi.fn(),
}))

// Mock the internal fetch for Cadence script execution
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from './route'

describe('flow/resolve-name route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true })
  })

  it('returns 401 when auth fails', async () => {
    mockCheckInternalAuth.mockResolvedValue({ success: false, error: 'unauthorized' })
    const req = createMockRequest('POST', { name: 'dapper' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('resolves a .find name via Cadence script', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        output: {
          result: { value: { value: '0x1234567890abcdef' } },
        },
      }),
    })

    const req = createMockRequest('POST', { name: 'dapper.find' }, {}, 'http://localhost:3000/api/tools/flow/resolve-name')
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.name).toBe('dapper')
    expect(json.output.address).toBe('0x1234567890abcdef')
    expect(json.output.content).toContain('dapper.find resolves to')
  })

  it('strips .fn suffix', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        output: {
          result: { value: { value: '0xabcdef1234567890' } },
        },
      }),
    })

    const req = createMockRequest('POST', { name: 'user.fn' }, {}, 'http://localhost:3000/api/tools/flow/resolve-name')
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.name).toBe('user')
  })

  it('passes through hex addresses without calling script', async () => {
    const req = createMockRequest('POST', { name: '0x1654653399040a61' }, {}, 'http://localhost:3000/api/tools/flow/resolve-name')
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.address).toBe('0x1654653399040a61')
    expect(json.output.content).toContain('already a Flow address')
    // Should NOT have called the execute-script endpoint
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty address when name not found', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        output: {
          result: { value: null },
        },
      }),
    })

    const req = createMockRequest('POST', { name: 'nonexistent' }, {}, 'http://localhost:3000/api/tools/flow/resolve-name')
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.address).toBe('')
    expect(json.output.content).toContain('could not be resolved')
  })

  it('returns 500 when name is missing', async () => {
    const req = createMockRequest('POST', {})
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
