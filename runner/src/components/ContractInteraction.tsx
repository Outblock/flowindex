import { useState, useCallback, useMemo } from 'react';
import { useWalletClient } from 'wagmi';
import { BookOpen, Pencil, ChevronDown, ChevronRight, Loader2, Copy, Check } from 'lucide-react';
import type { AbiFunction } from 'viem';
import type { DeployedContract, ContractCallResult } from '../flow/evmContract';
import { callContractRead, callContractWrite, categorizeAbiFunctions } from '../flow/evmContract';
import SolidityParamInput, { parseParamValue } from './SolidityParamInput';
import type { Chain } from 'viem/chains';

interface ContractInteractionProps {
  contract: DeployedContract;
  chain: Chain;
}

function formatResult(data: any): string {
  if (data === undefined || data === null) return 'null';
  if (typeof data === 'bigint') return data.toString();
  if (typeof data === 'object') return JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
  return String(data);
}

function ResultDisplay({ result, explorerBaseUrl }: { result: ContractCallResult; explorerBaseUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const text = result.success ? formatResult(result.data) : result.error || 'Unknown error';

  return (
    <div className={`text-xs font-mono p-2 rounded border ${
      result.success
        ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-300'
        : 'bg-red-900/20 border-red-700/50 text-red-400'
    }`}>
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
      {result.gasUsed && (
        <div className="text-zinc-600">gas: {result.gasUsed.toString()}</div>
      )}
    </div>
  );
}

function FunctionCard({
  fn,
  contract,
  chain,
  isWrite,
}: {
  fn: AbiFunction;
  contract: DeployedContract;
  chain: Chain;
  isWrite: boolean;
}) {
  const [expanded, setExpanded] = useState(fn.inputs.length === 0);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [ethValue, setEthValue] = useState('');
  const [result, setResult] = useState<ContractCallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: walletClient } = useWalletClient();
  const explorerBaseUrl = contract.chainId === 545
    ? 'https://evm-testnet.flowindex.io'
    : 'https://evm.flowindex.io';

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
        const value = fn.stateMutability === 'payable' && ethValue
          ? BigInt(ethValue)
          : undefined;
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

  return (
    <div className="border border-zinc-700 rounded bg-zinc-800/50">
      <button
        onClick={() => hasInputs ? setExpanded(!expanded) : handleCall()}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-700/30 transition-colors"
      >
        {hasInputs ? (
          expanded ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />
        ) : (
          isWrite
            ? <Pencil className="w-3 h-3 text-violet-400" />
            : <BookOpen className="w-3 h-3 text-blue-400" />
        )}
        <span className="text-xs font-mono text-zinc-200">{fn.name}</span>
        {!hasInputs && !isWrite && result?.success && (
          <span className="ml-auto text-xs font-mono text-emerald-400 truncate max-w-[200px]">
            → {formatResult(result.data)}
          </span>
        )}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500 ml-auto" />}
      </button>

      {expanded && hasInputs && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-700/50">
          <div className="pt-2 space-y-2">
            {fn.inputs.map((input, i) => {
              const key = input.name || `arg${i}`;
              return (
                <SolidityParamInput
                  key={key}
                  param={input}
                  value={paramValues[key] || ''}
                  onChange={(v) => setParamValues(prev => ({ ...prev, [key]: v }))}
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

      {!hasInputs && result && (
        <div className="px-3 pb-3 border-t border-zinc-700/50 pt-2">
          <ResultDisplay result={result} />
        </div>
      )}
    </div>
  );
}

export default function ContractInteraction({ contract, chain }: ContractInteractionProps) {
  const { read, write } = useMemo(() => categorizeAbiFunctions(contract.abi), [contract.abi]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-violet-400">{contract.name}</span>
        <span className="text-[10px] font-mono text-zinc-500 truncate">{contract.address}</span>
      </div>

      {read.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold mb-1.5 flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> Read ({read.length})
          </div>
          <div className="space-y-1">
            {read.map(fn => (
              <FunctionCard key={fn.name} fn={fn} contract={contract} chain={chain} isWrite={false} />
            ))}
          </div>
        </div>
      )}

      {write.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold mb-1.5 flex items-center gap-1">
            <Pencil className="w-3 h-3" /> Write ({write.length})
          </div>
          <div className="space-y-1">
            {write.map(fn => (
              <FunctionCard key={fn.name} fn={fn} contract={contract} chain={chain} isWrite={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
