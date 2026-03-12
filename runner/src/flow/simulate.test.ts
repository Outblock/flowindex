import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simulateTransaction } from './simulate';

describe('simulateTransaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns simulation result on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        events: [{ type: 'FlowToken.TokensWithdrawn', payload: {} }],
        balanceChanges: [{ address: '0x1234', token: 'FLOW', delta: '-10.0' }],
        computationUsed: 42,
        summaryItems: [{ icon: 'transfer', text: 'Transfer 10 FLOW' }],
        transfers: [{ token: 'A.1654653399040a61.FlowToken', amount: '10.0', transfer_type: 'transfer' }],
        systemEvents: [{ category: 'account', detail: 'something changed' }],
        tags: ['FT_TRANSFER'],
      }),
    });
    global.fetch = fetchMock;

    const result = await simulateTransaction({
      cadence: 'transaction {}',
      arguments: [],
      authorizers: ['0x1234'],
      payer: '0x1234',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/simulate', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(result.success).toBe(true);
    expect(result.balanceChanges).toHaveLength(1);
    expect(result.computationUsed).toBe(42);
    expect(result.summaryItems).toHaveLength(1);
    expect(result.transfers).toHaveLength(1);
    expect(result.systemEvents).toHaveLength(1);
    expect(result.tags).toEqual(['FT_TRANSFER']);
  });

  it('returns error on network failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('emulator down'),
    });

    const result = await simulateTransaction({
      cadence: 'transaction {}',
      arguments: [],
      authorizers: ['0x1234'],
      payer: '0x1234',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('502');
  });
});
