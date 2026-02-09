import { useEffect, useMemo, useState } from 'react';
import NumberFlow from '@number-flow/react';

type NumberFlowFormat = {
  useGrouping?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

type Props = {
  value: number;
  format?: NumberFlowFormat;
  className?: string;
};

export function SafeNumberFlow(props: Props) {
  const { value, format, className } = props;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fallbackText = useMemo(() => {
    const options: Intl.NumberFormatOptions = {};
    if (format?.useGrouping != null) options.useGrouping = format.useGrouping;
    if (format?.minimumFractionDigits != null) options.minimumFractionDigits = format.minimumFractionDigits;
    if (format?.maximumFractionDigits != null) options.maximumFractionDigits = format.maximumFractionDigits;
    return Number.isFinite(value) ? value.toLocaleString(undefined, options) : String(value);
  }, [value, format?.useGrouping, format?.minimumFractionDigits, format?.maximumFractionDigits]);

  if (!mounted) {
    // NumberFlow is animation/layout-heavy and has been observed to cause React hydration mismatches.
    // Render a stable SSR fallback and swap to NumberFlow after hydration.
    return <span className={className}>{fallbackText}</span>;
  }

  return <NumberFlow value={value} format={format} className={className} />;
}

