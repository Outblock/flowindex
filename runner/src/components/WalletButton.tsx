import { useState, useEffect, useRef } from 'react';
import { fcl } from '../flow/fclConfig';
import { Wallet, LogOut, ChevronDown, Key as KeyIcon, ExternalLink } from 'lucide-react';
import Avatar from 'boring-avatars';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

interface WalletButtonProps {
  localKeys?: LocalKey[];
  accountsMap?: Record<string, KeyAccount[]>;
  selectedLocalAccount?: { key: LocalKey; account: KeyAccount } | null;
  network?: 'mainnet' | 'testnet';
  onOpenKeyManager?: () => void;
  onSelectLocalAccount?: (key: LocalKey, account: KeyAccount) => void;
  onDisconnectLocal?: () => void;
}

function flowIndexUrl(address: string, network: 'mainnet' | 'testnet'): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  return `${base}/${address}`;
}

export default function WalletButton({
  localKeys = [],
  accountsMap = {},
  selectedLocalAccount,
  network = 'mainnet',
  onOpenKeyManager,
  onSelectLocalAccount,
  onDisconnectLocal,
}: WalletButtonProps) {
  const [fclUser, setFclUser] = useState<{ addr?: string | null }>({});
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = fcl.currentUser.subscribe(setFclUser);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fclConnected = !!fclUser?.addr;
  const localConnected = !!selectedLocalAccount;
  const connected = fclConnected || localConnected;

  const displayAddress = fclConnected
    ? fclUser.addr!
    : localConnected
      ? selectedLocalAccount!.account.flowAddress
      : null;

  const truncated = displayAddress
    ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
    : null;

  if (!connected) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2.5 py-1 transition-colors"
        >
          <Wallet className="w-3.5 h-3.5" />
          Connect
          <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50">
            <button
              onClick={() => { onOpenKeyManager?.(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <KeyIcon className="w-3.5 h-3.5" />
              Local Key
            </button>
            <button
              onClick={() => { fcl.authenticate(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <Wallet className="w-3.5 h-3.5" />
              FCL Wallet
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-emerald-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors"
      >
        <Avatar size={16} name={displayAddress!} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />
        <span className="font-mono">{truncated}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50">
          {/* View on flowindex */}
          <a
            href={flowIndexUrl(displayAddress!, network)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            onClick={() => setOpen(false)}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View on FlowIndex
          </a>

          <div className="border-t border-zinc-700" />

          {/* Switch to different local accounts */}
          {localKeys.length > 0 && onSelectLocalAccount && (
            <>
              <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider">
                Switch Account
              </div>
              {localKeys.map((key) => {
                const accs = accountsMap[key.id] || [];
                return accs.map((acc) => (
                  <button
                    key={`${key.id}-${acc.flowAddress}-${acc.keyIndex}`}
                    onClick={() => { onSelectLocalAccount(key, acc); setOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors ${
                      selectedLocalAccount?.account.flowAddress === acc.flowAddress && selectedLocalAccount?.account.keyIndex === acc.keyIndex
                        ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                  >
                    <Avatar size={14} name={acc.flowAddress} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />
                    <span className="font-mono truncate">{acc.flowAddress.slice(0, 6)}...{acc.flowAddress.slice(-4)}</span>
                  </button>
                ));
              })}
              <div className="border-t border-zinc-700" />
            </>
          )}

          {/* Disconnect */}
          <button
            onClick={() => {
              if (fclConnected) fcl.unauthenticate();
              if (localConnected) onDisconnectLocal?.();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
