import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useWalletClient } from 'wagmi';
import {
  BookOpen, Pencil, ChevronDown, ChevronRight, Loader2, Copy, Check,
  X, ExternalLink, RefreshCw, CheckSquare, Square, Eye, EyeOff,
} from 'lucide-react';
import type { AbiFunction } from 'viem';
import type { DeployedContract, ContractCallResult } from '../flow/evmContract';
import { callContractRead, callContractWrite, categorizeAbiFunctions } from '../flow/evmContract';
import SolidityParamInput, { parseParamValue } from './SolidityParamInput';
import type { Chain } from 'viem/chains';

// ── Shared helpers ─────────────────────────────────────────────

export function formatResult(data: any): string {
  if (data === undefined || data === null) return 'null';
  if (typeof data === 'bigint') return data.toString();
  if (typeof data === 'object')
    return JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  return String(data);
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getExplorerBaseUrl(chainId: number): string {
  return chainId === 545 ? 'https://evm-testnet.flowindex.io' : 'https://evm.flowindex.io';
}

// ── ResultDisplay ──────────────────────────────────────────────

function ResultDisplay({ result, explorerBaseUrl }: { result: ContractCallResult; explorerBaseUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const text = result.success ? formatResult(result.data) : result.error || 'Unknown error';

  return (
    <div
      className={`text-xs font-mono p-2 rounded border ${
        result.success
          ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-300'
          : 'bg-red-900/20 border-red-700/50 text-red-400'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 break-all whitespace-pre-wrap">{text}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      {result.txHash && (
        <div className="mt-1 text-zinc-500">
          tx:{' '}
          {explorerBaseUrl ? (
            <a
              href={`${explorerBaseUrl}/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              {result.txHash}
            </a>
          ) : (
            <span className="text-blue-400">{result.txHash}</span>
          )}
        </div>
      )}
      {result.gasUsed && <div className="text-zinc-600">gas: {result.gasUsed.toString()}</div>}
    </div>
  );
}

// ── FunctionCard (center panel) ────────────────────────────────

