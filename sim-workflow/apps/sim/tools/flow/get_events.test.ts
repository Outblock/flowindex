/**
 * @vitest-environment node
 */
import { ToolTester } from '@sim/testing/builders'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flowGetEventsTool } from '@/tools/flow/get_events'

describe('flowGetEventsTool', () => {
  let tester: ToolTester<any, any>

  beforeEach(() => {
    tester = new ToolTester(flowGetEventsTool as any)
  })

  afterEach(() => {
    tester.cleanup()
  })

  it('has correct tool id', () => {
    expect(flowGetEventsTool.id).toBe('flow_get_events')
  })

  it('posts to correct endpoint', () => {
    expect(tester.getRequestUrl({})).toBe('/api/tools/flow/get-events')
  })

  it('sends eventType and limit in body', () => {
    const body = tester.getRequestBody({
      eventType: 'TokensDeposited',
      limit: '10',
    })
    expect(body).toEqual({
      eventType: 'TokensDeposited',
      limit: '10',
    })
  })

  it('does not send startHeight or endHeight (removed params)', () => {
    const body = tester.getRequestBody({
      eventType: 'TokensDeposited',
    })
    expect(body).not.toHaveProperty('startHeight')
    expect(body).not.toHaveProperty('endHeight')
  })

  it('transforms successful response', async () => {
    tester.setup({
      success: true,
      output: {
        content: 'Found 2 event types',
        events: [{ type: 'A.0x1.FlowToken.TokensDeposited', count: 100 }],
        count: '1',
      },
    })
    const result = await tester.execute({ eventType: 'Tokens' })
    expect(result.success).toBe(true)
    expect(result.output.events).toHaveLength(1)
  })

  it('transforms error response', async () => {
    tester.setupError('Failed to search events', 500)
    const result = await tester.execute({ eventType: 'Tokens' })
    expect(result.success).toBe(false)
  })
})
