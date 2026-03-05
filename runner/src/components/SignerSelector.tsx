import { useState, useRef, useEffect } from 'react';
import { Wallet, ChevronDown, LogOut } from 'lucide-react';
import Avatar from 'boring-avatars';
import * as fcl from '@onflow/fcl';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

export type SignerOption =
  | { type: 'none' }
  | { type: 'fcl' }
  | { type: 'local'; key: LocalKey; account: KeyAccount };

interface SignerSelectorProps {
  selected: SignerOption;
  onSelect: (option: SignerOption) => void;
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
  onViewAccount?: (address: string) => void;
}

/** Fetch FLOW balance for an address. Returns formatted string like "1.234". */
function useFlowBalance(address: string | null) {
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setBalance(null); return; }
    let cancelled = false;
    const addr = address.startsWith('0x') ? address : `0x${address}`;
    fcl.account(addr).then((acct: { balance: number }) => {
      if (!cancelled) {
        // FCL returns balance in UFix64 units (1e-8)
        setBalance((acct.balance / 1e8).toFixed(4));
      }
    }).catch(() => {
      if (!cancelled) setBalance(null);
    });
    return () => { cancelled = true; };
  }, [address]);

  return balance;
}

export default function SignerSelector({ selected, onSelect, localKeys, accountsMap, onViewAccount }: SignerSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedAddress = selected.type === 'local' ? selected.account.flowAddress : null;
  const balance = useFlowBalance(selectedAddress);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function truncateAddress(addr: string) {
    if (addr.length <= 10) return addr;
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  // Build flat list of local key+account entries
  const localEntries: { key: LocalKey; account: KeyAccount }[] = [];
  for (const key of localKeys) {
    const accounts = accountsMap[key.id] || [];
    for (const account of accounts) {
      localEntries.push({ key, account });
    }
  }

  const isConnected = selected.type !== 'none';

  const label =
    selected.type === 'local'
      ? truncateAddress(selected.account.flowAddress)
      : selected.type === 'fcl'
        ? 'FCL Wallet'
        : 'Connect';

  const icon =
    selected.type === 'local'
      ? <Avatar size={14} name={selected.account.flowAddress} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />
      : <Wallet className="w-3 h-3" />;

  // Click the main button: open account panel if local, toggle dropdown otherwise
  const handleMainClick = () => {
    if (selected.type === 'local' && onViewAccount) {
      onViewAccount(selected.account.flowAddress);
    } else {
      setOpen(!open);
    }
  };

  const handleDisconnect = () => {
    onSelect({ type: 'none' });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={handleMainClick}
        className={`flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs px-2 py-1 rounded-l border border-zinc-700 transition-colors ${
          isConnected ? 'text-emerald-400' : 'text-zinc-400'
        }`}
      >
        {icon}
        <span className="max-w-[120px] truncate font-mono">{label}</span>
        {balance !== null && (
          <span className="text-[10px] text-zinc-500 ml-0.5">
            {balance} FLOW
          </span>
        )}
      </button>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs px-1 py-1 rounded-r border border-l-0 border-zinc-700 transition-colors"
      >
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50">
          {/* Local Keys group */}
          {localEntries.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-700">
                Local Keys
              </div>
              {localEntries.map((entry) => {
                const isSelected =
                  selected.type === 'local' &&
                  selected.key.id === entry.key.id &&
                  selected.account.flowAddress === entry.account.flowAddress &&
                  selected.account.keyIndex === entry.account.keyIndex;
                return (
                  <button
                    key={`${entry.key.id}-${entry.account.flowAddress}-${entry.account.keyIndex}`}
                    onClick={() => { onSelect({ type: 'local', key: entry.key, account: entry.account }); setOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                      isSelected ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                  >
                    <Avatar size={16} name={entry.account.flowAddress} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />
                    <span className="truncate">{entry.key.label || 'Key'}</span>
                    <span className="text-zinc-500 ml-auto flex-shrink-0">
                      {truncateAddress(entry.account.flowAddress)}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* FCL Wallet group — only show when NOT connected to a local key */}
          {selected.type !== 'local' && (
            <>
              <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-700">
                FCL Wallet
              </div>
              <button
                onClick={() => { onSelect({ type: 'fcl' }); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                  selected.type === 'fcl' ? 'text-emerald-400' : 'text-zinc-300'
                }`}
              >
                <Wallet className="w-3.5 h-3.5" />
                Connected Wallet
              </button>
            </>
          )}

          {localEntries.length === 0 && selected.type !== 'local' && (
            <div className="px-3 py-2 text-[10px] text-zinc-500">
              No local keys available. Open key manager to create one.
            </div>
          )}

          {/* Disconnect option — show when connected */}
          {isConnected && (
            <>
              <div className="border-t border-zinc-700" />
              <button
                onClick={handleDisconnect}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
