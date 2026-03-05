import { X, ExternalLink } from 'lucide-react';
import Avatar from 'boring-avatars';

interface AccountPanelProps {
  address: string;
  network: 'mainnet' | 'testnet';
  onClose: () => void;
}

function buildUrl(address: string, network: 'mainnet' | 'testnet'): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  const addr = address.startsWith('0x') ? address : `0x${address}`;
  return `${base}/account/${addr}?tab=tokens`;
}

function formatAddress(address: string): string {
  const addr = address.startsWith('0x') ? address : `0x${address}`;
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export default function AccountPanel({ address, network, onClose }: AccountPanelProps) {
  const url = buildUrl(address, network);
  const displayAddr = address.startsWith('0x') ? address : `0x${address}`;

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar
            size={20}
            name={address.replace(/^0x/, '')}
            variant="beam"
            colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']}
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
