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

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from './route'

describe('flow/find-profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true })
  })

  it('returns 401 when auth fails', async () => {
    mockCheckInternalAuth.mockResolvedValue({ success: false, error: 'unauthorized' })
    const req = createMockRequest('POST', { name: 'bjartek' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('looks up a .find profile via Cadence script', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        output: {
          result: {
            value: {
              value: [
                { key: { value: 'address' }, value: { value: '0x886f3aeaf848c535' } },
                { key: { value: 'findName' }, value: { value: 'bjartek' } },
                { key: { value: 'name' }, value: { value: 'Bjarte Karlsen' } },
                { key: { value: 'description' }, value: { value: 'Flow builder' } },
                { key: { value: 'avatar' }, value: { value: 'https://example.com/avatar.png' } },
              ],
            },
          },
        },
      }),
    })

    const req = createMockRequest('POST', { name: 'bjartek.find' }, {}, 'http://localhost:3000/api/tools/flow/find-profile')
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.profile.address).toBe('0x886f3aeaf848c535')
    expect(json.output.profile.name).toBe('Bjarte Karlsen')
    expect(json.output.content).toContain('bjartek.find')
  })

  it('returns empty profile when name not found', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        output: {
          result: null,
        },
      }),
    })

    const req = createMockRequest('POST', { name: 'nonexistent' }, {}, 'http://localhost:3000/api/tools/flow/find-profile')
    const res = await POST(req)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.output.content).toContain('profile not found')
    expect(json.output.profile).toEqual({})
  })

  it('strips .find suffix from input', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        output: { result: null },
      }),
    })

    const req = createMockRequest('POST', { name: 'test.find' }, {}, 'http://localhost:3000/api/tools/flow/find-profile')
    const res = await POST(req)
    const json = await res.json()

    // The Cadence script should receive "test" not "test.find"
    const fetchCall = mockFetch.mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.arguments).toContain('"test"')
  })

  it('returns 500 when name is missing', async () => {
    const req = createMockRequest('POST', {})
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
