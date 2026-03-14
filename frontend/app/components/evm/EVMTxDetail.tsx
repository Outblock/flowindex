import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, XCircle, Box, Clock, Hash, ArrowRight } from 'lucide-react';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/time';
import { formatWei, formatGas, txStatusLabel } from '@/lib/evmUtils';
import { AddressLink } from '@/components/AddressLink';
import { EVMInternalTxList } from '@/components/evm/EVMInternalTxList';
import { EVMLogsList } from '@/components/evm/EVMLogsList';
import { EVMTokenTransfers } from '@/components/evm/EVMTokenTransfers';
import type { BSTransaction } from '@/types/blockscout';

type TabId = 'internal' | 'logs' | 'transfers';

const TABS: { id: TabId; label: string }[] = [
  { id: 'internal', label: 'Internal Transactions' },
  { id: 'logs', label: 'Logs' },
  { id: 'transfers', label: 'Token Transfers' },
];

function txTypeLabel(type: number): string {
  if (type === 2) return 'EIP-1559';
  if (type === 1) return 'EIP-2930';
  return 'Legacy';
}

function DetailRow({ label, children }: { label: string; children: import('react').ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0 py-3 border-b border-zinc-100 dark:border-zinc-800/50 last:border-b-0">
      <div className="sm:w-44 shrink-0 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <div className="flex-1 min-w-0 text-xs text-zinc-900 dark:text-zinc-100">
        {children}
      </div>
    </div>
  );
}

export function EVMTxDetail({ tx }: { tx: BSTransaction }) {
  const [activeTab, setActiveTab] = useState<TabId>('internal');
  const status = txStatusLabel(tx.status);

  const gasPercent = tx.gas_limit && tx.gas_limit !== '0'
    ? ((Number(tx.gas_used) / Number(tx.gas_limit)) * 100).toFixed(1)
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-green-100 dark:bg-green-500/10">
          <Hash className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">EVM Transaction</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-mono text-zinc-500 break-all">{tx.hash}</span>
            <CopyButton content={tx.hash} />
          </div>
        </div>
      </div>

      {/* Overview Card */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Overview</h2>
        </div>

        <div className="px-4">
          {/* Status */}
          <DetailRow label="Status">
            <div className="flex items-center gap-1.5">
              {tx.status === 'ok' ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              )}
              <span className={`font-medium ${status.color}`}>{status.label}</span>
            </div>
          </DetailRow>

          {/* Block */}
          <DetailRow label="Block">
            <div className="flex items-center gap-1.5">
              <Box className="h-3.5 w-3.5 text-zinc-400" />
              <Link
                to={`/blocks/${tx.block_number}` as any}
                className="text-green-700 dark:text-green-400 hover:underline font-mono"
              >
                {tx.block_number.toLocaleString()}
              </Link>
              {tx.confirmations > 0 && (
                <span className="text-[10px] text-zinc-500 ml-1">
                  ({tx.confirmations.toLocaleString()} confirmations)
                </span>
              )}
            </div>
          </DetailRow>

          {/* Timestamp */}
          <DetailRow label="Timestamp">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-zinc-400" />
              <span>{formatAbsoluteTime(tx.timestamp)}</span>
              <span className="text-zinc-500 ml-1">({formatRelativeTime(tx.timestamp)})</span>
            </div>
          </DetailRow>

          {/* Type */}
          <DetailRow label="Transaction Type">
            <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 rounded">
              {txTypeLabel(tx.type)}
            </span>
          </DetailRow>

          {/* From → To */}
          <DetailRow label="From">
            <div className="flex items-center gap-2 flex-wrap">
              <AddressLink address={tx.from.hash} prefixLen={10} suffixLen={8} size={14} />
              <CopyButton content={tx.from.hash} />
              {tx.to && (
                <>
                  <ArrowRight className="h-3.5 w-3.5 text-zinc-400" />
                  <AddressLink address={tx.to.hash} prefixLen={10} suffixLen={8} size={14} />
                  <CopyButton content={tx.to.hash} />
                </>
              )}
              {!tx.to && (
                <span className="text-zinc-500 italic text-[10px] ml-1">Contract Creation</span>
              )}
            </div>
          </DetailRow>

          {/* Value */}
          <DetailRow label="Value">
            <span className="font-mono font-medium">{formatWei(tx.value)} FLOW</span>
          </DetailRow>

          {/* Gas */}
          <DetailRow label="Gas">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono">{formatGas(tx.gas_used)}</span>
              <span className="text-zinc-500">/</span>
              <span className="font-mono text-zinc-500">{formatGas(tx.gas_limit)}</span>
              {gasPercent && (
                <span className="text-[10px] text-zinc-500">({gasPercent}%)</span>
              )}
            </div>
          </DetailRow>

          {/* Gas Price */}
          <DetailRow label="Gas Price">
            <span className="font-mono">{formatWei(tx.gas_price, 9, 4)} Gwei</span>
          </DetailRow>

          {/* Fee */}
          <DetailRow label="Transaction Fee">
            <span className="font-mono">{formatWei(tx.fee.value)} FLOW</span>
          </DetailRow>

          {/* Nonce */}
          <DetailRow label="Nonce">
            <span className="font-mono">{tx.nonce}</span>
          </DetailRow>

          {/* Decoded Input */}
          {tx.decoded_input && (
            <DetailRow label="Input Data">
              <div className="rounded-md border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-3 space-y-2">
                <div className="text-xs font-mono font-medium text-green-800 dark:text-green-300">
                  {tx.decoded_input.method_call}
                </div>
                {tx.decoded_input.parameters.length > 0 && (
                  <div className="space-y-1">
                    {tx.decoded_input.parameters.map((param, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px]">
                        <span className="text-green-700 dark:text-green-400 font-medium shrink-0">
                          {param.name}
                        </span>
                        <span className="text-zinc-500 shrink-0">
                          ({param.type})
                        </span>
                        <span className="font-mono text-zinc-800 dark:text-zinc-200 break-all">
                          {param.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DetailRow>
          )}

          {/* Raw Input (when no decoded) */}
          {!tx.decoded_input && tx.raw_input && tx.raw_input !== '0x' && (
            <DetailRow label="Raw Input">
              <div className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 break-all bg-zinc-50 dark:bg-zinc-900/50 rounded p-2 border border-zinc-200 dark:border-zinc-800 max-h-40 overflow-y-auto">
                {tx.raw_input}
              </div>
            </DetailRow>
          )}

          {/* Revert Reason */}
          {tx.revert_reason && (
            <DetailRow label="Revert Reason">
              <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3">
                <div className="text-xs font-mono text-red-800 dark:text-red-300 break-all">
                  {tx.revert_reason}
                </div>
              </div>
            </DetailRow>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-xs font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
              )}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'internal' && <EVMInternalTxList txHash={tx.hash} />}
          {activeTab === 'logs' && <EVMLogsList txHash={tx.hash} />}
          {activeTab === 'transfers' && <EVMTokenTransfers txHash={tx.hash} />}
        </div>
      </div>
    </div>
  );
}
