// runner/src/interact/RecentContracts.tsx
import { Clock, Trash2 } from 'lucide-react';

export interface RecentContract {
  address: string;
  network: 'mainnet' | 'testnet';
  name: string;
  timestamp: number;
}

const STORAGE_KEY = 'runner:recent-contracts';
const MAX_RECENT = 10;

export function loadRecentContracts(): RecentContract[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecentContract(entry: RecentContract): RecentContract[] {
  const existing = loadRecentContracts();
  // Remove duplicate (same address + network)
  const filtered = existing.filter(
    (c) => !(c.address.toLowerCase() === entry.address.toLowerCase() && c.network === entry.network),
  );
  const updated = [entry, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function removeRecentContract(address: string, network: string): RecentContract[] {
  const existing = loadRecentContracts();
  const updated = existing.filter(
    (c) => !(c.address.toLowerCase() === address.toLowerCase() && c.network === network),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface RecentContractsProps {
  contracts: RecentContract[];
  onSelect: (c: RecentContract) => void;
  onRemove?: (c: RecentContract) => void;
}

export default function RecentContracts({ contracts, onSelect, onRemove }: RecentContractsProps) {
  if (contracts.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="w-3 h-3 text-zinc-500" />
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Recent</span>
      </div>
      <div className="space-y-1">
        {contracts.map((c) => (
          <button
            key={`${c.address}-${c.network}`}
            onClick={() => onSelect(c)}
            className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-200 font-medium">{c.name}</span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  c.network === 'mainnet' ? 'bg-emerald-500' : 'bg-amber-500'
                }`} />
                <span className="text-[10px] text-zinc-500">{c.network}</span>
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">{c.address}</span>
            </div>
            <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(c.timestamp)}</span>
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(c); }}
                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-0.5"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
