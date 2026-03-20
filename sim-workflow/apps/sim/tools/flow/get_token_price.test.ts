/**
 * @vitest-environment node
 */
import { ToolTester } from '@sim/testing/builders'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flowGetTokenPriceTool } from '@/tools/flow/get_token_price'

describe('flowGetTokenPriceTool', () => {
  let tester: ToolTester<any, any>

  beforeEach(() => {
    tester = new ToolTester(flowGetTokenPriceTool as any)
  })

  afterEach(() => {
    tester.cleanup()
  })

  it('has correct tool id', () => {
    expect(flowGetTokenPriceTool.id).toBe('flow_get_token_price')
  })

  it('posts to correct endpoint', () => {
    expect(tester.getRequestUrl({})).toBe('/api/tools/flow/get-token-price')
  })

  it('sends symbol in body', () => {
    const body = tester.getRequestBody({ symbol: 'FLOW' })
    expect(body).toEqual({ symbol: 'FLOW' })
  })

  it('sends empty symbol for all prices', () => {
    const body = tester.getRequestBody({})
    expect(body).toEqual({ symbol: undefined })
  })

  it('transforms successful response', async () => {
    tester.setup({
      success: true,
      output: {
        content: 'FLOW: $0.850000 (+2.50% 24h)',
        symbol: 'FLOW',
        price: '0.85',
        priceChange24h: '2.5',
        prices: [{ asset: 'FLOW', price: 0.85 }],
      },
    })
    const result = await tester.execute({ symbol: 'FLOW' })
    expect(result.success).toBe(true)
    expect(result.output.price).toBe('0.85')
  })

  it('transforms error response', async () => {
    tester.setupError('Failed to get token prices', 500)
    const result = await tester.execute({ symbol: 'FLOW' })
    expect(result.success).toBe(false)
  })
})
