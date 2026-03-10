import { describe, it, expect } from 'vitest';
import { parseSystemEvents } from '../system.js';
import type { RawEvent } from '../types.js';

/** Helper to build a JSON-CDC event payload */
function cdcEvent(type: string, fields: Array<{ name: string; value: any }>, eventIndex?: number): RawEvent {
  return {
    type,
    payload: { value: { fields } },
    event_index: eventIndex,
  };
}

function cdcField(name: string, type: string, value: any) {
  return { name, value: { type, value } };
}

describe('parseSystemEvents', () => {
  // ── Account events ──

  it('decodes flow.AccountCreated', () => {
    const events = [cdcEvent('flow.AccountCreated', [
      cdcField('address', 'Address', '0xabc123'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'account',
      action: 'created',
      address: 'abc123',
      detail: 'Created account 0xabc123',
    });
  });

  it('decodes flow.AccountKeyAdded', () => {
    const events = [cdcEvent('flow.AccountKeyAdded', [
      cdcField('address', 'Address', '0xabc123'),
      cdcField('publicKey', 'String', 'deadbeef'),
      cdcField('weight', 'UFix64', '1000.00000000'),
      cdcField('hashAlgorithm', 'UInt8', '3'),
      cdcField('keyIndex', 'UInt32', '2'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'key',
      action: 'key_added',
      address: 'abc123',
      detail: 'Added key #2 (weight 1000.00000000)',
      keyIndex: 2,
    });
  });

  it('decodes flow.AccountKeyRemoved', () => {
    const events = [cdcEvent('flow.AccountKeyRemoved', [
      cdcField('address', 'Address', '0xdef456'),
      cdcField('publicKey', 'Int', '0'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'key',
      action: 'key_removed',
      address: 'def456',
      detail: 'Removed key from 0xdef456',
    });
  });

  // ── Contract events ──

  it('decodes flow.AccountContractAdded', () => {
    const events = [cdcEvent('flow.AccountContractAdded', [
      cdcField('address', 'Address', '0xabc123'),
      cdcField('codeHash', 'String', 'sha256hash'),
      cdcField('contract', 'String', 'MyContract'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'contract',
      action: 'contract_deployed',
      address: 'abc123',
      detail: 'Deployed MyContract to 0xabc123',
      contractName: 'MyContract',
    });
  });

  it('decodes flow.AccountContractUpdated', () => {
    const events = [cdcEvent('flow.AccountContractUpdated', [
      cdcField('address', 'Address', '0xabc123'),
      cdcField('codeHash', 'String', 'sha256hash'),
      cdcField('contract', 'String', 'MyContract'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'contract',
      action: 'contract_updated',
      detail: 'Updated MyContract on 0xabc123',
      contractName: 'MyContract',
    });
  });

  it('decodes flow.AccountContractRemoved', () => {
    const events = [cdcEvent('flow.AccountContractRemoved', [
      cdcField('address', 'Address', '0xabc123'),
      cdcField('codeHash', 'String', 'sha256hash'),
      cdcField('contract', 'String', 'OldContract'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'contract',
      action: 'contract_removed',
      detail: 'Removed OldContract from 0xabc123',
      contractName: 'OldContract',
    });
  });

  // ── Capability events ──

  it('decodes flow.StorageCapabilityControllerIssued with object type and path', () => {
    const events: RawEvent[] = [{
      type: 'flow.StorageCapabilityControllerIssued',
      payload: {
        value: {
          fields: [
            cdcField('id', 'UInt64', '42'),
            cdcField('address', 'Address', '0xabc123'),
            { name: 'type', value: { staticType: { typeID: 'A.xxx.FungibleToken.Vault' } } },
            { name: 'path', value: { domain: 'storage', identifier: 'usdcVault' } },
          ],
        },
      },
    }];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'capability',
      action: 'storage_capability_issued',
      detail: 'Issued storage capability for A.xxx.FungibleToken.Vault at /storage/usdcVault',
      capabilityType: 'A.xxx.FungibleToken.Vault',
      path: '/storage/usdcVault',
    });
  });

  it('decodes flow.StorageCapabilityControllerIssued with string type and path', () => {
    const events: RawEvent[] = [{
      type: 'flow.StorageCapabilityControllerIssued',
      payload: {
        value: {
          fields: [
            cdcField('id', 'UInt64', '42'),
            cdcField('address', 'Address', '0xabc123'),
            { name: 'type', value: 'SomeType' },
            { name: 'path', value: '/storage/myVault' },
          ],
        },
      },
    }];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      detail: 'Issued storage capability for SomeType at /storage/myVault',
      capabilityType: 'SomeType',
      path: '/storage/myVault',
    });
  });

  it('decodes flow.AccountCapabilityControllerIssued', () => {
    const events = [cdcEvent('flow.AccountCapabilityControllerIssued', [
      cdcField('id', 'UInt64', '5'),
      cdcField('address', 'Address', '0xabc123'),
      { name: 'type', value: 'SomeType' },
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'capability',
      action: 'account_capability_issued',
      detail: 'Issued account capability',
    });
  });

  it('decodes flow.CapabilityPublished', () => {
    const events: RawEvent[] = [{
      type: 'flow.CapabilityPublished',
      payload: {
        value: {
          fields: [
            cdcField('address', 'Address', '0xabc123'),
            { name: 'path', value: '/public/receiver' },
            cdcField('capability', 'String', 'cap'),
          ],
        },
      },
    }];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'capability',
      action: 'capability_published',
      detail: 'Published capability at /public/receiver',
      path: '/public/receiver',
    });
  });

  it('decodes flow.CapabilityUnpublished', () => {
    const events: RawEvent[] = [{
      type: 'flow.CapabilityUnpublished',
      payload: {
        value: {
          fields: [
            cdcField('address', 'Address', '0xabc123'),
            { name: 'path', value: { domain: 'public', identifier: 'receiver' } },
          ],
        },
      },
    }];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'capability_unpublished',
      detail: 'Unpublished capability at /public/receiver',
      path: '/public/receiver',
    });
  });

  it('decodes flow.StorageCapabilityControllerDeleted', () => {
    const events = [cdcEvent('flow.StorageCapabilityControllerDeleted', [
      cdcField('id', 'UInt64', '42'),
      cdcField('address', 'Address', '0xabc123'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'storage_capability_deleted',
      detail: 'Removed storage capability',
    });
  });

  it('decodes flow.AccountCapabilityControllerDeleted', () => {
    const events = [cdcEvent('flow.AccountCapabilityControllerDeleted', [
      cdcField('id', 'UInt64', '10'),
      cdcField('address', 'Address', '0xabc123'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'account_capability_deleted',
      detail: 'Removed account capability',
    });
  });

  it('decodes flow.StorageCapabilityControllerTargetChanged', () => {
    const events: RawEvent[] = [{
      type: 'flow.StorageCapabilityControllerTargetChanged',
      payload: {
        value: {
          fields: [
            cdcField('id', 'UInt64', '42'),
            cdcField('address', 'Address', '0xabc123'),
            { name: 'path', value: '/storage/newTarget' },
          ],
        },
      },
    }];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'storage_capability_retarget',
      detail: 'Changed capability target to /storage/newTarget',
      path: '/storage/newTarget',
    });
  });

  // ── Inbox events ──

  it('decodes flow.InboxValuePublished', () => {
    const events = [cdcEvent('flow.InboxValuePublished', [
      cdcField('provider', 'Address', '0xaaa111'),
      cdcField('recipient', 'Address', '0xbbb222'),
      cdcField('name', 'String', 'flowTokenReceiver'),
      { name: 'type', value: 'FungibleToken.Receiver' },
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'inbox',
      action: 'inbox_published',
      address: 'aaa111',
      detail: "Published capability 'flowTokenReceiver' to 0xbbb222",
    });
  });

  it('decodes flow.InboxValueClaimed', () => {
    const events = [cdcEvent('flow.InboxValueClaimed', [
      cdcField('provider', 'Address', '0xaaa111'),
      cdcField('recipient', 'Address', '0xbbb222'),
      cdcField('name', 'String', 'flowTokenReceiver'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'inbox',
      action: 'inbox_claimed',
      address: 'bbb222',
      detail: "Claimed capability 'flowTokenReceiver' from 0xaaa111",
    });
  });

  it('decodes flow.InboxValueUnpublished', () => {
    const events = [cdcEvent('flow.InboxValueUnpublished', [
      cdcField('provider', 'Address', '0xaaa111'),
      cdcField('name', 'String', 'flowTokenReceiver'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'inbox',
      action: 'inbox_unpublished',
      address: 'aaa111',
      detail: "Unpublished 'flowTokenReceiver'",
    });
  });

  // ── Edge cases ──

  it('ignores non-system events', () => {
    const events: RawEvent[] = [
      { type: 'A.1654653399040a61.FlowToken.TokensWithdrawn', payload: { value: { fields: [] } } },
      { type: 'A.1654653399040a61.FlowToken.TokensDeposited', payload: { value: { fields: [] } } },
    ];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseSystemEvents([])).toEqual([]);
  });

  it('uses event_index from raw event when available', () => {
    const events = [cdcEvent('flow.AccountCreated', [
      cdcField('address', 'Address', '0xabc123'),
    ], 7)];
    const result = parseSystemEvents(events);
    expect(result[0].event_index).toBe(7);
  });

  it('falls back to array index when event_index is missing', () => {
    const events: RawEvent[] = [
      { type: 'A.xxx.FlowToken.TokensWithdrawn', payload: { value: { fields: [] } } },
      {
        type: 'flow.AccountCreated',
        payload: { value: { fields: [cdcField('address', 'Address', '0xabc123')] } },
      },
    ];
    const result = parseSystemEvents(events);
    expect(result[0].event_index).toBe(1);
  });

  it('handles mixed system and non-system events', () => {
    const events: RawEvent[] = [
      { type: 'A.xxx.FlowToken.TokensWithdrawn', payload: { value: { fields: [] } } },
      cdcEvent('flow.AccountCreated', [cdcField('address', 'Address', '0xabc123')], 1),
      { type: 'A.xxx.FlowToken.TokensDeposited', payload: { value: { fields: [] } } },
      cdcEvent('flow.AccountContractAdded', [
        cdcField('address', 'Address', '0xdef456'),
        cdcField('codeHash', 'String', 'hash'),
        cdcField('contract', 'String', 'Foo'),
      ], 3),
    ];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0].action).toBe('created');
    expect(result[1].action).toBe('contract_deployed');
  });

  it('skips unknown flow. event types gracefully', () => {
    const events = [cdcEvent('flow.UnknownFutureEvent', [
      cdcField('address', 'Address', '0xabc123'),
    ])];
    const result = parseSystemEvents(events);
    expect(result).toHaveLength(0);
  });

  it('handles formatType with nested value wrapper', () => {
    const events: RawEvent[] = [{
      type: 'flow.StorageCapabilityControllerIssued',
      payload: {
        value: {
          fields: [
            cdcField('id', 'UInt64', '1'),
            cdcField('address', 'Address', '0xabc123'),
            { name: 'type', value: { value: { typeID: 'SomeDeep.Type' } } },
            { name: 'path', value: { value: { domain: 'storage', identifier: 'deep' } } },
          ],
        },
      },
    }];
    const result = parseSystemEvents(events);
    expect(result[0].capabilityType).toBe('SomeDeep.Type');
    expect(result[0].path).toBe('/storage/deep');
  });
});
