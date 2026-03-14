// runner/src/flow/evmRevert.ts
import { decodeErrorResult, type Abi } from 'viem';

/** Well-known Panic codes from Solidity */
const PANIC_CODES: Record<number, string> = {
  0x00: 'Generic compiler panic',
  0x01: 'Assert failed',
  0x11: 'Arithmetic overflow/underflow',
  0x12: 'Division by zero',
  0x21: 'Conversion to invalid enum value',
  0x22: 'Access to incorrectly encoded storage byte array',
  0x31: 'pop() on empty array',
  0x32: 'Array index out of bounds',
  0x41: 'Too much memory allocated',
  0x51: 'Called zero-initialized function variable',
};

export interface ParsedRevert {
  type: 'require' | 'panic' | 'custom' | 'unknown';
  message: string;
  panicCode?: number;
  errorName?: string;
  args?: readonly unknown[];
}

/** Try to decode revert data into a human-readable reason */
export function parseRevertReason(errorData: string, abi?: Abi): ParsedRevert {
  if (!errorData || errorData === '0x') {
    return { type: 'unknown', message: 'Transaction reverted without reason' };
  }

  // Error(string) — standard require/revert message
  // Selector: 0x08c379a0
  if (errorData.startsWith('0x08c379a0')) {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }],
        data: errorData as `0x${string}`,
      });
      return {
        type: 'require',
        message: String(decoded.args?.[0] || 'Reverted'),
        errorName: 'Error',
        args: decoded.args,
      };
    } catch { /* fall through */ }
  }

  // Panic(uint256)
  // Selector: 0x4e487b71
  if (errorData.startsWith('0x4e487b71')) {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: 'error', name: 'Panic', inputs: [{ type: 'uint256', name: 'code' }] }],
        data: errorData as `0x${string}`,
      });
      const code = Number(decoded.args?.[0] ?? 0);
      return {
        type: 'panic',
        message: PANIC_CODES[code] || `Panic(0x${code.toString(16)})`,
        panicCode: code,
        errorName: 'Panic',
        args: decoded.args,
      };
    } catch { /* fall through */ }
  }

  // Custom error — try decoding against provided ABI
  if (abi) {
    try {
      const decoded = decodeErrorResult({
        abi,
        data: errorData as `0x${string}`,
      });
      const args = decoded.args?.map(a => typeof a === 'bigint' ? a.toString() : String(a));
      return {
        type: 'custom',
        message: `${decoded.errorName}(${args?.join(', ') || ''})`,
        errorName: decoded.errorName,
        args: decoded.args,
      };
    } catch { /* not a known error in ABI */ }
  }

  return {
    type: 'unknown',
    message: `Reverted with data: ${errorData.slice(0, 66)}${errorData.length > 66 ? '...' : ''}`,
  };
}

/** Extract revert data from a viem error object */
export function extractRevertData(error: any): string | null {
  // viem wraps revert data in various error types
  const data = error?.data?.data || error?.cause?.data?.data || error?.data;
  if (typeof data === 'string' && data.startsWith('0x')) return data;

  // Sometimes the hex is embedded in the message
  const msg = error?.message || error?.shortMessage || '';
  const hexMatch = msg.match(/0x[0-9a-fA-F]{8,}/);
  return hexMatch ? hexMatch[0] : null;
}
