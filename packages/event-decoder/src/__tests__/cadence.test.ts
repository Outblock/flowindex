import { describe, it, expect } from 'vitest';
import {
  parseCadenceEventFields,
  normalizeFlowAddress,
  extractAddress,
  formatAddr,
  parseContractAddress,
  parseContractName,
  extractAddressFromFields,
} from '../cadence.js';

describe('parseCadenceEventFields', () => {
  it('flattens JSON-CDC event payload with nested fields', () => {
    const payload = {
      value: {
        id: 'A.1654653399040a61.FlowToken.TokensWithdrawn',
        fields: [
          { name: 'amount', value: { type: 'UFix64', value: '0.00100000' } },
          { name: 'from', value: { type: 'Optional', value: { type: 'Address', value: '0x1654653399040a61' } } },
        ],
      },
    };
    const fields = parseCadenceEventFields(payload);
    expect(fields).toEqual({ amount: '0.00100000', from: '0x1654653399040a61' });
  });

  it('returns already-flat payload as-is', () => {
    expect(parseCadenceEventFields({ amount: '1.0', from: '0xabc' })).toEqual({ amount: '1.0', from: '0xabc' });
  });

  it('returns null for null/undefined input', () => {
    expect(parseCadenceEventFields(null)).toBeNull();
    expect(parseCadenceEventFields(undefined)).toBeNull();
  });

  it('handles Optional null value', () => {
    const payload = {
      value: {
        fields: [
          { name: 'from', value: { type: 'Optional', value: null } },
        ],
      },
    };
    const fields = parseCadenceEventFields(payload);
    expect(fields).toEqual({ from: null });
  });

  it('handles Array values', () => {
    const payload = {
      value: {
        fields: [
          { name: 'ids', value: { type: 'Array', value: [
            { type: 'UInt64', value: '1' },
            { type: 'UInt64', value: '2' },
          ] } },
        ],
      },
    };
    const fields = parseCadenceEventFields(payload);
    expect(fields).toEqual({ ids: ['1', '2'] });
  });

  it('handles Struct/Resource/Event nested types', () => {
    const payload = {
      value: {
        fields: [
          { name: 'key', value: { type: 'Struct', value: {
            fields: [
              { name: 'algo', value: { type: 'UInt8', value: '1' } },
              { name: 'weight', value: { type: 'UFix64', value: '1000.0' } },
            ],
          } } },
        ],
      },
    };
    const fields = parseCadenceEventFields(payload);
    expect(fields).toEqual({ key: { algo: '1', weight: '1000.0' } });
  });
});

describe('normalizeFlowAddress', () => {
  it('strips 0x prefix and lowercases', () => {
    expect(normalizeFlowAddress('0x1654653399040A61')).toBe('1654653399040a61');
  });
  it('handles already normalized', () => {
    expect(normalizeFlowAddress('1654653399040a61')).toBe('1654653399040a61');
  });
  it('returns empty for invalid', () => {
    expect(normalizeFlowAddress('')).toBe('');
    expect(normalizeFlowAddress(null)).toBe('');
    expect(normalizeFlowAddress(undefined)).toBe('');
    expect(normalizeFlowAddress('not-hex')).toBe('');
  });
});

describe('extractAddress', () => {
  it('extracts from string', () => {
    expect(extractAddress('0x1654653399040a61')).toBe('1654653399040a61');
  });
  it('extracts from Address object', () => {
    expect(extractAddress({ type: 'Address', value: '0xabc' })).toBe('abc');
  });
  it('extracts from Optional Address', () => {
    expect(extractAddress({ type: 'Optional', value: { type: 'Address', value: '0xabc' } })).toBe('abc');
  });
  it('extracts from object with address field', () => {
    expect(extractAddress({ address: '0xdef' })).toBe('def');
  });
});

describe('extractAddressFromFields', () => {
  it('tries keys in order', () => {
    expect(extractAddressFromFields({ to: '0xabc', recipient: '0xdef' }, 'from', 'to')).toBe('abc');
  });
  it('returns empty if no keys match', () => {
    expect(extractAddressFromFields({ foo: 'bar' }, 'from', 'to')).toBe('');
  });
});

describe('formatAddr', () => {
  it('prepends 0x', () => {
    expect(formatAddr('abc123')).toBe('0xabc123');
  });
  it('does not double-prefix', () => {
    expect(formatAddr('0xabc123')).toBe('0xabc123');
  });
  it('returns empty for empty', () => {
    expect(formatAddr('')).toBe('');
  });
});

describe('parseContractAddress / parseContractName', () => {
  it('extracts from event type', () => {
    expect(parseContractAddress('A.1654653399040a61.FlowToken.TokensWithdrawn')).toBe('1654653399040a61');
    expect(parseContractName('A.1654653399040a61.FlowToken.TokensWithdrawn')).toBe('FlowToken');
  });
  it('returns empty for non-A. types', () => {
    expect(parseContractAddress('flow.AccountCreated')).toBe('');
    expect(parseContractName('flow.AccountCreated')).toBe('');
  });
});
