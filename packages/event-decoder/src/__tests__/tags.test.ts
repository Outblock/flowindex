import { describe, it, expect } from 'vitest';
import { deriveTags } from '../tags.js';

describe('deriveTags', () => {
  it('tags EVM transaction', () => {
    expect(deriveTags([{ type: 'A.e467b9dd11fa00df.EVM.TransactionExecuted', payload: {} }])).toContain('EVM');
  });

  it('tags EVM bridge', () => {
    expect(deriveTags([{ type: 'A.e467b9dd11fa00df.EVM.FLOWTokensDeposited', payload: {} }])).toContain('EVM_BRIDGE');
  });

  it('tags marketplace', () => {
    expect(deriveTags([{ type: 'A.xxx.NFTStorefront.ListingAvailable', payload: {} }])).toContain('MARKETPLACE');
  });

  it('tags contract deploy', () => {
    expect(deriveTags([{ type: 'flow.AccountContractAdded', payload: {} }])).toContain('CONTRACT_DEPLOY');
  });

  it('tags account creation', () => {
    expect(deriveTags([{ type: 'flow.AccountCreated', payload: {} }])).toContain('ACCOUNT_CREATED');
  });

  it('tags key update', () => {
    expect(deriveTags([{ type: 'flow.AccountKeyAdded', payload: {} }])).toContain('KEY_UPDATE');
  });

  it('tags swap', () => {
    expect(deriveTags([{ type: 'A.xxx.SwapPair.Swap', payload: {} }])).toContain('SWAP');
  });

  it('tags liquidity', () => {
    expect(deriveTags([{ type: 'A.xxx.SwapPair.AddLiquidity', payload: {} }])).toContain('LIQUIDITY');
  });

  it('tags staking', () => {
    expect(deriveTags([{ type: 'A.8624b52f9ddcd04a.FlowIDTableStaking.TokensStaked', payload: {} }])).toContain('STAKING');
  });

  it('tags liquid staking', () => {
    expect(deriveTags([{ type: 'A.xxx.LiquidStaking.Staked', payload: {} }])).toContain('LIQUID_STAKING');
  });

  it('tags token mint (non-FlowToken)', () => {
    expect(deriveTags([{ type: 'A.xxx.USDC.TokensMinted', payload: {} }])).toContain('TOKEN_MINT');
  });

  it('does NOT tag FlowToken.TokensMinted', () => {
    expect(deriveTags([{ type: 'A.xxx.FlowToken.TokensMinted', payload: {} }])).not.toContain('TOKEN_MINT');
  });

  it('tags token burn (non-FlowToken)', () => {
    expect(deriveTags([{ type: 'A.xxx.USDC.TokensBurned', payload: {} }])).toContain('TOKEN_BURN');
  });

  it('does NOT tag FlowToken.TokensBurned', () => {
    expect(deriveTags([{ type: 'A.xxx.FlowToken.TokensBurned', payload: {} }])).not.toContain('TOKEN_BURN');
  });

  it('returns unique tags', () => {
    const tags = deriveTags([
      { type: 'A.xxx.SwapPair.Swap', payload: {} },
      { type: 'A.yyy.SwapPair.Swap', payload: {} },
    ]);
    expect(tags.filter(t => t === 'SWAP')).toHaveLength(1);
  });

  it('returns empty for unknown events', () => {
    expect(deriveTags([{ type: 'A.xxx.SomeRandom.Event', payload: {} }])).toEqual([]);
  });

  it('handles empty array', () => {
    expect(deriveTags([])).toEqual([]);
  });

  it('returns multiple tags for multi-type tx', () => {
    const tags = deriveTags([
      { type: 'A.xxx.SwapPair.Swap', payload: {} },
      { type: 'A.xxx.EVM.TransactionExecuted', payload: {} },
    ]);
    expect(tags).toContain('SWAP');
    expect(tags).toContain('EVM');
  });
});
