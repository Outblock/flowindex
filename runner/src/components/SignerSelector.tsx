import { useState, useRef, useEffect } from 'react';
import { Wallet, Key, ChevronDown, HardDrive } from 'lucide-react';
import type { UserKey } from '../auth/useKeys';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

export type SignerOption =
  | { type: 'fcl' }
  | { type: 'custodial'; key: UserKey }
  | { type: 'local'; key: LocalKey; account: KeyAccount };

interface SignerSelectorProps {
  keys: UserKey[];
  selected: SignerOption;
  onSelect: (option: SignerOption) => void;
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
}

export default function SignerSelector({ keys, selected, onSelect, localKeys, accountsMap }: SignerSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
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
      : selected.type === 'local'
        ? `${selected.key.label || 'Key'} → ${truncateAddress(selected.account.flowAddress)}`
        : `${selected.key.label || 'Key'} (${truncateAddress(selected.key.flow_address)})`;

  const icon =
    selected.type === 'fcl'
      ? <Wallet className="w-3 h-3" />
      : selected.type === 'local'
        ? <HardDrive className="w-3 h-3" />
        : <Key className="w-3 h-3" />;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-700 transition-colors"
      >
        {icon}
        <span className="max-w-[120px] truncate">{label}</span>
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
                    <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{entry.key.label || 'Key'}</span>
                    <span className="text-zinc-500 ml-auto flex-shrink-0">
                      {truncateAddress(entry.account.flowAddress)} (key #{entry.account.keyIndex})
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

          {/* Cloud Keys group */}
          {keys.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-700">
                Cloud Keys
              </div>
              {keys.map((key) => (
                <button
                  key={key.id}
                  onClick={() => { onSelect({ type: 'custodial', key }); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                    selected.type === 'custodial' && selected.key.id === key.id ? 'text-emerald-400' : 'text-zinc-300'
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span className="truncate">{key.label || 'Key'}</span>
                  <span className="text-zinc-500 ml-auto">{truncateAddress(key.flow_address)}</span>
                </button>
              ))}
            </>
          )}

          {keys.length === 0 && localEntries.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-zinc-500">
              No keys available. Open key manager to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
