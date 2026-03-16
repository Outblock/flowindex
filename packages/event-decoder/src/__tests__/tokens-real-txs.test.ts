/**
 * Real transaction fixture tests — captured from mainnet events.
 * Each test validates that parseTokenEvents correctly classifies
 * transfers for known problematic transaction patterns.
 */
import { describe, expect, it } from 'vitest';
import { parseTokenEvents } from '../tokens.js';
import type { RawEvent } from '../types.js';

describe('parseTokenEvents — real transaction fixtures', () => {

  it('staking tx: FlowToken withdraw should be "stake", not "burn" (df4c0671...)', () => {
    // Tx: df4c0671f7c00829b2f16f685e150548881aabac4a77227f6764147743ebcb7a
    // User stakes 16,989 FLOW via FlowIDTableStaking delegation
    const events: RawEvent[] = [
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":"43b5b87eac607406","amount":"16989.00000000"},"event_index":0},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"43b5b87eac607406","type":"A.1654653399040a61.FlowToken.Vault","amount":"16989.00000000","fromUUID":"168225280785852","balanceAfter":"1.00100000","withdrawnUUID":"245191095274890"},"event_index":1},
      {"type":"A.8624b52f9ddcd04a.FlowIDTableStaking.DelegatorTokensCommitted","payload":{"amount":"16989.00000000","nodeID":"f441ce06e155367c05c941b68fdb1bb3f0cb9efe0d8cc9a9932d7d1dbfd13f2c","delegatorID":"20"},"event_index":2},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"8624b52f9ddcd04a","type":"A.1654653399040a61.FlowToken.Vault","amount":"16989.00000000","toUUID":"19791211196648","balanceAfter":"17854.16692556","depositedUUID":"245191095274890"},"event_index":3},
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":"55e1dd4d35647e67","amount":"0.00002299"},"event_index":4},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"55e1dd4d35647e67","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00002299","fromUUID":"168225280785855","balanceAfter":"1.00089980","withdrawnUUID":"245191095274891"},"event_index":5},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"f919ee77447b7497","amount":"0.00002299"},"event_index":6},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"f919ee77447b7497","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00002299","toUUID":"0","balanceAfter":"77.55752980","depositedUUID":"245191095274891"},"event_index":7},
      {"type":"A.f919ee77447b7497.FlowFees.FeesDeducted","payload":{"amount":"0.00002299","executionEffort":"0.00000088","inclusionEffort":"1.00000000"},"event_index":8},
    ];

    const result = parseTokenEvents(events);
    // Should have 1 transfer: the 16,989 FLOW stake (paired withdraw+deposit)
    // Fee transfer to f919ee77447b7497 should be filtered out
    expect(result.transfers.length).toBeGreaterThanOrEqual(1);

    const stakeTx = result.transfers.find(t => t.amount === '16989.00000000');
    expect(stakeTx).toBeDefined();
    // FlowToken in staking context — classified as stake (not burn)
    expect(stakeTx!.transfer_type).toBe('stake');
    expect(stakeTx!.from_address).toContain('43b5b87eac607406');

    // No transfers should be classified as 'burn'
    expect(result.transfers.filter(t => t.transfer_type === 'burn')).toHaveLength(0);
    // No transfers should be classified as 'mint'
    expect(result.transfers.filter(t => t.transfer_type === 'mint')).toHaveLength(0);
  });

  it('LostAndFound tx: USDF forwarding should NOT be "burn" (43ffb4fe...)', () => {
    // Tx: 43ffb4fe223891e21a059a031444d170990f9b5027fd8af294478fe8c6c888d9
    // USDF sent to address without storage → forwarded to LostAndFound
    const events: RawEvent[] = [
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"e7aded0979f825d0","type":"A.1e4aa0b87d10b141.EVMVMBridgedToken_2aabea2058b5ac2d339b163c6ab6f2b6d53aabed.Vault","amount":"0.00100000","fromUUID":"235295489736366","balanceAfter":"0.13470123","withdrawnUUID":"138538467662753"},"event_index":0},
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":"e7aded0979f825d0","amount":"0.00002226"},"event_index":1},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"e7aded0979f825d0","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00002226","fromUUID":"1300263678","balanceAfter":"37.25475675","withdrawnUUID":"138538467662757"},"event_index":2},
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":null,"amount":"0.00000201"},"event_index":3},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":null,"type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00000201","fromUUID":"138538467662757","balanceAfter":"0.00002025","withdrawnUUID":"138538467662759"},"event_index":4},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"473d6a2c37eab5be","amount":"0.00000201"},"event_index":5},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"473d6a2c37eab5be","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00000201","toUUID":"437579696","balanceAfter":"5.32204679","depositedUUID":"138538467662759"},"event_index":6},
      {"type":"A.473d6a2c37eab5be.LostAndFound.TicketDeposited","payload":{"memo":"Send Tokens Backup","name":"USD Flow","type":"Type<A.1e4aa0b87d10b141.EVMVMBridgedToken_2aabea2058b5ac2d339b163c6ab6f2b6d53aabed.Vault>()","redeemer":"1b9370c7be57dade","ticketID":"138538467662760","thumbnail":"https://assets.website-files.com/5f6294c0c7a8cdd643b1c820/5f6294c0c7a8cda55cb1c936_Flow_Wordmark.svg","description":"..."},"event_index":7},
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":null,"amount":"0.00001233"},"event_index":8},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":null,"type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00001233","fromUUID":"138538467662757","balanceAfter":"0.00000792","withdrawnUUID":"138538467662761"},"event_index":9},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"473d6a2c37eab5be","amount":"0.00001233"},"event_index":10},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"473d6a2c37eab5be","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00001233","toUUID":"437579696","balanceAfter":"5.32205912","depositedUUID":"138538467662761"},"event_index":11},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"e7aded0979f825d0","amount":"0.00000792"},"event_index":12},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"e7aded0979f825d0","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00000792","toUUID":"1300263678","balanceAfter":"37.25476467","depositedUUID":"138538467662757"},"event_index":13},
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":"319e67f2ef9d937f","amount":"0.00578000"},"event_index":14},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"319e67f2ef9d937f","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00578000","fromUUID":"228119691","balanceAfter":"933.38774000","withdrawnUUID":"138538467662762"},"event_index":15},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"f919ee77447b7497","amount":"0.00578000"},"event_index":16},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"f919ee77447b7497","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00578000","toUUID":"0","balanceAfter":"3667.56516221","depositedUUID":"138538467662762"},"event_index":17},
      {"type":"A.f919ee77447b7497.FlowFees.FeesDeducted","payload":{"amount":"0.00578000","executionEffort":"0.00000142","inclusionEffort":"1.00000000"},"event_index":18},
    ];

    const result = parseTokenEvents(events);

    // No transfers should be 'burn' or 'mint' — no TokensBurned/TokensMinted evidence
    expect(result.transfers.filter(t => t.transfer_type === 'burn')).toHaveLength(0);
    expect(result.transfers.filter(t => t.transfer_type === 'mint')).toHaveLength(0);

    // Fee transfer (0.00578 to fee vault) should be filtered
    expect(result.transfers.filter(t => t.to_address?.includes('f919ee77447b7497'))).toHaveLength(0);

    // Small FlowToken noise (<0.01) in fee tx should be filtered
    const smallFlow = result.transfers.filter(t =>
      t.token.includes('FlowToken') && parseFloat(t.amount) < 0.01
    );
    expect(smallFlow).toHaveLength(0);
  });

  it('simple FLOW transfer with fee should only show 1 transfer', () => {
    // Simplified fixture: send FLOW from A to B + fee
    const events: RawEvent[] = [
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":"aaaaaaaaaaaaaaaa","amount":"10.00000000"},"event_index":0},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"aaaaaaaaaaaaaaaa","type":"A.1654653399040a61.FlowToken.Vault","amount":"10.00000000","withdrawnUUID":"100"},"event_index":1},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"bbbbbbbbbbbbbbbb","amount":"10.00000000"},"event_index":2},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"bbbbbbbbbbbbbbbb","type":"A.1654653399040a61.FlowToken.Vault","amount":"10.00000000","depositedUUID":"100"},"event_index":3},
      // Fee
      {"type":"A.1654653399040a61.FlowToken.TokensWithdrawn","payload":{"from":"aaaaaaaaaaaaaaaa","amount":"0.00001000"},"event_index":4},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Withdrawn","payload":{"from":"aaaaaaaaaaaaaaaa","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00001000","withdrawnUUID":"101"},"event_index":5},
      {"type":"A.1654653399040a61.FlowToken.TokensDeposited","payload":{"to":"f919ee77447b7497","amount":"0.00001000"},"event_index":6},
      {"type":"A.f233dcee88fe0abe.FungibleToken.Deposited","payload":{"to":"f919ee77447b7497","type":"A.1654653399040a61.FlowToken.Vault","amount":"0.00001000","depositedUUID":"101"},"event_index":7},
      {"type":"A.f919ee77447b7497.FlowFees.FeesDeducted","payload":{"amount":"0.00001000"},"event_index":8},
    ];

    const result = parseTokenEvents(events);
    // Only 1 transfer: 10 FLOW from A to B. Fee filtered out.
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].amount).toBe('10.00000000');
    expect(result.transfers[0].transfer_type).toBe('transfer');
    expect(result.transfers[0].from_address).toContain('aaaaaaaaaaaaaaaa');
    expect(result.transfers[0].to_address).toContain('bbbbbbbbbbbbbbbb');
  });
});
