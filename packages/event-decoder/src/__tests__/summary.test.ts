import { describe, it, expect } from 'vitest';
import { buildSummary, buildSummaryItems } from '../summary.js';
import type { DecodedEvents } from '../types.js';

const empty: DecodedEvents = {
  transfers: [], nftTransfers: [], evmExecutions: [], defiEvents: [],
  stakingEvents: [], systemEvents: [], fee: 0, tags: [], contractImports: [],
};

describe('buildSummary', () => {
  it('returns empty string for empty decoded', () => {
    expect(buildSummary(empty)).toBe('');
  });

  it('summarizes account creation', () => {
    const d = { ...empty, systemEvents: [{ category: 'account' as const, action: 'created', address: '0xabc123', detail: 'Created account 0xabc123', event_index: 0 }] };
    expect(buildSummary(d)).toBe('Created account 0xabc123');
  });

  it('summarizes contract deployment', () => {
    const d = { ...empty, systemEvents: [{ category: 'contract' as const, action: 'contract_deployed', address: '0xabc', detail: 'Deployed MyToken to 0xabc', event_index: 0, contractName: 'MyToken' }] };
    expect(buildSummary(d)).toContain('Deployed MyToken');
  });

  it('summarizes vault setup from capability events', () => {
    const d = { ...empty, systemEvents: [
      { category: 'capability' as const, action: 'storage_capability_issued', address: '0xabc', detail: '', event_index: 0, capabilityType: 'A.xxx.USDC.Vault', path: '/storage/usdcVault' },
      { category: 'capability' as const, action: 'capability_published', address: '0xabc', detail: '', event_index: 1, path: '/public/usdcReceiver' },
    ] };
    expect(buildSummary(d)).toContain('Enabled');
    expect(buildSummary(d)).toContain('USDC');
  });

  it('summarizes collection setup', () => {
    const d = { ...empty, systemEvents: [
      { category: 'capability' as const, action: 'storage_capability_issued', address: '0xabc', detail: '', event_index: 0, capabilityType: 'A.xxx.TopShot.Collection', path: '/storage/TopShotCollection' },
    ] };
    const summary = buildSummary(d);
    expect(summary).toContain('TopShot');
  });

  it('prioritizes swap over transfer', () => {
    const d = {
      ...empty,
      transfers: [{ token: 'A.xxx.FlowToken', amount: '10.5', transfer_type: 'transfer' as const, from_address: '0xa', to_address: '0xb', event_index: 0 }],
      defiEvents: [{ dex: 'incrementfi', action: 'Swap', pairId: '', amountIn: '10.5', amountOut: '25.3', tokenIn: 'FLOW', tokenOut: 'USDC', event_index: 0 }],
    };
    expect(buildSummary(d)).toContain('Swapped');
  });

  it('summarizes FT transfer', () => {
    const d = { ...empty, transfers: [{ token: 'A.1654653399040a61.FlowToken', from_address: '0xabc', to_address: '0xdef', amount: '0.001', event_index: 0, transfer_type: 'transfer' as const }] };
    expect(buildSummary(d)).toContain('Transferred');
    expect(buildSummary(d)).toContain('0.001');
    expect(buildSummary(d)).toContain('FlowToken');
  });

  it('summarizes FT mint', () => {
    const d = { ...empty, transfers: [{ token: 'A.xxx.USDC', from_address: '', to_address: '0xabc', amount: '100', event_index: 0, transfer_type: 'mint' as const }] };
    expect(buildSummary(d)).toContain('Minted');
  });

  it('summarizes staking', () => {
    const d = { ...empty, stakingEvents: [{ action: 'TokensStaked', nodeId: 'abc', amount: '100.0', event_index: 0 }] };
    expect(buildSummary(d)).toContain('Staked');
    expect(buildSummary(d)).toContain('100');
  });

  it('summarizes NFT transfer', () => {
    const d = { ...empty, nftTransfers: [{ token: 'A.xxx.TopShot', from_address: '0xa', to_address: '0xb', token_id: '123', event_index: 0, transfer_type: 'transfer' as const }] };
    expect(buildSummary(d)).toContain('TopShot');
    expect(buildSummary(d)).toContain('#123');
  });

  it('summarizes EVM execution', () => {
    const d = { ...empty, evmExecutions: [{ hash: '0xabc', from: '0x111', to: '0x222', gas_used: '21000', gas_limit: '30000', gas_price: '0', value: '0', status: 'SEALED', event_index: 0 }] };
    expect(buildSummary(d)).toContain('EVM');
  });

  it('falls back to contract imports', () => {
    const d = { ...empty, contractImports: ['A.xxx.SomeContract', 'A.yyy.OtherContract'] };
    expect(buildSummary(d)).toContain('SomeContract');
  });
});

describe('buildSummaryItems', () => {
  it('returns items for each category', () => {
    const d = {
      ...empty,
      transfers: [{ token: 'A.xxx.FlowToken', amount: '10', transfer_type: 'transfer' as const, from_address: '0xa', to_address: '0xb', event_index: 0 }],
      defiEvents: [{ dex: 'incrementfi', action: 'Swap', pairId: '', amountIn: '10', amountOut: '25', tokenIn: 'FLOW', tokenOut: 'USDC', event_index: 0 }],
    };
    const items = buildSummaryItems(d);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some(i => i.icon === 'swap')).toBe(true);
    expect(items.some(i => i.icon === 'transfer')).toBe(true);
  });
});
