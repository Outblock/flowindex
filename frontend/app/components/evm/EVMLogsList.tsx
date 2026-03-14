import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMTransactionLogs } from '@/api/evm';
import { truncateHash } from '@/lib/evmUtils';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSLog, BSPageParams } from '@/types/blockscout';

interface EVMLogsListProps {
  txHash: string;
}

export function EVMLogsList({ txHash }: EVMLogsListProps) {
  const [items, setItems] = useState<BSLog[]>([]);
  const [nextPage, setNextPage] = useState<BSPageParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setNextPage(null);

    getEVMTransactionLogs(txHash)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNextPage(res.next_page_params);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load logs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [txHash]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const res = await getEVMTransactionLogs(txHash, params);
      setItems((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch (e: any) {
      setError(e?.message || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [txHash]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="h-5 w-8 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-5 w-40 bg-zinc-200 dark:bg-zinc-800 rounded" />
            </div>
            <div className="h-4 w-full bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-sm">No event logs found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {items.map((log) => (
        <div key={`${log.tx_hash}-${log.index}`} className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          {/* Header: log index + address */}
          <div className="flex items-center gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-[10px] font-mono font-bold text-zinc-500 bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
              {log.index}
            </span>
            <Link
              to="/account/$address"
              params={{ address: log.address.hash }}
              className="text-xs font-mono text-green-700 dark:text-green-400 hover:underline"
            >
              {log.address.name || truncateHash(log.address.hash, 10, 8)}
            </Link>
            {log.address.is_contract && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
                Contract
              </span>
            )}
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* Decoded log */}
            {log.decoded && (
              <div className="rounded-md border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-3 space-y-2">
                <div className="text-xs font-mono font-medium text-green-800 dark:text-green-300">
                  {log.decoded.method_call}
                </div>
                {log.decoded.parameters.length > 0 && (
                  <div className="space-y-1">
                    {log.decoded.parameters.map((param, idx) => (
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
            )}

            {/* Topics */}
            {log.topics.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Topics</div>
                {log.topics.map((topic, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[11px]">
                    <span className="text-zinc-400 font-mono shrink-0">[{idx}]</span>
                    <span className="font-mono text-zinc-700 dark:text-zinc-300 break-all">{topic}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Data */}
            {log.data && log.data !== '0x' && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Data</div>
                <div className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 break-all bg-zinc-50 dark:bg-zinc-900/50 rounded p-2 border border-zinc-200 dark:border-zinc-800">
                  {log.data}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

      <LoadMorePagination
        nextPageParams={nextPage}
        isLoading={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
