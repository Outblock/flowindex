import { useState, useCallback } from 'react';
import { X, Loader2, Download, AlertCircle } from 'lucide-react';
import * as fcl from '@onflow/fcl';
import SolidityIcon from './icons/SolidityIcon';

interface ContractEntry {
  name: string;
  content: string;
  language: 'cadence' | 'solidity';
  preview: string;
}

interface ImportFromAddressDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (files: { path: string; content: string }[], projectName: string) => void;
  network: string;
  serverBaseUrl?: string;
}

function CadenceIcon({ className }: { className?: string }) {
  return (
    <img
      src="https://cadence.flowindex.io/favicon.ico"
      alt="cdc"
      className={className}
      style={{ imageRendering: 'auto' }}
    />
  );
}

function getPreview(code: string, lines = 3): string {
  return code
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, lines)
    .join('\n');
}

export default function ImportFromAddressDialog({
  open,
  onClose,
  onImport,
  network,
  serverBaseUrl,
}: ImportFromAddressDialogProps) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetched, setFetched] = useState(false);

  const isEVMAddress = (addr: string) => {
    const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
    return clean.length === 40 && /^[0-9a-fA-F]+$/.test(clean);
  };

  const isCadenceAddress = (addr: string) => {
    const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
    return clean.length === 16 && /^[0-9a-fA-F]+$/.test(clean);
  };

  const handleFetch = useCallback(async () => {
    const trimmed = address.trim();
    if (!trimmed) return;

    setLoading(true);
    setError('');
    setContracts([]);
    setSelected(new Set());
    setFetched(false);

    try {
      const results: ContractEntry[] = [];

      if (isCadenceAddress(trimmed)) {
        // Fetch Cadence contracts via FCL
        const account = await fcl.account(trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`);
        const contractMap = account.contracts || {};
        for (const [name, code] of Object.entries(contractMap)) {
          results.push({
            name,
            content: code as string,
            language: 'cadence',
            preview: getPreview(code as string),
          });
        }
      } else if (isEVMAddress(trimmed)) {
        // Fetch verified Solidity contracts via runner server
        const base = serverBaseUrl || '';
        const addr = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
        const res = await fetch(`${base}/api/evm-contracts/${addr}`);
        if (!res.ok) throw new Error('Failed to fetch EVM contracts');
        const data = await res.json();
        if (data.verified && data.files) {
          for (const f of data.files) {
            results.push({
              name: f.path.replace(/\.sol$/, ''),
              content: f.content,
              language: 'solidity',
              preview: getPreview(f.content),
            });
          }
        }
      } else {
        setError('Invalid address format. Use 16 hex chars for Cadence or 40 hex chars for EVM.');
        setLoading(false);
        return;
      }

      setContracts(results);
      setSelected(new Set(results.map((c) => c.name)));
      setFetched(true);

      if (results.length === 0) {
        setError(
          isEVMAddress(trimmed)
            ? 'No verified Solidity contracts found at this address.'
            : 'No contracts found at this address.',
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch contracts');
    } finally {
      setLoading(false);
    }
  }, [address, serverBaseUrl]);

  const handleImport = useCallback(() => {
    const files = contracts
      .filter((c) => selected.has(c.name))
      .map((c) => ({
        path: `contracts/${c.name}.${c.language === 'cadence' ? 'cdc' : 'sol'}`,
        content: c.content,
      }));

    if (files.length === 0) return;

    const trimmed = address.trim();
    const shortAddr = trimmed.startsWith('0x')
      ? `${trimmed.slice(0, 6)}..${trimmed.slice(-4)}`
      : `0x${trimmed.slice(0, 4)}..${trimmed.slice(-4)}`;
    onImport(files, shortAddr);
    handleClose();
  }, [contracts, selected, address, onImport]);

  const handleClose = () => {
    setAddress('');
    setError('');
    setContracts([]);
    setSelected(new Set());
    setFetched(false);
    onClose();
  };

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-200">Import from Address</h3>
          <button onClick={handleClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* Address input */}
          <div className="flex gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
              placeholder="0x... (Cadence or EVM address)"
              className="flex-1 bg-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded border border-zinc-600 focus:border-zinc-500 focus:outline-none placeholder:text-zinc-600"
              autoFocus
            />
            <button
              onClick={handleFetch}
              disabled={loading || !address.trim()}
              className="px-3 py-2 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-colors flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Fetch
            </button>
          </div>

          <p className="text-[10px] text-zinc-600">
            16 hex = Cadence contracts &middot; 40 hex = Verified Solidity (Blockscout)
          </p>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-900/20 px-3 py-2 rounded">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Contract list */}
          {contracts.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {contracts.map((c) => (
                <label
                  key={c.name}
                  className="flex items-start gap-2 px-2 py-2 rounded hover:bg-zinc-800/60 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.name)}
                    onChange={() => toggleSelect(c.name)}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {c.language === 'cadence' ? (
                        <CadenceIcon className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <SolidityIcon className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                      )}
                      <span className="text-xs text-zinc-200 font-medium">{c.name}</span>
                      <span className="text-[9px] text-zinc-600">
                        .{c.language === 'cadence' ? 'cdc' : 'sol'}
                      </span>
                    </div>
                    <pre className="text-[9px] text-zinc-600 mt-0.5 leading-tight truncate whitespace-pre overflow-hidden">
                      {c.preview}
                    </pre>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Empty state after fetch */}
          {fetched && contracts.length === 0 && !error && (
            <p className="text-xs text-zinc-500 text-center py-4">No contracts found</p>
          )}
        </div>

        {/* Footer */}
        {contracts.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-700 flex items-center justify-between">
            <span className="text-[10px] text-zinc-500">
              {selected.size} of {contracts.length} selected
            </span>
            <button
              onClick={handleImport}
              disabled={selected.size === 0}
              className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-colors"
            >
              Import Selected
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
