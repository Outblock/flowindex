import { Link } from '@tanstack/react-router';
import { ArrowRightLeft } from 'lucide-react';

interface COABadgeProps {
  evmAddress: string;
  className?: string;
}

/**
 * Badge for Cadence Owned Account (COA) EVM addresses.
 * Links to the internal EVM account page.
 */
export function COABadge({ evmAddress, className = '' }: COABadgeProps) {
  if (!evmAddress) return null;

  const normalized = evmAddress.startsWith('0x') ? evmAddress : `0x${evmAddress}`;

  return (
    <Link
      to={`/accounts/${normalized}` as any}
      title="Cadence Owned Account — view EVM account"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors cursor-pointer shrink-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="uppercase tracking-wider">COA</span>
      <span className="font-normal">{normalized}</span>
      <ArrowRightLeft className="w-2.5 h-2.5 flex-shrink-0" />
    </Link>
  );
}