export function FunctionCard({
  fn,
  contract,
  chain,
  isWrite,
  onUnpin,
}: {
  fn: AbiFunction;
  contract: DeployedContract;
  chain: Chain;
  isWrite: boolean;
  onUnpin?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [ethValue, setEthValue] = useState('');
  const [result, setResult] = useState<ContractCallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: walletClient } = useWalletClient();
  const explorerBaseUrl = getExplorerBaseUrl(contract.chainId);

  const handleCall = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const args = fn.inputs.map((input, i) => {
        const key = input.name || `arg${i}`;
        return parseParamValue(input.type, paramValues[key] || '');
      });

      let res: ContractCallResult;
      if (isWrite) {
        if (!walletClient) {
          setResult({ success: false, error: 'Connect EVM wallet first' });
          setLoading(false);
          return;
        }
        const value =
          fn.stateMutability === 'payable' && ethValue ? BigInt(ethValue) : undefined;
        res = await callContractWrite(walletClient, contract, fn.name, args, value);
      } else {
        res = await callContractRead(chain, contract, fn.name, args);
      }
      setResult(res);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, [fn, paramValues, ethValue, contract, chain, isWrite, walletClient]);

  const hasInputs = fn.inputs.length > 0;
  const accentBorder = isWrite ? 'border-l-violet-500/60' : 'border-l-blue-500/60';

  return (
    <div className={`border border-zinc-700/80 border-l-2 ${accentBorder} rounded-lg bg-zinc-800/60`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => (hasInputs ? setExpanded(!expanded) : handleCall())}
          className="flex-1 flex items-center gap-2 text-left hover:opacity-80 transition-opacity min-w-0"
        >
          {hasInputs ? (
            expanded ? (
              <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
            )
          ) : isWrite ? (
            <Pencil className="w-3 h-3 text-violet-400 shrink-0" />
          ) : (
            <BookOpen className="w-3 h-3 text-blue-400 shrink-0" />
          )}
          <span className="text-xs font-mono text-zinc-200 truncate">{fn.name}</span>
          {!hasInputs && !isWrite && result?.success && (
            <span className="ml-auto text-xs font-mono text-emerald-400 truncate max-w-[200px]">
              {formatResult(result.data)}
            </span>
          )}
          {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500 ml-auto shrink-0" />}
        </button>
        {onUnpin && (
          <button
            onClick={onUnpin}
            className="text-zinc-600 hover:text-zinc-400 transition-colors p-0.5 shrink-0"
            title="Remove from view"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Expanded inputs */}
      {expanded && hasInputs && (
        <div className="px-3 pb-3 space-y-3 border-t border-zinc-700/50">
          <div className="pt-3 space-y-2.5">
            {fn.inputs.map((input, i) => {
              const key = input.name || `arg${i}`;
              return (
                <SolidityParamInput
                  key={key}
                  param={input}
                  value={paramValues[key] || ''}
                  onChange={(v) => setParamValues((prev) => ({ ...prev, [key]: v }))}
                />
              );
            })}
            {fn.stateMutability === 'payable' && (
              <div className="space-y-0.5">
                <label className="text-[11px] text-zinc-400 font-mono">
                  value <span className="text-zinc-600">(wei)</span>
                </label>
                <input
                  type="text"
                  value={ethValue}
                  onChange={(e) => setEthValue(e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1 text-xs font-mono rounded border border-zinc-700 bg-zinc-800 text-zinc-200 outline-none focus:border-violet-500"
                />
              </div>
            )}
          </div>
          <button
            onClick={handleCall}
            disabled={loading}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              isWrite
                ? 'bg-violet-600 hover:bg-violet-500 text-white disabled:bg-violet-800'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:bg-blue-800'
            }`}
          >
            {loading ? 'Calling...' : isWrite ? 'Write' : 'Read'}
          </button>
          {result && <ResultDisplay result={result} explorerBaseUrl={explorerBaseUrl} />}
        </div>
      )}

      {/* No-input result */}
      {!hasInputs && result && (
        <div className="px-3 pb-3 border-t border-zinc-700/50 pt-2">
          <ResultDisplay result={result} explorerBaseUrl={explorerBaseUrl} />
        </div>
      )}
    </div>
  );
}

// ── FunctionNav (left sidebar) ─────────────────────────────────

export function FunctionNav({
  readFns,
  writeFns,
  pinnedSet,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  readFns: AbiFunction[];
  writeFns: AbiFunction[];
  pinnedSet: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const allPinned = readFns.length + writeFns.length === pinnedSet.size;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Functions</span>
        <button
          onClick={allPinned ? onClearAll : onSelectAll}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          title={allPinned ? 'Clear all' : 'Select all'}
        >
          {allPinned ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {allPinned ? 'Clear' : 'All'}
        </button>
      </div>

      {/* Function lists */}
      <div className="flex-1 overflow-y-auto py-1">
        {readFns.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-blue-400/80 font-semibold flex items-center gap-1">
              <BookOpen className="w-3 h-3" />
              Read
              <span className="text-zinc-600 ml-auto">{readFns.length}</span>
            </div>
            {readFns.map((fn) => {
              const pinned = pinnedSet.has(fn.name);
              return (
                <button
                  key={fn.name}
                  onClick={() => onToggle(fn.name)}
                  className={`group w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    pinned
                      ? 'text-zinc-200 hover:bg-zinc-700/40'
                      : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-400'
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full shrink-0 ${pinned ? 'bg-blue-400' : 'bg-zinc-700'}`} />
                  <span className="text-[11px] font-mono truncate flex-1">{fn.name}</span>
                  {pinned && (
                    <X className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {writeFns.length > 0 && (
          <div className={readFns.length > 0 ? 'mt-2' : ''}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-violet-400/80 font-semibold flex items-center gap-1">
              <Pencil className="w-3 h-3" />
              Write
              <span className="text-zinc-600 ml-auto">{writeFns.length}</span>
            </div>
            {writeFns.map((fn) => {
              const pinned = pinnedSet.has(fn.name);
              return (
                <button
                  key={fn.name}
                  onClick={() => onToggle(fn.name)}
                  className={`group w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    pinned
                      ? 'text-zinc-200 hover:bg-zinc-700/40'
                      : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-400'
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full shrink-0 ${pinned ? 'bg-violet-400' : 'bg-zinc-700'}`} />
                  <span className="text-[11px] font-mono truncate flex-1">{fn.name}</span>
                  {pinned && (
                    <X className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ContractOverview (right sidebar) ───────────────────────────

interface AutoCallResult {
  loading: boolean;
  result: ContractCallResult | null;
}

export function ContractOverview({
  contract,
  chain,
  readFns,
}: {
  contract: DeployedContract;
  chain: Chain;
  readFns: AbiFunction[];
}) {
  const [copied, setCopied] = useState(false);
  const explorerBaseUrl = getExplorerBaseUrl(contract.chainId);
  const isTestnet = contract.chainId === 545;

  // Auto-call zero-input read functions
  const zeroInputFns = useMemo(
    () => readFns.filter((fn) => fn.inputs.length === 0),
    [readFns],
  );

  const [autoResults, setAutoResults] = useState<Record<string, AutoCallResult>>({});
  const calledRef = useRef(false);

  const callFn = useCallback(
    async (fn: AbiFunction) => {
      setAutoResults((prev) => ({
        ...prev,
        [fn.name]: { loading: true, result: null },
      }));
      try {
        const res = await callContractRead(chain, contract, fn.name, []);
        setAutoResults((prev) => ({
          ...prev,
          [fn.name]: { loading: false, result: res },
        }));
      } catch (err: any) {
        setAutoResults((prev) => ({
          ...prev,
          [fn.name]: { loading: false, result: { success: false, error: err.message } },
        }));
      }
    },
    [chain, contract],
  );

  // Auto-call on mount
  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;
    zeroInputFns.forEach((fn) => callFn(fn));
  }, [zeroInputFns, callFn]);

  const handleCopyAddress = useCallback(() => {
    navigator.clipboard.writeText(contract.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [contract.address]);

  return (
    <div className="flex flex-col h-full">
      {/* Contract info card */}
      <div className="border-b border-zinc-700/50 px-3 py-3 space-y-2.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Contract</div>

        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-zinc-100">{contract.name}</div>

          {/* Address row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-zinc-400 truncate">
              {truncateAddress(contract.address)}
            </span>
            <button
              onClick={handleCopyAddress}
              className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
              title="Copy address"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
            <a
              href={`${explorerBaseUrl}/address/${contract.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-600 hover:text-blue-400 transition-colors shrink-0"
              title="View on FlowIndex"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Network badge */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                isTestnet ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            />
            <span
              className={`text-[10px] font-medium ${
                isTestnet ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              Flow EVM {isTestnet ? 'Testnet' : 'Mainnet'}
            </span>
          </div>
        </div>
      </div>

      {/* Contract data (auto-called zero-input reads) */}
      {zeroInputFns.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Contract Data
            </div>
            <div className="space-y-1.5">
              {zeroInputFns.map((fn) => {
                const entry = autoResults[fn.name];
                return (
                  <div
                    key={fn.name}
                    className="flex items-start gap-2 py-1.5 px-2 rounded bg-zinc-800/40 border border-zinc-700/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-mono text-blue-400/70 mb-0.5">{fn.name}</div>
                      {entry?.loading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />
                      ) : entry?.result ? (
                        <div
                          className={`text-[11px] font-mono break-all ${
                            entry.result.success ? 'text-zinc-200' : 'text-red-400'
                          }`}
                        >
                          {entry.result.success
                            ? formatResult(entry.result.data)
                            : entry.result.error || 'Error'}
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-600">--</span>
                      )}
                    </div>
                    <button
                      onClick={() => callFn(fn)}
                      className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0 mt-0.5"
                      title="Refresh"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${entry?.loading ? 'animate-spin' : ''}`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ContractInteraction (three-column orchestrator) ───────

interface ContractInteractionProps {
  contract: DeployedContract;
  chain: Chain;
}

export default function ContractInteraction({ contract, chain }: ContractInteractionProps) {
  const { read, write } = useMemo(() => categorizeAbiFunctions(contract.abi), [contract.abi]);

  // Pinned state — none pinned by default (user clicks to add)
  const allNames = useMemo(() => [...read, ...write].map((fn) => fn.name), [read, write]);
  const [pinnedSet, setPinnedSet] = useState<Set<string>>(() => new Set());

  // Reset pins when contract changes
  useEffect(() => {
    setPinnedSet(new Set());
  }, [allNames]);

  const togglePin = useCallback((name: string) => {
    setPinnedSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setPinnedSet(new Set(allNames)), [allNames]);
  const clearAll = useCallback(() => setPinnedSet(new Set()), []);

  const pinnedRead = useMemo(() => read.filter((fn) => pinnedSet.has(fn.name)), [read, pinnedSet]);
  const pinnedWrite = useMemo(() => write.filter((fn) => pinnedSet.has(fn.name)), [write, pinnedSet]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left sidebar — function nav */}
      <div className="w-[220px] shrink-0 border-r border-zinc-700/50 bg-zinc-900/50 hidden lg:flex flex-col">
        <FunctionNav
          readFns={read}
          writeFns={write}
          pinnedSet={pinnedSet}
          onToggle={togglePin}
          onSelectAll={selectAll}
          onClearAll={clearAll}
        />
      </div>

      {/* Center panel — function cards */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="px-8 py-5 space-y-6 max-w-2xl mx-auto">
          {/* Mobile toggle controls (shown on < lg) */}
          <div className="flex items-center justify-between lg:hidden">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              {pinnedSet.size} / {allNames.length} functions shown
            </span>
            <button
              onClick={pinnedSet.size === allNames.length ? clearAll : selectAll}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {pinnedSet.size === allNames.length ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              {pinnedSet.size === allNames.length ? 'Clear' : 'Show All'}
            </button>
          </div>

          {/* Read section */}
          {pinnedRead.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20">
                  <BookOpen className="w-3 h-3 text-blue-400" />
                  <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">
                    Read
                  </span>
                </div>
                <span className="text-[10px] text-zinc-600">{pinnedRead.length} functions</span>
              </div>
              <div className="space-y-3">
                {pinnedRead.map((fn) => (
                  <FunctionCard
                    key={fn.name}
                    fn={fn}
                    contract={contract}
                    chain={chain}
                    isWrite={false}
                    onUnpin={() => togglePin(fn.name)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Write section */}
          {pinnedWrite.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-500/10 border border-violet-500/20">
                  <Pencil className="w-3 h-3 text-violet-400" />
                  <span className="text-[11px] font-semibold text-violet-400 uppercase tracking-wider">
                    Write
                  </span>
                </div>
                <span className="text-[10px] text-zinc-600">{pinnedWrite.length} functions</span>
              </div>
              <div className="space-y-3">
                {pinnedWrite.map((fn) => (
                  <FunctionCard
                    key={fn.name}
                    fn={fn}
                    contract={contract}
                    chain={chain}
                    isWrite={true}
                    onUnpin={() => togglePin(fn.name)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {pinnedRead.length === 0 && pinnedWrite.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <BookOpen className="w-10 h-10 mb-4 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-400 mb-1">Select functions to interact</p>
              <p className="text-xs text-zinc-600 mb-4">
                Click functions in the sidebar to add them here
              </p>
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg border border-zinc-700 transition-colors"
              >
                Show all {allNames.length} functions
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar — contract overview */}
      <div className="w-[300px] shrink-0 border-l border-zinc-700/50 bg-zinc-900/50 hidden xl:flex flex-col">
        <ContractOverview contract={contract} chain={chain} readFns={read} />
      </div>
    </div>
  );
}
