// ── EVM event decoding (ported from frontend/app/lib/deriveFromEvents.ts) ──

import { parseCadenceEventFields, formatAddr } from './cadence.js';
import type { RawEvent, EVMExecution, DecodedEVMCall } from './types.js';

/**
 * Decode a Flow EVM "direct call" raw_tx_payload (0xff-prefixed RLP).
 * Format: 0xff || RLP([nonce, subType, from(20B), to(20B), data, value, gasLimit, ...])
 */
export function decodeDirectCallPayload(
  hexPayload: string,
): { from: string; to: string; value: string; data: string } | null {
  try {
    let hex = hexPayload.replace(/^0x/, '').toLowerCase();
    if (!hex.startsWith('ff') || hex.length < 10) return null;
    hex = hex.slice(2);
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    let pos = 0;

    // Skip RLP list header
    if (bytes[pos] >= 0xf8) {
      pos += 1 + (bytes[pos] - 0xf7);
    } else if (bytes[pos] >= 0xc0) {
      pos += 1;
    } else {
      return null;
    }

    function readItem(): Uint8Array {
      if (pos >= bytes.length) return new Uint8Array(0);
      const b = bytes[pos];
      if (b <= 0x7f) {
        pos++;
        return new Uint8Array([b]);
      }
      if (b <= 0xb7) {
        const len = b - 0x80;
        pos++;
        const out = bytes.slice(pos, pos + len);
        pos += len;
        return out;
      }
      if (b <= 0xbf) {
        const ll = b - 0xb7;
        pos++;
        let len = 0;
        for (let i = 0; i < ll; i++) len = (len << 8) | bytes[pos + i];
        pos += ll;
        const out = bytes.slice(pos, pos + len);
        pos += len;
        return out;
      }
      return new Uint8Array(0);
    }

    const toHex = (b: Uint8Array) =>
      Array.from(b)
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');

    readItem(); // nonce
    readItem(); // subType
    const fromBytes = readItem(); // from (20 bytes)
    const toBytes = readItem(); // to (20 bytes)
    const dataBytes = readItem(); // data (EVM call data)
    const valueBytes = readItem(); // value

    const from = fromBytes.length === 20 ? '0x' + toHex(fromBytes) : '';
    const toH = toHex(toBytes);
    const to = toBytes.length === 20 && !/^0{40}$/.test(toH) ? '0x' + toH : '';
    const data = toHex(dataBytes);

    let value = '0';
    if (valueBytes.length > 0) {
      let n = BigInt(0);
      for (const byte of valueBytes) n = (n << BigInt(8)) | BigInt(byte);
      value = n.toString();
    }

    return { from, to, value, data };
  } catch {
    return null;
  }
}

/** Try to extract raw tx payload hex from parsed Cadence event fields */
function extractPayloadHex(fields: Record<string, any>): string {
  for (const key of ['payload', 'transaction', 'tx', 'txPayload', 'transactionPayload']) {
    if (key in fields && fields[key] != null) {
      const v = fields[key];
      if (typeof v === 'string') return v;
      // byte array as number array -> hex
      if (Array.isArray(v) && v.length > 0) {
        return (
          '0x' +
          v.map((b: any) => (Number(b) & 0xff).toString(16).padStart(2, '0')).join('')
        );
      }
    }
  }
  return '';
}

/** Extract EVM tx hash from various field names */
function extractEVMHash(payload: Record<string, any>): string {
  for (const key of ['hash', 'transactionHash', 'txHash', 'evmHash']) {
    if (key in payload) {
      const h = normalizeHexValue(payload[key]);
      if (h) return h;
    }
  }
  return '';
}

/** Normalize a string or byte array to lowercase hex (no 0x prefix) */
export function normalizeHexValue(value: any): string {
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase().replace(/^0x/, '');
    return /^[0-9a-f]+$/.test(s) ? s : '';
  }
  if (Array.isArray(value)) {
    const hex = value
      .map((b: any) => {
        const n = Number(b);
        return isNaN(n) ? '' : n.toString(16).padStart(2, '0');
      })
      .join('');
    return hex || '';
  }
  return '';
}

/** Try multiple field names for a hex value */
function extractHexField(payload: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in payload) {
      const h = normalizeHexValue(payload[key]);
      if (h) return h;
    }
  }
  return '';
}

/** Try multiple field names for a string value */
function extractStringField(payload: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in payload && payload[key] != null) {
      return String(payload[key]);
    }
  }
  return '';
}

/** Try multiple field names for a numeric value (returned as string) */
function extractNumField(payload: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in payload && payload[key] != null) {
      return String(payload[key]);
    }
  }
  return '0';
}

