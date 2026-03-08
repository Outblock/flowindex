import { useWallet } from '../hooks/useWallet';
import { cn } from '@flowindex/flow-ui';

export default function NetworkBadge({ compact }: { compact?: boolean }) {
  const { network, switchNetwork } = useWallet();
  const isMainnet = network === 'mainnet';

  return (
    <button
      type="button"
      onClick={() => switchNetwork(isMainnet ? 'testnet' : 'mainnet')}
      className={cn(
        'flex items-center gap-1.5 rounded-xl transition-all duration-200 cursor-pointer select-none',
        'hover:bg-wallet-surface',
        compact ? 'w-10 h-10 justify-center' : 'px-3 py-1.5 text-xs font-medium',
        isMainnet ? 'text-emerald-400' : 'text-orange-400',
      )}
      title={isMainnet ? 'Mainnet — Click to switch' : 'Testnet — Click to switch'}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full flex-shrink-0',
          isMainnet
            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
            : 'bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.5)]',
        )}
      />
      {!compact && (isMainnet ? 'Mainnet' : 'Testnet')}
    </button>
  );
}
