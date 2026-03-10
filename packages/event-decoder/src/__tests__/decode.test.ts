import { describe, it, expect } from 'vitest';
import { decodeEvents } from '../decode.js';

describe('decodeEvents', () => {
  it('decodes a FLOW transfer simulation (4 events)', () => {
    const events = [
      {
        type: 'A.1654653399040a61.FlowToken.TokensWithdrawn',
        payload: { value: { fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
          { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0x1654653399040a61' } } },
          { name: 'withdrawnUUID', value: { type: 'UInt64', value: '99' } },
        ] } },
      },
      {
        type: 'A.f233dcee88fe0abe.FungibleToken.Withdrawn',
        payload: { type: 'A.1654653399040a61.FlowToken.Vault', value: { fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
          { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0x1654653399040a61' } } },
          { name: 'withdrawnUUID', value: { type: 'UInt64', value: '99' } },
        ] } },
      },
      {
        type: 'A.1654653399040a61.FlowToken.TokensDeposited',
        payload: { value: { fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
          { name: 'to', value: { type: 'Optional', value: { type: 'Address', value: '0xabcdef1234567890' } } },
          { name: 'depositedUUID', value: { type: 'UInt64', value: '99' } },
        ] } },
      },
      {
        type: 'A.f233dcee88fe0abe.FungibleToken.Deposited',
        payload: { type: 'A.1654653399040a61.FlowToken.Vault', value: { fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
          { name: 'to', value: { type: 'Optional', value: { type: 'Address', value: '0xabcdef1234567890' } } },
          { name: 'depositedUUID', value: { type: 'UInt64', value: '99' } },
        ] } },
      },
    ];

    const result = decodeEvents(events);
    expect(result.transfers.length).toBeGreaterThanOrEqual(1);
    expect(result.transfers[0].amount).toBe('0.00100000');
    expect(result.transfers[0].transfer_type).toBe('transfer');
    expect(result.nftTransfers).toEqual([]);
    expect(result.evmExecutions).toEqual([]);
    expect(result.defiEvents).toEqual([]);
    expect(result.stakingEvents).toEqual([]);
    expect(result.fee).toBe(0);
  });

  it('extracts fee from FeesDeducted event', () => {
    const events = [{
      type: 'A.f919ee77447b7497.FlowFees.FeesDeducted',
      payload: { value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '0.00001000' } },
        { name: 'inclusionEffort', value: { type: 'UFix64', value: '1.0' } },
        { name: 'executionEffort', value: { type: 'UFix64', value: '0.0001' } },
      ] } },
    }];
    expect(decodeEvents(events).fee).toBeCloseTo(0.00001);
  });

  it('extracts contract imports from script', () => {
    const result = decodeEvents([], 'import FlowToken from 0x1654653399040a61\nimport FungibleToken from 0xf233dcee88fe0abe');
    expect(result.contractImports).toEqual([
      'A.1654653399040a61.FlowToken',
      'A.f233dcee88fe0abe.FungibleToken',
    ]);
  });

  it('handles empty inputs', () => {
    const result = decodeEvents([]);
    expect(result.transfers).toEqual([]);
    expect(result.fee).toBe(0);
    expect(result.tags).toEqual([]);
    expect(result.contractImports).toEqual([]);
  });

  it('handles null script', () => {
    const result = decodeEvents([], null);
    expect(result.contractImports).toEqual([]);
  });

  it('decodes system events in combination with transfers', () => {
    const events = [
      { type: 'flow.AccountCreated', payload: { value: { fields: [
        { name: 'address', value: { type: 'Address', value: '0xnewaccount' } },
      ] } } },
      {
        type: 'A.1654653399040a61.FlowToken.TokensWithdrawn',
        payload: { value: { fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.001' } },
          { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0xsender' } } },
        ] } },
      },
    ];
    const result = decodeEvents(events);
    expect(result.systemEvents.length).toBe(1);
    expect(result.systemEvents[0].action).toBe('created');
    expect(result.tags).toContain('ACCOUNT_CREATED');
  });
});