/** Parse a single raw EVM.TransactionExecuted event into an EVMExecution */
function parseEVMExecution(event: RawEvent): EVMExecution | null {
  const payload =
    typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const fields = parseCadenceEventFields(payload) || payload;
  if (!fields) return null;

  const hash = extractEVMHash(fields);
  if (!hash) return null;

  let from = formatAddr(extractHexField(fields, 'from', 'fromAddress', 'sender'));
  let to = formatAddr(extractHexField(fields, 'to', 'toAddress', 'recipient'));
  let value = extractStringField(fields, 'value') || '0';

  // Extract raw call data for ERC-20/721/1155 decoding
  let callData = extractHexField(fields, 'data', 'callData', 'input');

  // For Flow direct calls (0xff prefix), from/to/data aren't in top-level event fields --
  // they're only in the raw transaction payload bytes. Decode from there.
  if (!from || !to || !callData) {
    const payloadHex = extractPayloadHex(fields);
    if (payloadHex) {
      const decoded = decodeDirectCallPayload(payloadHex);
      if (decoded) {
        if (!from && decoded.from) from = decoded.from;
        if (!to && decoded.to) to = decoded.to;
        if (value === '0' && decoded.value !== '0') value = decoded.value;
        if (!callData && decoded.data) callData = decoded.data;
      }
    }
  }

  return {
    hash: '0x' + hash,
    from,
    to,
    gas_used: extractNumField(fields, 'gasConsumed', 'gasUsed', 'gas_used'),
    gas_limit: extractNumField(fields, 'gasLimit', 'gas', 'gas_limit'),
    gas_price: extractStringField(fields, 'gasPrice', 'gas_price') || '0',
    value,
    status: 'SEALED',
    event_index: event.event_index ?? 0,
    block_number: event.block_height,
    type: Number(extractStringField(fields, 'transactionType', 'txType') || '0'),
    position: Number(extractStringField(fields, 'index', 'position') || '0'),
    data: callData || undefined,
  };
}

// ── EVM call data decoding (ERC-20/721/1155 selectors) ──

const SEL_ERC20_TRANSFER = 'a9059cbb';       // transfer(address,uint256)
const SEL_ERC20_TRANSFER_FROM = '23b872dd';   // transferFrom(address,address,uint256)
const SEL_ERC721_SAFE_TRANSFER_3 = '42842e0e'; // safeTransferFrom(address,address,uint256)
const SEL_ERC721_SAFE_TRANSFER_4 = 'b88d4fde'; // safeTransferFrom(address,address,uint256,bytes)
const SEL_ERC1155_SAFE_TRANSFER = 'f242432a';  // safeTransferFrom(address,address,uint256,uint256,bytes)
const SEL_ERC1155_BATCH_TRANSFER = '2eb2c2d6'; // safeBatchTransferFrom(...)

function extractABIAddress(paramsHex: string, wordIndex: number): string {
  const start = wordIndex * 64;
  const end = start + 64;
  if (paramsHex.length < end) return '';
  const word = paramsHex.slice(start, end);
  const addrHex = word.slice(24, 64);
  if (/^0{40}$/.test(addrHex)) return '';
  return addrHex;
}

function extractABIUint256(paramsHex: string, wordIndex: number): string {
  const start = wordIndex * 64;
  const end = start + 64;
  if (paramsHex.length < end) return '';
  const word = paramsHex.slice(start, end);
  const val = BigInt('0x' + word);
  return val.toString();
}

/** Decode EVM call data to extract recipient, tokenID, and call type */
export function decodeEVMCallData(dataHex: string): DecodedEVMCall {
  const data = dataHex.toLowerCase().replace(/^0x/, '');
  if (data.length < 8) return { recipient: '', tokenID: '', callType: 'unknown' };

  const selector = data.slice(0, 8);
  const params = data.slice(8);

  switch (selector) {
    case SEL_ERC20_TRANSFER: {
      const addr = extractABIAddress(params, 0);
      if (addr) return { recipient: addr, tokenID: '', callType: 'erc20_transfer' };
      break;
    }
    case SEL_ERC20_TRANSFER_FROM: {
      const addr = extractABIAddress(params, 1);
      if (addr) {
        const tid = extractABIUint256(params, 2);
        return { recipient: addr, tokenID: tid, callType: 'erc20_transferFrom' };
      }
      break;
    }
    case SEL_ERC721_SAFE_TRANSFER_3:
    case SEL_ERC721_SAFE_TRANSFER_4: {
      const addr = extractABIAddress(params, 1);
      if (addr) {
        const tid = extractABIUint256(params, 2);
        return { recipient: addr, tokenID: tid, callType: 'erc721_safeTransferFrom' };
      }
      break;
    }
    case SEL_ERC1155_SAFE_TRANSFER: {
      const addr = extractABIAddress(params, 1);
      if (addr) {
        const tid = extractABIUint256(params, 2);
        return { recipient: addr, tokenID: tid, callType: 'erc1155_safeTransferFrom' };
      }
      break;
    }
    case SEL_ERC1155_BATCH_TRANSFER: {
      const addr = extractABIAddress(params, 1);
      if (addr) return { recipient: addr, tokenID: '', callType: 'erc1155_safeBatchTransferFrom' };
      break;
    }
  }

  return { recipient: '', tokenID: '', callType: 'unknown' };
}

/**
 * Filter events for EVM.TransactionExecuted and parse each into EVMExecution.
 */
export function parseEVMEvents(events: RawEvent[]): EVMExecution[] {
  const results: EVMExecution[] = [];
  for (const event of events) {
    if (!event.type.includes('EVM.TransactionExecuted')) continue;
    const execution = parseEVMExecution(event);
    if (execution) results.push(execution);
  }
  return results;
}
