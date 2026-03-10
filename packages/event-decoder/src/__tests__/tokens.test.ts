import { describe, expect, it } from 'vitest';
import { parseTokenEvents } from '../tokens.js';
import type { RawEvent } from '../types.js';

// ── Helpers to build realistic JSON-CDC payloads ──

function makeFTEvent(
  type: string,
  fields: { name: string; value: any }[],
  eventIndex: number = 0,
): RawEvent {
  return {
    type,
    payload: { value: { fields } },
    event_index: eventIndex,
  };
}

function cdcUFix64(name: string, val: string) {
  return { name, value: { type: 'UFix64', value: val } };
}

function cdcOptionalAddr(name: string, val: string | null) {
  return {
    name,
    value: val
      ? { type: 'Optional', value: { type: 'Address', value: val } }
      : { type: 'Optional', value: null },
  };
}

function cdcUInt64(name: string, val: string) {
  return { name, value: { type: 'UInt64', value: val } };
}

// Valid hex addresses for test data
const ADDR_ALICE = '0xe03daebed8ca0615';
const ADDR_BOB = '0xf3fcd2c1a78f5eee';
const ADDR_SENDER = '0xa1b2c3d4e5f6a7b8';
const ADDR_RECEIVER = '0xb1c2d3e4f5a6b7c8';
const ADDR_STAKER = '0xc1d2e3f4a5b6c7d8';
const ADDR_NFT_SENDER = '0xd1e2f3a4b5c6d7e8';
const ADDR_NFT_RECEIVER = '0xe1f2a3b4c5d6e7f8';

// ── Tests ──

