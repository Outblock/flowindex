import { ExternalLink } from 'lucide-react';

interface EVMBridgeBadgeProps {
  evmAddress: string;
  className?: string;
}

/**
 * A compact badge shown next to token/collection names indicating
 * the asset is bridged to Flow EVM. Hover shows tooltip, click opens
 * the EVM explorer page.
 */
export function EVMBridgeBadge({ evmAddress, className = '' }: EVMBridgeBadgeProps) {
  if (!evmAddress) return null;

  const href = `https://evm.flowindex.io/address/${evmAddress}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="This asset is bridged to Flow EVM. Click to view on EVM explorer."
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800/40 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors cursor-pointer shrink-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      EVM
      <ExternalLink className="w-2.5 h-2.5" />
    </a>
  );
}
