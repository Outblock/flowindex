import { describe, expect, it } from 'vitest'

import { formatFlowWebhookInput } from '@/lib/flow/normalize-webhook-payload'

describe('formatFlowWebhookInput', () => {
  it('extracts account-created fields for flow_new_account payloads', () => {
    const input = formatFlowWebhookInput(
      {
        event_type: 'account.created',
        block_height: 145558608,
        timestamp: '2026-03-18T06:20:23Z',
        data: {
          block_height: 145558608,
          event_name: 'AccountCreated',
          payload: {
            address: '998eb404705ce617',
          },
          timestamp: '2026-03-18T06:20:23.558Z',
          transaction_id: 'c32a14889b9904b0890d9bc9a1f6309e7caa34b76c683014ea7df8b45f567dd7',
          type: 'flow.AccountCreated',
        },
      },
      'flow_new_account'
    )

    expect(input).toMatchObject({
      eventType: 'account.created',
      eventName: 'AccountCreated',
      address: '0x998eb404705ce617',
      blockHeight: 145558608,
      timestamp: '2026-03-18T06:20:23.558Z',
      transactionId: 'c32a14889b9904b0890d9bc9a1f6309e7caa34b76c683014ea7df8b45f567dd7',
      data: {
        event_name: 'AccountCreated',
        payload: {
          address: '998eb404705ce617',
        },
      },
    })
  })

  it('preserves the generic flow shape for transfer-like triggers', () => {
    const input = formatFlowWebhookInput({
      event_type: 'ft.transfer',
      data: {
        block_height: 42,
        timestamp: '2026-03-18T06:20:23.558Z',
        transaction_id: 'tx-123',
        from_address: '1654653399040a61',
        to_address: '18eb4ee6b3c026d2',
        amount: '10.5',
        token_symbol: 'FLOW',
      },
    })

    expect(input).toMatchObject({
      eventType: 'ft.transfer',
      blockHeight: 42,
      transactionId: 'tx-123',
      from: '0x1654653399040a61',
      to: '0x18eb4ee6b3c026d2',
      amount: '10.5',
      token: 'FLOW',
    })
  })
})
