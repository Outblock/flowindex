// runner/src/interact/ContractLoader.tsx
import { useState, useCallback, useEffect } from 'react';
import { Loader2, Download, AlertCircle, ChevronDown } from 'lucide-react';
import type { Abi } from 'viem';

interface ContractLoaderProps {
  initialAddress: string;
  network: 'mainnet' | 'testnet';
  onNetworkChange: (n: 'mainnet' | 'testnet') => void;
  onContractLoaded: (address: `0x${string}`, name: string, abi: Abi) => void;
}

const SERVER_BASE = ''; // Same-origin proxy

function validateAbi(json: unknown): json is Abi {
  if (!Array.isArray(json)) return false;
  return json.every((item: any) => item && typeof item.type === 'string');
}

export default function ContractLoader({
  initialAddress,
  network,
  onNetworkChange,
  onContractLoaded,
}: ContractLoaderProps) {
  const [address, setAddress] = useState(initialAddress);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showManualAbi, setShowManualAbi] = useState(false);
  const [manualAbi, setManualAbi] = useState('');

  // Auto-fetch if initialAddress is provided
  useEffect(() => {
    if (initialAddress) {
      handleFetch(initialAddress);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetch = useCallback(async (addr?: string) => {
    const target = (addr || address).trim();
    if (!target) return;

    // Validate address format (40 hex chars)
    const clean = target.startsWith('0x') ? target.slice(2) : target;
    if (clean.length !== 40 || !/^[0-9a-fA-F]+$/.test(clean)) {
      setError('Invalid EVM address. Must be 40 hex characters.');
      return;
    }

    const fullAddr = target.startsWith('0x') ? target : `0x${target}`;

    setLoading(true);
    setError('');
    setShowManualAbi(false);

    try {
      const res = await fetch(`${SERVER_BASE}/api/evm-contracts/${fullAddr}?network=${network}`);
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();

      if (data.verified && data.abi) {
        onContractLoaded(fullAddr as `0x${string}`, data.name || 'Contract', data.abi);
      } else if (data.verified && !data.abi) {
        setError('Contract is verified but ABI not available. Paste ABI manually.');
        setShowManualAbi(true);
      } else {
        setError('No verified contract found at this address. You can paste an ABI manually.');
        setShowManualAbi(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch contract');
    } finally {
      setLoading(false);
    }
  }, [address, network, onContractLoaded]);

  const handleManualAbiSubmit = useCallback(() => {
    try {
      const parsed = JSON.parse(manualAbi);
      if (!validateAbi(parsed)) {
        setError('Invalid ABI format. Paste a valid JSON ABI array.');
        return;
      }
      const fullAddr = address.trim().startsWith('0x') ? address.trim() : `0x${address.trim()}`;
      onContractLoaded(fullAddr as `0x${string}`, 'Custom Contract', parsed);
    } catch {
      setError('Invalid JSON. Please check your ABI.');
    }
  }, [manualAbi, address, onContractLoaded]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {/* Address input */}
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
          placeholder="0x... (EVM contract address)"
          className="flex-1 bg-zinc-800 text-sm text-zinc-200 px-3 py-2.5 rounded-lg border border-zinc-600 focus:border-zinc-500 focus:outline-none placeholder:text-zinc-600 font-mono"
          autoFocus
        />

        {/* Network selector */}
        <div className="relative">
          <select
            value={network}
            onChange={(e) => onNetworkChange(e.target.value as 'mainnet' | 'testnet')}
            className="appearance-none bg-zinc-800 text-xs text-zinc-300 pl-3 pr-7 py-2.5 rounded-lg border border-zinc-600 focus:border-zinc-500 focus:outline-none cursor-pointer"
          >
            <option value="mainnet">Mainnet</option>
            <option value="testnet">Testnet</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
        </div>

        {/* Load button */}
        <button
          onClick={() => handleFetch()}
          disabled={loading || !address.trim()}
          className="px-4 py-2.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Load
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-900/20 px-3 py-2 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Manual ABI input */}
      {showManualAbi && (
        <div className="space-y-2">
          <textarea
            value={manualAbi}
            onChange={(e) => setManualAbi(e.target.value)}
            placeholder={'Paste ABI JSON array here...\n[\n  { "type": "function", "name": "balanceOf", ... }\n]'}
            className="w-full h-32 bg-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded-lg border border-zinc-600 focus:border-zinc-500 focus:outline-none font-mono resize-y placeholder:text-zinc-600"
          />
          <button
            onClick={handleManualAbiSubmit}
            disabled={!manualAbi.trim()}
            className="px-4 py-2 text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
          >
            Load with ABI
          </button>
        </div>
      )}
    </div>
  );
}
