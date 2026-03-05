import { X, ExternalLink, LogOut } from 'lucide-react';
import Avatar from 'boring-avatars';

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

interface AccountPanelProps {
  address: string;
  network: 'mainnet' | 'testnet';
  onClose: () => void;
  onDisconnect?: () => void;
}

function buildUrl(address: string, network: 'mainnet' | 'testnet'): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  const bare = address.startsWith('0x') ? address.slice(2) : address;
  return `${base}/accounts/${bare}?tab=tokens`;
}

function formatAddress(address: string): string {
  const addr = address.startsWith('0x') ? address : `0x${address}`;
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export default function AccountPanel({ address, network, onClose, onDisconnect }: AccountPanelProps) {
  const url = buildUrl(address, network);
  const displayAddr = address.startsWith('0x') ? address : `0x${address}`;

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar
            size={20}
            name={displayAddr}
            variant="beam"
            colors={colorsFromAddress(displayAddr)}
          />
          <span className="text-sm font-mono text-zinc-100 truncate">
            {formatAddress(address)}
          </span>
          {network === 'testnet' && (
            <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">
              testnet
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          {onDisconnect && (
            <button
              onClick={() => { onDisconnect(); onClose(); }}
              className="text-zinc-500 hover:text-red-400 p-1 transition-colors"
              title="Disconnect"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* iframe */}
      <div className="flex-1 min-h-0">
        <iframe
          src={url}
          className="w-full h-full border-0"
          title={`Account ${displayAddr}`}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
