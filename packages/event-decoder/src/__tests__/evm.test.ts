import { describe, it, expect } from 'vitest';
import { parseEVMEvents, decodeDirectCallPayload, normalizeHexValue } from '../evm.js';
import type { RawEvent } from '../types.js';

// Helper: build a UInt8 byte array in JSON-CDC format
function cadenceByteArray(bytes: number[]): { type: 'Array'; value: Array<{ type: 'UInt8'; value: string }> } {
  return {
    type: 'Array',
    value: bytes.map((b) => ({ type: 'UInt8' as const, value: String(b) })),
  };
}

// 32-byte hash (ab cd repeated)
const HASH_BYTES = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0xab : 0xcd));
const HASH_HEX = HASH_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');

// 20-byte from address
const FROM_BYTES = Array.from({ length: 20 }, (_, i) => 0x11 + i);
const FROM_HEX = FROM_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');

// 20-byte to address
const TO_BYTES = Array.from({ length: 20 }, (_, i) => 0x51 + i);
const TO_HEX = TO_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');

describe('parseEVMEvents', () => {
  it('parses EVM.TransactionExecuted with hash, from, to, gas in JSON-CDC fields', () => {
    const event: RawEvent = {
      type: 'A.e467b9dd11fa00df.EVM.TransactionExecuted',
      event_index: 3,
      block_height: 100000,
      payload: {
        value: {
          fields: [
            { name: 'hash', value: cadenceByteArray(HASH_BYTES) },
            { name: 'from', value: cadenceByteArray(FROM_BYTES) },
            { name: 'to', value: cadenceByteArray(TO_BYTES) },
            { name: 'gasConsumed', value: { type: 'UInt64', value: '21000' } },
            { name: 'gasLimit', value: { type: 'UInt64', value: '30000' } },
            { name: 'transactionType', value: { type: 'UInt8', value: '2' } },
          ],
        },
      },
    };

    const results = parseEVMEvents([event]);
    expect(results).toHaveLength(1);

    const exec = results[0];
    expect(exec.hash).toBe('0x' + HASH_HEX);
    expect(exec.from).toBe('0x' + FROM_HEX);
    expect(exec.to).toBe('0x' + TO_HEX);
    expect(exec.gas_used).toBe('21000');
    expect(exec.gas_limit).toBe('30000');
    expect(exec.value).toBe('0');
    expect(exec.status).toBe('SEALED');
    expect(exec.event_index).toBe(3);
    expect(exec.block_number).toBe(100000);
    expect(exec.type).toBe(2);
  });

  it('parses pre-flattened payload fields', () => {
    const event: RawEvent = {
      type: 'A.e467b9dd11fa00df.EVM.TransactionExecuted',
      event_index: 0,
      payload: {
        hash: HASH_HEX,
        from: FROM_HEX,
        to: TO_HEX,
        gasConsumed: '21000',
        gasLimit: '30000',
      },
    };

    const results = parseEVMEvents([event]);
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe('0x' + HASH_HEX);
    expect(results[0].from).toBe('0x' + FROM_HEX);
    expect(results[0].to).toBe('0x' + TO_HEX);
  });

  it('skips events without a valid hash', () => {
    const event: RawEvent = {
      type: 'A.e467b9dd11fa00df.EVM.TransactionExecuted',
      payload: {
        from: FROM_HEX,
        to: TO_HEX,
        gasConsumed: '21000',
      },
    };

    const results = parseEVMEvents([event]);
    expect(results).toHaveLength(0);
  });

  it('returns empty array for non-EVM events', () => {
    const events: RawEvent[] = [
      {
        type: 'A.1654653399040a61.FlowToken.TokensWithdrawn',
        payload: { amount: '1.0' },
      },
      {
        type: 'flow.AccountCreated',
        payload: { address: '0xabc' },
      },
    ];
    expect(parseEVMEvents(events)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parseEVMEvents([])).toEqual([]);
  });

  it('handles string payload (JSON)', () => {
    const event: RawEvent = {
      type: 'A.e467b9dd11fa00df.EVM.TransactionExecuted',
      event_index: 1,
      payload: JSON.stringify({
        hash: HASH_HEX,
        from: FROM_HEX,
        to: TO_HEX,
        gasConsumed: '21000',
      }),
    };

    const results = parseEVMEvents([event]);
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe('0x' + HASH_HEX);
  });
});

