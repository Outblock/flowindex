// ---------------------------------------------------------------------------
// AddressSidebar — auto-loads local key accounts + manual address input
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Loader2, Type, Rocket, Eye } from 'lucide-react';
import Avatar from 'boring-avatars';
import { useLocalKeys } from '../auth/useLocalKeys';
import type { VerifiedAddress, AddressSource } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(addr: string): string {
  const full = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (full.length <= 13) return full;
  return `${full.slice(0, 6)}...${full.slice(-4)}`;
}

function canDeploy(source: AddressSource): boolean {
  return source === 'local-key';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  addresses: VerifiedAddress[];
  selectedAddress: VerifiedAddress | null;
  onSelect: (addr: VerifiedAddress) => void;
  onAdd: (
    address: string,
    network: string,
    source: AddressSource,
    label?: string,
  ) => Promise<unknown>;
  onRemove: (id: string) => Promise<void>;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddressSidebar({
  addresses,
  selectedAddress,
  onSelect,
  onAdd,
  onRemove,
  loading,
}: Props) {
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manual input
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualAddr, setManualAddr] = useState('');

  // Local keys
  const { localKeys, accountsMap } = useLocalKeys();

  // Auto-register local key accounts when they become available
  const localAccountAddrs = localKeys
    .flatMap((key) => (accountsMap[key.id] || []).map((acc) => ({
      address: acc.flowAddress,
      label: key.label || `Key ${key.id.slice(0, 6)}`,
    })))
    .filter((v, i, arr) => arr.findIndex((a) => a.address === v.address) === i);

  useEffect(() => {
    if (localAccountAddrs.length === 0) return;
    // Auto-add local key accounts that aren't already in the address list
    for (const acc of localAccountAddrs) {
      const normalized = acc.address.replace(/^0x/, '').toLowerCase();
      const exists = addresses.some(
        (a) => a.address === normalized && a.network === network,
      );
      if (!exists) {
        onAdd(acc.address, network, 'local-key', acc.label).catch(() => {});
      }
    }
  }, [localAccountAddrs.length, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Add via manual input
  // -----------------------------------------------------------------------
  const handleManualAdd = useCallback(async () => {
    const addr = manualAddr.trim();
    if (!addr) return;
    setError(null);
    setAdding(true);
    try {
      await onAdd(addr, network, 'manual');
      setManualAddr('');
      setShowManualInput(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setAdding(false);
    }
  }, [manualAddr, network, onAdd]);

  // -----------------------------------------------------------------------
  // Remove address
  // -----------------------------------------------------------------------
  const handleRemove = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setRemovingId(id);
      try {
        await onRemove(id);
      } catch {
        // ignore
      } finally {
        setRemovingId(null);
      }
    },
    [onRemove],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Addresses
        </span>
      </div>

      {/* Address list */}
      <div className="flex-1 overflow-y-auto">
        {loading && addresses.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
          </div>
        ) : addresses.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <Type className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-500">No addresses yet</p>
            <p className="text-xs text-zinc-600 mt-1">
              Add an address to see contracts
            </p>
          </div>
        ) : (
          <div className="py-1">
            {addresses.map((addr) => {
              const isSelected = selectedAddress?.id === addr.id;
              const isRemoving = removingId === addr.id;
              const deployable = canDeploy(addr.source);

              return (
                <button
                  key={addr.id}
                  onClick={() => onSelect(addr)}
                  className={`group w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="shrink-0">
                    <Avatar size={24} name={addr.address} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono truncate">
                        {truncateAddress(addr.address)}
                      </span>
                      {deployable ? (
                        <Rocket className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                      ) : (
                        <Eye className="w-2.5 h-2.5 text-zinc-600 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          addr.network === 'mainnet'
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                        }`}
                      />
                      <span className="text-[10px] text-zinc-500">
                        {addr.network}
                      </span>
                      {addr.label && (
                        <span className="text-[10px] text-zinc-500 truncate">
                          {addr.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete button (hover) */}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleRemove(e as unknown as React.MouseEvent, addr.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-red-400 transition-opacity cursor-pointer"
                    title="Remove address"
                  >
                    {isRemoving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="border-t border-zinc-800 p-2 space-y-2">
        {/* Error message */}
        {error && (
          <p className="text-[10px] text-red-400 px-1 truncate" title={error}>
            {error}
          </p>
        )}

        {/* Manual address input */}
        {showManualInput ? (
          <div className="space-y-1.5">
            <input
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              placeholder="0x... or hex address"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleManualAdd();
                if (e.key === 'Escape') { setShowManualInput(false); setManualAddr(''); }
              }}
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={handleManualAdd}
                disabled={adding || !manualAddr.trim()}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-50 transition-colors"
              >
                {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Add (view only)
              </button>
              <button
                onClick={() => { setShowManualInput(false); setManualAddr(''); }}
                className="px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Network toggle */}
            <div className="flex items-center gap-1 bg-zinc-800/50 rounded p-0.5">
              <button
                onClick={() => setNetwork('mainnet')}
                className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                  network === 'mainnet'
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Mainnet
              </button>
              <button
                onClick={() => setNetwork('testnet')}
                className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                  network === 'testnet'
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Testnet
              </button>
            </div>

            {/* Add address button */}
            <button
              onClick={() => setShowManualInput(true)}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Address
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
