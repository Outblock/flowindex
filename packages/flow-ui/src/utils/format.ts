/**
 * General formatting utilities for numbers, storage sizes, etc.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const formatStorageBytes = (bytes: any): string => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n === 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

export function formatNumber(
    value: number,
    options: Intl.NumberFormatOptions = { useGrouping: true },
    locale = 'en-US',
) {
    if (!Number.isFinite(value)) return String(value);
    return new Intl.NumberFormat(locale, options).format(value);
}