describe('decodeDirectCallPayload', () => {
  // Build a minimal 0xff-prefixed RLP-encoded direct call payload
  function buildDirectCallRLP(from: number[], to: number[], value: number[]): string {
    // RLP encode a single item as short string
    function rlpEncode(data: number[]): number[] {
      if (data.length === 1 && data[0] <= 0x7f) return data;
      if (data.length <= 55) return [0x80 + data.length, ...data];
      // long string
      const lenBytes: number[] = [];
      let l = data.length;
      while (l > 0) {
        lenBytes.unshift(l & 0xff);
        l >>= 8;
      }
      return [0xb7 + lenBytes.length, ...lenBytes, ...data];
    }

    const nonce = rlpEncode([0]); // nonce = 0
    const subType = rlpEncode([1]); // subType = 1
    const fromEnc = rlpEncode(from);
    const toEnc = rlpEncode(to);
    const dataEnc = rlpEncode([]); // empty call data
    const valueEnc = rlpEncode(value);

    const items = [...nonce, ...subType, ...fromEnc, ...toEnc, ...dataEnc, ...valueEnc];
    // RLP list wrapper
    let list: number[];
    if (items.length <= 55) {
      list = [0xc0 + items.length, ...items];
    } else {
      const lenBytes: number[] = [];
      let l = items.length;
      while (l > 0) {
        lenBytes.unshift(l & 0xff);
        l >>= 8;
      }
      list = [0xf7 + lenBytes.length, ...lenBytes, ...items];
    }

    return '0xff' + list.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('decodes 0xff-prefixed RLP with from/to/value', () => {
    const from = Array.from({ length: 20 }, (_, i) => 0x11 + i);
    const to = Array.from({ length: 20 }, (_, i) => 0x51 + i);
    const value = [0x01, 0x00]; // 256 in big-endian

    const hex = buildDirectCallRLP(from, to, value);
    const result = decodeDirectCallPayload(hex);

    expect(result).not.toBeNull();
    expect(result!.from).toBe('0x' + from.map((b) => b.toString(16).padStart(2, '0')).join(''));
    expect(result!.to).toBe('0x' + to.map((b) => b.toString(16).padStart(2, '0')).join(''));
    expect(result!.value).toBe('256');
  });

  it('returns null for non-0xff prefix', () => {
    expect(decodeDirectCallPayload('0x1234567890')).toBeNull();
  });

  it('returns null for too short payload', () => {
    expect(decodeDirectCallPayload('0xff1234')).toBeNull();
  });

  it('returns null for invalid data', () => {
    expect(decodeDirectCallPayload('')).toBeNull();
    expect(decodeDirectCallPayload('not hex')).toBeNull();
  });

  it('handles zero-address to field (contract creation)', () => {
    const from = Array.from({ length: 20 }, (_, i) => 0x11 + i);
    const to = Array.from({ length: 20 }, () => 0); // zero address
    const hex = buildDirectCallRLP(from, to, []);
    const result = decodeDirectCallPayload(hex);

    expect(result).not.toBeNull();
    expect(result!.to).toBe(''); // zero address filtered out
  });
});

describe('normalizeHexValue', () => {
  it('normalizes string with 0x prefix', () => {
    expect(normalizeHexValue('0xAbCdEf')).toBe('abcdef');
  });

  it('normalizes string without prefix', () => {
    expect(normalizeHexValue('abcdef')).toBe('abcdef');
  });

  it('returns empty for non-hex string', () => {
    expect(normalizeHexValue('not-hex-zzz')).toBe('');
  });

  it('converts number array (byte array) to hex', () => {
    expect(normalizeHexValue([171, 205, 239])).toBe('abcdef');
  });

  it('handles UInt8 value strings in byte array', () => {
    expect(normalizeHexValue(['171', '205', '239'])).toBe('abcdef');
  });

  it('returns empty for null/undefined', () => {
    expect(normalizeHexValue(null)).toBe('');
    expect(normalizeHexValue(undefined)).toBe('');
  });

  it('returns empty for number type', () => {
    expect(normalizeHexValue(42)).toBe('');
  });
});

describe('parseEVMEvents with byte array payload (direct call fallback)', () => {
  it('decodes from/to from payload field when top-level fields missing', () => {
    // Build a minimal direct call payload as byte array
    function rlpEncode(data: number[]): number[] {
      if (data.length === 1 && data[0] <= 0x7f) return data;
      if (data.length <= 55) return [0x80 + data.length, ...data];
      const lenBytes: number[] = [];
      let l = data.length;
      while (l > 0) { lenBytes.unshift(l & 0xff); l >>= 8; }
      return [0xb7 + lenBytes.length, ...lenBytes, ...data];
    }

    const from = Array.from({ length: 20 }, (_, i) => 0x11 + i);
    const to = Array.from({ length: 20 }, (_, i) => 0x51 + i);
    const nonce = rlpEncode([0]);
    const subType = rlpEncode([1]);
    const fromEnc = rlpEncode(from);
    const toEnc = rlpEncode(to);
    const dataEnc = rlpEncode([]);
    const valueEnc = rlpEncode([]);
    const items = [...nonce, ...subType, ...fromEnc, ...toEnc, ...dataEnc, ...valueEnc];
    let payloadBytes: number[];
    if (items.length <= 55) {
      payloadBytes = [0xff, 0xc0 + items.length, ...items];
    } else {
      const lenBytes: number[] = [];
      let l = items.length;
      while (l > 0) { lenBytes.unshift(l & 0xff); l >>= 8; }
      payloadBytes = [0xff, 0xf7 + lenBytes.length, ...lenBytes, ...items];
    }

    const event: RawEvent = {
      type: 'A.e467b9dd11fa00df.EVM.TransactionExecuted',
      event_index: 5,
      payload: {
        hash: HASH_HEX,
        // from/to deliberately missing — should be decoded from payload
        payload: payloadBytes, // byte array
        gasConsumed: '21000',
      },
    };

    const results = parseEVMEvents([event]);
    expect(results).toHaveLength(1);
    expect(results[0].from).toBe('0x' + from.map((b) => b.toString(16).padStart(2, '0')).join(''));
    expect(results[0].to).toBe('0x' + to.map((b) => b.toString(16).padStart(2, '0')).join(''));
  });
});
