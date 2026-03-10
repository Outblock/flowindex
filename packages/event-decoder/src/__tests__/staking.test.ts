import { describe, it, expect } from 'vitest';
import { parseStakingEvents } from '../staking.js';

describe('parseStakingEvents', () => {
  it('parses TokensStaked', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.TokensStaked',
      payload: { value: { fields: [
        { name: 'nodeID', value: { type: 'String', value: 'abc123def456' } },
        { name: 'amount', value: { type: 'UFix64', value: '100.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('TokensStaked');
    expect(result[0].nodeId).toBe('abc123def456');
    expect(result[0].amount).toBe('100.00000000');
    expect(result[0].delegatorId).toBeUndefined();
  });

  it('parses DelegatorRewardsPaid with delegatorID', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.DelegatorRewardsPaid',
      payload: { value: { fields: [
        { name: 'nodeID', value: { type: 'String', value: 'node1' } },
        { name: 'delegatorID', value: { type: 'UInt32', value: '5' } },
        { name: 'amount', value: { type: 'UFix64', value: '2.10000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result[0].action).toBe('DelegatorRewardsPaid');
    expect(result[0].delegatorId).toBe(5);
  });

  it('parses FlowStakingCollection events', () => {
    const events = [{
      type: 'A.8d0e87b65159ae63.FlowStakingCollection.StakeNewTokens',
      payload: { value: { fields: [
        { name: 'nodeID', value: { type: 'String', value: 'node1' } },
        { name: 'amount', value: { type: 'UFix64', value: '50.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('StakeNewTokens');
  });

  it('parses LiquidStaking events', () => {
    const events = [{
      type: 'A.xxx.LiquidStaking.Staked',
      payload: { value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '100.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('Staked');
    expect(result[0].amount).toBe('100.00000000');
  });

  it('parses stFlowToken events', () => {
    const events = [{
      type: 'A.xxx.stFlowToken.TokensMinted',
      payload: { value: { fields: [
        { name: 'amount', value: { type: 'UFix64', value: '200.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('TokensMinted');
  });

  it('parses FlowEpoch events', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowEpoch.EpochSetup',
      payload: { value: { fields: [
        { name: 'counter', value: { type: 'UInt64', value: '150' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('EpochSetup');
  });

  it('parses NewNodeCreated with role', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.NewNodeCreated',
      payload: { value: { fields: [
        { name: 'nodeID', value: { type: 'String', value: 'newnode123' } },
        { name: 'role', value: { type: 'UInt8', value: '2' } },
        { name: 'amount', value: { type: 'UFix64', value: '500000.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('NewNodeCreated');
    expect(result[0].nodeId).toBe('newnode123');
    expect(result[0].amount).toBe('500000.00000000');
  });

  it('ignores non-staking events', () => {
    expect(parseStakingEvents([
      { type: 'A.xxx.FlowToken.TokensWithdrawn', payload: {} },
    ])).toEqual([]);
  });

  it('handles empty events', () => {
    expect(parseStakingEvents([])).toEqual([]);
  });

  it('preserves event_index from raw event', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.TokensStaked',
      event_index: 7,
      payload: { value: { fields: [
        { name: 'nodeID', value: { type: 'String', value: 'node1' } },
        { name: 'amount', value: { type: 'UFix64', value: '10.00000000' } },
      ] } },
    }];
    const result = parseStakingEvents(events);
    expect(result[0].event_index).toBe(7);
  });

  it('skips events with unparseable payload', () => {
    const events = [{
      type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.TokensStaked',
      payload: null,
    }];
    const result = parseStakingEvents(events);
    expect(result).toEqual([]);
  });
});
