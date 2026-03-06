import { useState, useEffect, useRef } from 'react';
import { fcl } from '../flow/fclConfig';
import { Wallet, LogOut, ChevronDown, Key as KeyIcon, ExternalLink } from 'lucide-react';
import Avatar from 'boring-avatars';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

/** Derive 5 colors from an address (matches frontend AddressLink). */
function colorsFromAddress(addr: string): string[] {
  let hex = addr.replace(/^0x/, '');
  if (hex.length > 16) hex = hex.replace(/^0+/, '') || hex;
  hex = hex.padEnd(16, '0').slice(0, 16);
  const c1 = `#${hex.slice(0, 6)}`;
  const c2 = `#${hex.slice(5, 11)}`;
  const c3 = `#${hex.slice(10, 16)}`;
  const c4 = `#${hex[1]}${hex[3]}${hex[7]}${hex[9]}${hex[13]}${hex[15]}`;
  const c5 = `#${hex[0]}${hex[4]}${hex[8]}${hex[12]}${hex[2]}${hex[6]}`;
  return [c1, c2, c3, c4, c5];
}

interface WalletButtonProps {
  localKeys?: LocalKey[];
  accountsMap?: Record<string, KeyAccount[]>;
  selectedLocalAccount?: { key: LocalKey; account: KeyAccount } | null;
  network?: 'mainnet' | 'testnet';
  onOpenKeyManager?: () => void;
  onSelectLocalAccount?: (key: LocalKey, account: KeyAccount) => void;
  onDisconnectLocal?: () => void;
  onViewAccount?: (address: string) => void;
}

export default function WalletButton({
  localKeys = [],
  accountsMap = {},
  selectedLocalAccount,
  network = 'mainnet',
  onOpenKeyManager,
  onSelectLocalAccount,
  onDisconnectLocal,
  onViewAccount,
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
    <button
      onClick={() => onViewAccount?.(displayAddress!)}
      className="flex items-center gap-1.5 text-xs text-emerald-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors"
    >
      <Avatar size={16} name={displayAddress!} variant="beam" colors={colorsFromAddress(displayAddress!)} />
      <span className="font-mono">{truncated}</span>
    </button>
  );
}
