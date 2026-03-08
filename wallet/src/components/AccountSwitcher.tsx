import { useState, useRef, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { formatShort, cn } from '@flowindex/flow-ui';
import { ChevronDown, Check } from 'lucide-react';

export default function AccountSwitcher() {
  const { activeAccount, accounts, network, switchAccount } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!activeAccount) {
    return (
      <div className="px-3 py-2 text-xs text-wallet-muted">No accounts</div>
    );
  }

  const address =
    network === 'testnet' && activeAccount.flowAddressTestnet
      ? activeAccount.flowAddressTestnet
      : activeAccount.flowAddress;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-2xl transition-colors',
          'hover:bg-wallet-surface text-left',
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">
            {activeAccount.authenticatorName || 'Passkey'}
          </div>
          <div className="text-xs font-mono text-wallet-muted truncate">
            {formatShort(address, 6, 4)}
          </div>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-wallet-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && accounts.length > 1 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl border border-wallet-border bg-wallet-surface shadow-xl py-1 overflow-hidden">
          {accounts.map((acct) => {
            const acctAddr =
              network === 'testnet' && acct.flowAddressTestnet
                ? acct.flowAddressTestnet
                : acct.flowAddress;
            const isActive = acct.credentialId === activeAccount.credentialId;

            return (
              <button
                key={acct.credentialId}
                type="button"
                onClick={() => {
                  switchAccount(acct.credentialId);
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors',
                  'hover:bg-wallet-surface-hover',
                  isActive && 'bg-wallet-accent/5',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {acct.authenticatorName || 'Passkey'}
                  </div>
                  <div className="text-xs font-mono text-wallet-muted truncate">
                    {formatShort(acctAddr, 6, 4)}
                  </div>
                </div>
                {isActive && <Check className="h-4 w-4 text-wallet-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
