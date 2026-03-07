/**
 * Address normalization and formatting utilities for Flow blockchain addresses.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeAddress = (value: any): string => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const formatShort = (value: any, head = 8, tail = 6): string => {
    if (!value) return 'N/A';
    const normalized = normalizeAddress(value);
    if (normalized.length <= head + tail + 3) return normalized;
    if (tail === 0) return `${normalized.slice(0, head)}...`;
    return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
};
