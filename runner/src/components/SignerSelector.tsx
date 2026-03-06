import { useState, useRef, useEffect } from 'react';
import { Wallet, ChevronDown, LogOut, Key, Zap, Droplets } from 'lucide-react';
import Avatar from 'boring-avatars';
import { fcl } from '../flow/fclConfig';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

export type SignerOption =
  | { type: 'none' }
  | { type: 'fcl' }
  | { type: 'local'; key: LocalKey; account: KeyAccount }
  | { type: 'passkey'; credentialId: string; flowAddress: string; publicKeySec1Hex: string };

interface SignerSelectorProps {
  selected: SignerOption;
  onSelect: (option: SignerOption) => void;
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
  passkeyAccounts?: Array<{ credentialId: string; flowAddress: string; publicKeySec1Hex: string; authenticatorName?: string }>;
  onViewAccount?: (address: string) => void;
  onOpenKeyManager?: () => void;
  onOpenConnectModal?: () => void;
  autoSign: boolean;
  onToggleAutoSign: (value: boolean) => void;
  network: 'mainnet' | 'testnet';
}

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

/** Fetch FLOW balance for an address. */
function useFlowBalance(address: string | null) {
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setBalance(null); return; }
    let cancelled = false;
    const addr = address.startsWith('0x') ? address : `0x${address}`;
    fcl.account(addr).then((acct: { balance: number }) => {
      if (!cancelled) setBalance((acct.balance / 1e8).toFixed(4));
    }).catch(() => {
      if (!cancelled) setBalance(null);
    });
    return () => { cancelled = true; };
  }, [address]);

  return balance;
}

export default function SignerSelector({ selected, onSelect, localKeys, accountsMap, passkeyAccounts = [], onViewAccount, onOpenKeyManager, onOpenConnectModal, autoSign, onToggleAutoSign, network }: SignerSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedAddress = selected.type === 'local' ? selected.account.flowAddress
    : selected.type === 'passkey' ? selected.flowAddress
    : null;
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

  // Click the main button: open modal if disconnected, open account panel if local, toggle dropdown otherwise
  const handleMainClick = () => {
    if (selected.type === 'none' && onOpenConnectModal) {
      onOpenConnectModal();
    } else if (selected.type === 'local' && onViewAccount) {
      onViewAccount(selected.account.flowAddress);
    } else if (selected.type === 'passkey' && onViewAccount) {
      onViewAccount(selected.flowAddress);
    } else {
      setOpen(!open);
    }
  };

  const handleDisconnect = () => {
    onSelect({ type: 'none' });
    setOpen(false);
  };

  // Render button content based on connection state
  const renderButtonContent = () => {
    if (selected.type === 'local') {
      const colors = colorsFromAddress(selected.account.flowAddress);
      return (
        <>
          {autoSign && <Zap className="w-3 h-3 text-amber-400" />}
          <Avatar size={16} name={`0x${selected.account.flowAddress}`} variant="beam" colors={colors} />
          {balance !== null ? (
            <span className="text-xs text-emerald-400 font-medium">{balance} FLOW</span>
          ) : (
            <span className="text-xs text-zinc-500">...</span>
          )}
        </>
      );
    }
    if (selected.type === 'passkey') {
      const colors = colorsFromAddress(selected.flowAddress);
      return (
        <>
          {autoSign && <Zap className="w-3 h-3 text-amber-400" />}
          <Avatar size={16} name={`0x${selected.flowAddress}`} variant="beam" colors={colors} />
          {balance !== null ? (
            <span className="text-xs text-emerald-400 font-medium">{balance} FLOW</span>
          ) : (
            <span className="text-xs text-zinc-500">...</span>
          )}
        </>
      );
    }
    if (selected.type === 'fcl') {
      return (
        <>
          <Wallet className="w-3.5 h-3.5" />
          <span className="text-xs">FCL Wallet</span>
        </>
      );
    }
    return (
      <>
        <Wallet className="w-3 h-3" />
        <span className="text-xs">Connect</span>
      </>
    );
  };

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={handleMainClick}
        className={`flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs px-2 py-1 rounded-l border border-zinc-700 transition-colors ${
          isConnected ? 'text-emerald-400' : 'text-zinc-400'
        }`}
      >
        {renderButtonContent()}
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
                Local Wallet
              </div>
              {localEntries.map((entry) => {
                const isSelected =
                  selected.type === 'local' &&
                  selected.key.id === entry.key.id &&
                  selected.account.flowAddress === entry.account.flowAddress &&
                  selected.account.keyIndex === entry.account.keyIndex;
                const colors = colorsFromAddress(entry.account.flowAddress);
                return (
                  <button
                    key={`${entry.key.id}-${entry.account.flowAddress}-${entry.account.keyIndex}`}
                    onClick={() => { onSelect({ type: 'local', key: entry.key, account: entry.account }); setOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                      isSelected ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                  >
                    <Avatar size={16} name={`0x${entry.account.flowAddress}`} variant="beam" colors={colors} />
                    <span className="truncate">{entry.key.label || 'Key'}</span>
                    <span className="text-zinc-500 ml-auto flex-shrink-0">
                      {truncateAddress(entry.account.flowAddress)}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* Passkey Wallet group */}
          {passkeyAccounts.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-700">
                Passkey Wallet
              </div>
              {passkeyAccounts.map((acct) => {
                const isSelected = selected.type === 'passkey' && selected.credentialId === acct.credentialId;
                const colors = colorsFromAddress(acct.flowAddress);
                return (
                  <button
                    key={acct.credentialId}
                    onClick={() => {
                      onSelect({ type: 'passkey', credentialId: acct.credentialId, flowAddress: acct.flowAddress, publicKeySec1Hex: acct.publicKeySec1Hex });
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                      isSelected ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                  >
                    <Avatar size={16} name={`0x${acct.flowAddress}`} variant="beam" colors={colors} />
                    <span className="truncate">{acct.authenticatorName || 'Passkey'}</span>
                    <span className="text-zinc-500 ml-auto flex-shrink-0">
                      {truncateAddress(acct.flowAddress)}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* External Wallet group */}
          <>
            <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-700">
              External Wallet
            </div>
            <button
              onClick={() => {
                setOpen(false);
                if (onOpenConnectModal) { onOpenConnectModal(); }
                else { fcl.authenticate(); onSelect({ type: 'fcl' }); }
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                selected.type === 'fcl' ? 'text-emerald-400' : 'text-zinc-300'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              FCL Wallet
            </button>
          </>

          {/* Manage Keys */}
          {onOpenKeyManager && (
            <>
              <div className="border-t border-zinc-700" />
              <button
                onClick={() => { onOpenKeyManager(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Manage Keys
              </button>
            </>
          )}

          {/* Auto Sign toggle */}
          <div className="border-t border-zinc-700" />
          <button
            onClick={() => onToggleAutoSign(!autoSign)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Zap className={`w-3.5 h-3.5 ${autoSign ? 'text-amber-400' : ''}`} />
              <span>Auto Sign</span>
            </div>
            <div
              className={`relative w-7 h-4 rounded-full transition-colors ${
                autoSign ? 'bg-amber-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  autoSign ? 'translate-x-3' : ''
                }`}
              />
            </div>
          </button>

          {/* Testnet faucet */}
          {network === 'testnet' && (
            <>
              <div className="border-t border-zinc-700" />
              <a
                href="https://faucet.flow.com/fund-account"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-blue-400 hover:bg-zinc-700 transition-colors"
                onClick={() => setOpen(false)}
              >
                <Droplets className="w-3.5 h-3.5" />
                Testnet Faucet
              </a>
            </>
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
