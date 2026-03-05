import { useState, useRef, useEffect } from 'react';
import { Wallet, ChevronDown } from 'lucide-react';
import Avatar from 'boring-avatars';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

export type SignerOption =
  | { type: 'fcl' }
  | { type: 'local'; key: LocalKey; account: KeyAccount };

interface SignerSelectorProps {
  selected: SignerOption;
  onSelect: (option: SignerOption) => void;
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
  onViewAccount?: (address: string) => void;
}

export default function SignerSelector({ selected, onSelect, localKeys, accountsMap, onViewAccount }: SignerSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const label =
    selected.type === 'fcl'
      ? 'FCL Wallet'
      : truncateAddress(selected.account.flowAddress);

  const icon =
    selected.type === 'fcl'
      ? <Wallet className="w-3 h-3" />
      : <Avatar size={14} name={selected.account.flowAddress} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />;

  // Click the main button: open account panel if local, toggle dropdown if FCL
  const handleMainClick = () => {
    if (selected.type === 'local' && onViewAccount) {
      onViewAccount(selected.account.flowAddress);
    } else {
      setOpen(!open);
    }
  };

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={handleMainClick}
        className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs px-2 py-1 rounded-l border border-zinc-700 transition-colors"
      >
        {icon}
        <span className="max-w-[120px] truncate font-mono">{label}</span>
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

          {/* FCL Wallet group */}
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

          {localEntries.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-zinc-500">
              No local keys available. Open key manager to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
