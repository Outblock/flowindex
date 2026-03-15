import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2, ExternalLink, Box, Coins, Image, Rocket, Eye, FileCode } from 'lucide-react';
import Avatar from 'boring-avatars';
import { useAddresses } from '../deploy/useAddresses';
import { fetchContracts } from '../deploy/api';
import type { ContractInfo, VerifiedAddress } from '../deploy/api';
import { useLocalKeys } from '../auth/useLocalKeys';

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

function truncateAddress(addr: string): string {
  const full = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (full.length <= 13) return full;
  return `${full.slice(0, 6)}...${full.slice(-4)}`;
}

function kindIcon(kind?: string) {
  switch (kind) {
    case 'FT':
      return <Coins className="w-3.5 h-3.5 text-amber-400" />;
    case 'NFT':
      return <Image className="w-3.5 h-3.5 text-purple-400" />;
    default:
      return <Box className="w-3.5 h-3.5 text-zinc-500" />;
  }
}

interface ContractsPanelProps {
  isLoggedIn: boolean;
  onLogin: () => void;
  onOpenContract: (name: string, code: string) => void;
}

export default function ContractsPanel({ isLoggedIn, onLogin, onOpenContract }: ContractsPanelProps) {
  const { addresses, loading: addressesLoading, addAddress, removeAddress } = useAddresses();
  const { localKeys, accountsMap } = useLocalKeys();

  const [selectedAddress, setSelectedAddress] = useState<VerifiedAddress | null>(null);
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);

  const [showAddInput, setShowAddInput] = useState(false);
  const [manualAddr, setManualAddr] = useState('');
  const [addNetwork, setAddNetwork] = useState<'mainnet' | 'testnet'>('mainnet');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Auto-register local key accounts
  const localAccountAddrs = localKeys
    .flatMap((key) => (accountsMap[key.id] || []).map((acc) => ({
      address: acc.flowAddress,
      label: key.label || `Key ${key.id.slice(0, 6)}`,
    })))
    .filter((v, i, arr) => arr.findIndex((a) => a.address === v.address) === i);

  useEffect(() => {
    if (localAccountAddrs.length === 0) return;
    for (const acc of localAccountAddrs) {
      const normalized = acc.address.replace(/^0x/, '').toLowerCase();
      const exists = addresses.some(
        (a) => a.address === normalized && a.network === addNetwork,
      );
      if (!exists) {
        addAddress(acc.address, addNetwork, 'local-key', acc.label).catch(() => {});
      }
    }
  }, [localAccountAddrs.length, addNetwork]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first address
  useEffect(() => {
    if (addresses.length > 0 && !selectedAddress) {
      setSelectedAddress(addresses[0]);
    }
    if (selectedAddress && !addresses.find((a) => a.id === selectedAddress.id)) {
      setSelectedAddress(addresses[0] ?? null);
    }
  }, [addresses, selectedAddress]);

  // Fetch contracts when address changes
  useEffect(() => {
    if (!selectedAddress) { setContracts([]); return; }
    let cancelled = false;
    (async () => {
      setContractsLoading(true);
      try {
        const result = await fetchContracts(selectedAddress.address, selectedAddress.network);
        if (!cancelled) setContracts(result);
      } catch {
        if (!cancelled) setContracts([]);
      } finally {
        if (!cancelled) setContractsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedAddress]);

  const handleAdd = useCallback(async () => {
    const addr = manualAddr.trim();
    if (!addr) return;
    setAdding(true);
    try {
      await addAddress(addr, addNetwork, 'manual');
      setManualAddr('');
      setShowAddInput(false);
    } catch { /* ignore */ } finally {
      setAdding(false);
    }
  }, [manualAddr, addNetwork, addAddress]);

  const handleRemove = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setRemovingId(id);
    try { await removeAddress(id); } catch { /* ignore */ } finally { setRemovingId(null); }
  }, [removeAddress]);

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Rocket className="w-6 h-6 text-zinc-600 mb-2" />
        <p className="text-xs text-zinc-500 mb-3">Sign in to manage your deployed contracts</p>
        <button
          onClick={onLogin}
          className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Addresses section */}
      <div className="px-2 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
        Addresses
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '40%' }}>
        {addressesLoading && addresses.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
          </div>
        ) : addresses.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] text-zinc-500">No addresses yet</p>
          </div>
        ) : (
          <div className="py-0.5">
            {addresses.map((addr) => {
              const isSelected = selectedAddress?.id === addr.id;
              const deployable = addr.source === 'local-key';
              return (
                <button
                  key={addr.id}
                  onClick={() => setSelectedAddress(addr)}
                  className={`group w-full flex items-center gap-1.5 px-2 py-1 text-left transition-colors ${
                    isSelected
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <Avatar size={18} name={addr.address} variant="beam" colors={colorsFromAddress(addr.address)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono truncate">{truncateAddress(addr.address)}</span>
                      {deployable ? (
                        <Rocket className="w-2 h-2 text-emerald-500 shrink-0" />
                      ) : (
                        <Eye className="w-2 h-2 text-zinc-600 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`inline-block w-1 h-1 rounded-full ${addr.network === 'mainnet' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <span className="text-[9px] text-zinc-600">{addr.network}</span>
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleRemove(e as unknown as React.MouseEvent, addr.id)}
                    className="p-0.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {removingId === addr.id ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-2.5 h-2.5" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Add address */}
        {showAddInput ? (
          <div className="px-2 py-1.5 space-y-1 border-t border-zinc-800">
            <input
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              placeholder="0x..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 font-mono placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') { setShowAddInput(false); setManualAddr(''); }
              }}
              autoFocus
            />
            <div className="flex items-center gap-1">
              <div className="flex bg-zinc-800/50 rounded p-0.5 flex-1">
                <button
                  onClick={() => setAddNetwork('mainnet')}
                  className={`flex-1 text-[9px] py-0.5 rounded transition-colors ${addNetwork === 'mainnet' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}
                >
                  Mainnet
                </button>
                <button
                  onClick={() => setAddNetwork('testnet')}
                  className={`flex-1 text-[9px] py-0.5 rounded transition-colors ${addNetwork === 'testnet' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}
                >
                  Testnet
                </button>
              </div>
              <button
                onClick={handleAdd}
                disabled={adding || !manualAddr.trim()}
                className="px-2 py-0.5 text-[9px] rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-50 transition-colors"
              >
                {adding ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Add'}
              </button>
              <button
                onClick={() => { setShowAddInput(false); setManualAddr(''); }}
                className="text-[9px] text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddInput(true)}
            className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors border-t border-zinc-800"
          >
            <Plus className="w-3 h-3" />
            Add Address
          </button>
        )}
      </div>

      {/* Contracts section */}
      <div className="px-2 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-t border-b border-zinc-800">
        Contracts {selectedAddress && `(${truncateAddress(selectedAddress.address)})`}
      </div>
      <div className="flex-1 overflow-y-auto">
        {!selectedAddress ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[10px] text-zinc-500">Select an address to view contracts</p>
          </div>
        ) : contractsLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
          </div>
        ) : contracts.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[10px] text-zinc-500">No contracts found</p>
          </div>
        ) : (
          <div className="py-0.5">
            {contracts.map((c) => (
              <div
                key={`${c.address}.${c.name}`}
                className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-zinc-800/50 transition-colors"
              >
                {kindIcon(c.kind)}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-200 truncate">{c.name}</div>
                  <div className="flex items-center gap-2 text-[9px] text-zinc-500">
                    {c.kind && <span>{c.kind}</span>}
                    <span>v{c.version}</span>
                    {c.dependent_count > 0 && <span>{c.dependent_count} deps</span>}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {c.code && (
                    <button
                      onClick={() => onOpenContract(`contracts/${c.name}.cdc`, c.code!)}
                      className="p-0.5 text-zinc-500 hover:text-emerald-400"
                      title="Open in editor"
                    >
                      <FileCode className="w-3 h-3" />
                    </button>
                  )}
                  <a
                    href={`https://${selectedAddress.network === 'testnet' ? 'testnet.' : ''}flowindex.io/contract/A.${c.address}.${c.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-0.5 text-zinc-500 hover:text-blue-400"
                    title="View on FlowIndex"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
