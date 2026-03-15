import { useState, useEffect, useRef } from 'react';
import { fcl } from '../flow/fclConfig';
import { Wallet, LogOut, ChevronDown, Key as KeyIcon, ExternalLink, Globe } from 'lucide-react';
import Avatar from 'boring-avatars';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';
import type { FlowNetwork } from '../flow/networks';

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
  network?: FlowNetwork;
  activeFileLanguage?: 'cadence' | 'sol';
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
  activeFileLanguage,
  onOpenKeyManager,
  onSelectLocalAccount,
  onDisconnectLocal,
  onViewAccount,
}: WalletButtonProps) {
  const [fclUser, setFclUser] = useState<{ addr?: string | null }>({});
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // EVM wallet state (wagmi)
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connect: connectEvm } = useConnect();
  const { disconnect: disconnectEvm } = useDisconnect();

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
  const flowConnected = fclConnected || localConnected;

  // When editing Solidity and EVM wallet is connected, prefer showing EVM address
  const showEvmWallet = evmConnected && activeFileLanguage === 'sol';

  const flowDisplayAddress = fclConnected
    ? fclUser.addr!
    : localConnected
      ? selectedLocalAccount!.account.flowAddress
      : null;

  const displayAddress = showEvmWallet
    ? evmAddress!
    : flowDisplayAddress;

  const connected = flowConnected || evmConnected;

  const truncated = displayAddress
    ? displayAddress.length > 16
      ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
      : `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
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
            <button
              onClick={() => { connectEvm({ connector: injected() }); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <Globe className="w-3.5 h-3.5 text-violet-400" />
              EVM Wallet
            </button>
          </div>
        )}
      </div>
    );
  }

  // Show EVM wallet with violet accent when connected and editing Solidity
  if (showEvmWallet) {
    return (
      <button
        onClick={() => onViewAccount?.(displayAddress!)}
        className="flex items-center gap-1.5 text-xs text-violet-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="font-mono">{truncated}</span>
      </button>
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
