// ---------------------------------------------------------------------------
// AddressSidebar — verified address list + FCL wallet verification
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import { Plus, Trash2, Wallet, Loader2 } from 'lucide-react';
import * as fcl from '@onflow/fcl';
import type { VerifiedAddress } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a string to hex (for FCL signUserMessage) */
function toHex(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

/** Truncate an address for display: 0x1234...abcd */
function truncateAddress(addr: string): string {
  const full = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (full.length <= 13) return full;
  return `${full.slice(0, 6)}...${full.slice(-4)}`;
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
    message: string,
    signatures: unknown[],
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

  // -----------------------------------------------------------------------
  // Add address flow: FCL authenticate -> sign message -> verify on backend
  // -----------------------------------------------------------------------
  const handleAddAddress = useCallback(async () => {
    setError(null);
    setAdding(true);
    try {
      // 1. Authenticate with FCL wallet
      await fcl.authenticate();
      const user = await fcl.currentUser.snapshot();
      const addr = user.addr;
      if (!addr) {
        throw new Error('Wallet did not return an address');
      }

      // 2. Create verification message and sign it
      const message = `Verify ownership of ${addr} on FlowIndex at ${Date.now()}`;
      const msgHex = toHex(message);
      const compositeSignatures = await fcl.currentUser.signUserMessage(msgHex);

      if (
        !compositeSignatures ||
        !Array.isArray(compositeSignatures) ||
        compositeSignatures.length === 0
      ) {
        throw new Error('Signing was cancelled or failed');
      }

      // 3. Send to backend
      await onAdd(addr, network, message, compositeSignatures);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to verify address';
      // Don't show error for user-cancelled actions
      if (!msg.includes('cancel') && !msg.includes('declined')) {
        setError(msg);
      }
    } finally {
      setAdding(false);
    }
  }, [network, onAdd]);

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
            <Wallet className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-500">No verified addresses</p>
            <p className="text-xs text-zinc-600 mt-1">
              Connect a wallet to get started
            </p>
          </div>
        ) : (
          <div className="py-1">
            {addresses.map((addr) => {
              const isSelected = selectedAddress?.id === addr.id;
              const isRemoving = removingId === addr.id;

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
                  <div className="flex-1 min-w-0">
                    {/* Label or address */}
                    <div className="text-xs font-mono truncate">
                      {addr.label || truncateAddress(addr.address)}
                    </div>
                    {/* Network badge + address (if label shown) */}
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
                        <span className="text-[10px] text-zinc-600 font-mono truncate">
                          {truncateAddress(addr.address)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete button (hover) */}
                  <button
                    onClick={(e) => handleRemove(e, addr.id)}
                    disabled={isRemoving}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-red-400 transition-opacity"
                    title="Remove address"
                  >
                    {isRemoving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </button>
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
          onClick={handleAddAddress}
          disabled={adding}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              Add Address
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