describe('parseTokenEvents', () => {
  it('should parse a simple FLOW transfer (withdraw + deposit pair)', () => {
    const events: RawEvent[] = [
      makeFTEvent(
        'A.1654653399040a61.FlowToken.TokensWithdrawn',
        [
          cdcUFix64('amount', '10.00000000'),
          cdcOptionalAddr('from', ADDR_ALICE),
          cdcUInt64('withdrawnUUID', '42'),
        ],
        0,
      ),
      makeFTEvent(
        'A.1654653399040a61.FlowToken.TokensDeposited',
        [
          cdcUFix64('amount', '10.00000000'),
          cdcOptionalAddr('to', ADDR_BOB),
          cdcUInt64('depositedUUID', '42'),
        ],
        1,
      ),
    ];

    const result = parseTokenEvents(events);
    expect(result.transfers).toHaveLength(1);
    expect(result.nftTransfers).toHaveLength(0);

    const ft = result.transfers[0];
    expect(ft.token).toBe('A.1654653399040a61.FlowToken');
    expect(ft.from_address).toBe(ADDR_ALICE);
    expect(ft.to_address).toBe(ADDR_BOB);
    expect(ft.amount).toBe('10.00000000');
    expect(ft.transfer_type).toBe('transfer');
  });

  it('should handle FT with wrapper events (FungibleToken.Withdrawn/Deposited)', () => {
    const events: RawEvent[] = [
      // Wrapper withdrawal from FungibleToken
      {
        type: 'A.f233dcee88fe0abe.FungibleToken.Withdrawn',
        payload: {
          type: 'A.82ed1b9cba5bb1b3.JOSHIN.Vault',
          value: {
            fields: [
              cdcUFix64('amount', '50.00000000'),
              cdcOptionalAddr('from', ADDR_SENDER),
              cdcUInt64('withdrawnUUID', '100'),
            ],
          },
        },
        event_index: 0,
      },
      // Concrete token withdrawal (no address in payload)
      makeFTEvent(
        'A.82ed1b9cba5bb1b3.JOSHIN.TokensWithdrawn',
        [
          cdcUFix64('amount', '50.00000000'),
          cdcOptionalAddr('from', null),
          cdcUInt64('withdrawnUUID', '100'),
        ],
        1,
      ),
      // Concrete token deposit (no address in payload)
      makeFTEvent(
        'A.82ed1b9cba5bb1b3.JOSHIN.TokensDeposited',
        [
          cdcUFix64('amount', '50.00000000'),
          cdcOptionalAddr('to', null),
          cdcUInt64('depositedUUID', '100'),
        ],
        2,
      ),
      // Wrapper deposit into FungibleToken
      {
        type: 'A.f233dcee88fe0abe.FungibleToken.Deposited',
        payload: {
          type: 'A.82ed1b9cba5bb1b3.JOSHIN.Vault',
          value: {
            fields: [
              cdcUFix64('amount', '50.00000000'),
              cdcOptionalAddr('to', ADDR_RECEIVER),
              cdcUInt64('depositedUUID', '100'),
            ],
          },
        },
        event_index: 3,
      },
    ];

    const result = parseTokenEvents(events);
    // The concrete legs (events 1 and 2) pair up; wrapper events enrich addresses
    expect(result.transfers).toHaveLength(1);
    const ft = result.transfers[0];
    expect(ft.token).toBe('A.82ed1b9cba5bb1b3.JOSHIN');
    // Wrapper enrichment fills in the addresses from wrapper events
    expect(ft.from_address).toBe('0x' + ADDR_SENDER.replace(/^0x/, ''));
    expect(ft.to_address).toBe('0x' + ADDR_RECEIVER.replace(/^0x/, ''));
    expect(ft.amount).toBe('50.00000000');
    expect(ft.transfer_type).toBe('transfer');
  });

  it('should classify deposit-only as mint', () => {
    const events: RawEvent[] = [
      makeFTEvent(
        'A.82ed1b9cba5bb1b3.JOSHIN.TokensDeposited',
        [
          cdcUFix64('amount', '100.00000000'),
          cdcOptionalAddr('to', ADDR_RECEIVER),
          cdcUInt64('depositedUUID', '200'),
        ],
        0,
      ),
    ];

    const result = parseTokenEvents(events);
    expect(result.transfers).toHaveLength(1);
    const ft = result.transfers[0];
    expect(ft.transfer_type).toBe('mint');
    expect(ft.from_address).toBe('');
    expect(ft.to_address).toBe(ADDR_RECEIVER);
    expect(ft.amount).toBe('100.00000000');
  });

  it('should classify withdrawal-only as burn', () => {
    const events: RawEvent[] = [
      makeFTEvent(
        'A.82ed1b9cba5bb1b3.JOSHIN.TokensWithdrawn',
        [
          cdcUFix64('amount', '25.00000000'),
          cdcOptionalAddr('from', ADDR_SENDER),
          cdcUInt64('withdrawnUUID', '300'),
        ],
        0,
      ),
    ];

    const result = parseTokenEvents(events);
    expect(result.transfers).toHaveLength(1);
    const ft = result.transfers[0];
    expect(ft.transfer_type).toBe('burn');
    expect(ft.from_address).toBe(ADDR_SENDER);
    expect(ft.to_address).toBe('');
    expect(ft.amount).toBe('25.00000000');
  });

  it('should parse NFT transfer (Withdrawn + Deposited pair)', () => {
    // NonFungibleToken wrapper events are wrapper contracts — they won't produce legs directly.
    // Use concrete NFT contract events instead.
    const events: RawEvent[] = [
      makeFTEvent(
        'A.1d7e57aa55817448.TopShot.Withdraw',
        [
          cdcUInt64('id', '12345'),
          cdcOptionalAddr('from', ADDR_NFT_SENDER),
          cdcUInt64('uuid', '500'),
        ],
        0,
      ),
      makeFTEvent(
        'A.1d7e57aa55817448.TopShot.Deposit',
        [
          cdcUInt64('id', '12345'),
          cdcOptionalAddr('to', ADDR_NFT_RECEIVER),
          cdcUInt64('uuid', '500'),
        ],
        1,
      ),
    ];

    const result = parseTokenEvents(events);
    expect(result.transfers).toHaveLength(0);
    expect(result.nftTransfers).toHaveLength(1);

    const nft = result.nftTransfers[0];
    expect(nft.from_address).toBe(ADDR_NFT_SENDER);
    expect(nft.to_address).toBe(ADDR_NFT_RECEIVER);
    expect(nft.transfer_type).toBe('transfer');
    expect(nft.token_id).toBe('12345');
  });

  it('should NOT classify unpaired FlowToken as mint/burn in staking context', () => {
    const events: RawEvent[] = [
      // Staking event that sets context
      makeFTEvent(
        'A.8624b52f9ddcd04a.FlowIDTableStaking.DelegatorRewardsPaid',
        [cdcUFix64('amount', '5.00000000')],
        0,
      ),
      // Unpaired FlowToken deposit (normally would be 'mint')
      makeFTEvent(
        'A.1654653399040a61.FlowToken.TokensDeposited',
        [
          cdcUFix64('amount', '5.00000000'),
          cdcOptionalAddr('to', ADDR_STAKER),
          cdcUInt64('depositedUUID', '999'),
        ],
        1,
      ),
    ];

    const result = parseTokenEvents(events);
    expect(result.transfers).toHaveLength(1);
    const ft = result.transfers[0];
    // In staking context, unpaired FlowToken should be 'transfer' not 'mint'
    expect(ft.transfer_type).toBe('transfer');
    expect(ft.to_address).toBe(ADDR_STAKER);
  });

  it('should filter out transfers to/from fee vault address', () => {
    const events: RawEvent[] = [
      makeFTEvent(
        'A.1654653399040a61.FlowToken.TokensWithdrawn',
        [
          cdcUFix64('amount', '0.001'),
          cdcOptionalAddr('from', ADDR_ALICE),
          cdcUInt64('withdrawnUUID', '50'),
        ],
        0,
      ),
      makeFTEvent(
        'A.1654653399040a61.FlowToken.TokensDeposited',
        [
          cdcUFix64('amount', '0.001'),
          cdcOptionalAddr('to', '0xf919ee77447b7497'),
          cdcUInt64('depositedUUID', '50'),
        ],
        1,
      ),
    ];

    const result = parseTokenEvents(events);
    // Transfer to fee vault should be filtered out
    expect(result.transfers).toHaveLength(0);
  });

  it('should return empty results for empty events', () => {
    const result = parseTokenEvents([]);
    expect(result.transfers).toHaveLength(0);
    expect(result.nftTransfers).toHaveLength(0);
  });
});
