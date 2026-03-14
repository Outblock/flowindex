/** Format wei string to human-readable value */
export function formatWei(wei: string | null | undefined, decimals = 18, precision = 4): string {
  if (!wei || wei === '0') return '0';
  try {
    const num = BigInt(wei);
    const divisor = BigInt(10 ** decimals);
    const whole = num / divisor;
    const remainder = num % divisor;
    const fracStr = remainder.toString().padStart(decimals, '0').slice(0, precision);
    const result = `${whole}.${fracStr}`.replace(/\.?0+$/, '');
    return result || '0';
  } catch {
    return wei;
  }
}

/** Format gas number with commas */
export function formatGas(gas: string | number | null | undefined): string {
  if (!gas) return '0';
  return Number(gas).toLocaleString();
}

/** Truncate hex string: 0xAbCd...1234 */
export function truncateHash(hash: string, startLen = 6, endLen = 4): string {
  if (!hash || hash.length <= startLen + endLen + 3) return hash;
  return `${hash.slice(0, startLen)}...${hash.slice(-endLen)}`;
}

/** Normalize EVM address to lowercase with 0x prefix */
export function normalizeEVMAddress(addr: string): string {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  return `0x${clean}`;
}

/** Check if a hex string (without 0x) is a 40-char EVM address */
export function isEVMAddress(hexOnly: string): boolean {
  return /^[0-9a-fA-F]{40}$/.test(hexOnly);
}

/** Map Blockscout tx status to display */
export function txStatusLabel(status: string): { label: string; color: string } {
  if (status === 'ok') return { label: 'Success', color: 'text-green-600 dark:text-green-400' };
  return { label: 'Failed', color: 'text-red-600 dark:text-red-400' };
}

/** Map internal tx type + call_type to display label */
export function internalTxTypeLabel(type: string, callType: string | null): string {
  if (type === 'create') return 'CREATE';
  if (type === 'selfdestruct') return 'SELFDESTRUCT';
  if (callType === 'delegatecall') return 'DELEGATECALL';
  if (callType === 'staticcall') return 'STATICCALL';
  return 'CALL';
}
