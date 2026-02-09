export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = { useGrouping: true },
  locale = 'en-US',
) {
  if (!Number.isFinite(value)) return String(value);
  return new Intl.NumberFormat(locale, options).format(value);
}

