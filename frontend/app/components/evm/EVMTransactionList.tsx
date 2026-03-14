import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMAddressTransactions } from '@/api/evm';
import { formatRelativeTime } from '@/lib/time';
import { formatWei, truncateHash, txStatusLabel } from '@/lib/evmUtils';
import { AddressLink } from '@/components/AddressLink';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSTransaction, BSPageParams } from '@/types/blockscout';

interface EVMTransactionListProps {
  address: string;
}

export function EVMTransactionList({ address }: EVMTransactionListProps) {
  const [items, setItems] = useState<BSTransaction[]>([]);
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

    getEVMAddressTransactions(address)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNextPage(res.next_page_params);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load transactions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [address]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const res = await getEVMAddressTransactions(address, params);
      setItems((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch (e: any) {
      setError(e?.message || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [address]);

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Tx Hash</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Method</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Block</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Age</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">From</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">To</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Value</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800/50">
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} className="py-3 px-2">
                    <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
        <p className="text-sm">No transactions found for this address.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Tx Hash</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Method</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Block</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Age</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">From</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">To</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Value</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tx) => {
              const status = txStatusLabel(tx.status);
              const method = tx.decoded_input?.method_call?.split('(')[0] || tx.method || '';
              return (
                <tr key={tx.hash} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <td className="py-3 px-2">
                    <Link
                      to={`/txs/${tx.hash}` as any}
                      className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono"
                    >
                      {truncateHash(tx.hash)}
                    </Link>
                  </td>
                  <td className="py-3 px-2">
                    {method ? (
                      <span className="inline-block px-1.5 py-0.5 text-[10px] bg-zinc-100 dark:bg-zinc-800 rounded truncate max-w-[100px]" title={method}>
                        {method}
                      </span>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-zinc-600 dark:text-zinc-400">
                    <Link to={`/blocks/${tx.block_number}` as any} className="hover:underline">
                      {tx.block_number.toLocaleString()}
                    </Link>
                  </td>
                  <td className="py-3 px-2 text-zinc-500" title={tx.timestamp}>
                    {formatRelativeTime(tx.timestamp)}
                  </td>
                  <td className="py-3 px-2">
                    <AddressLink address={tx.from.hash} prefixLen={6} suffixLen={4} size={14} />
                  </td>
                  <td className="py-3 px-2">
                    {tx.to ? (
                      <AddressLink address={tx.to.hash} prefixLen={6} suffixLen={4} size={14} />
                    ) : (
                      <span className="text-zinc-400 italic">Contract Create</span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-right font-mono">
                    {formatWei(tx.value)} <span className="text-zinc-500">FLOW</span>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <span className={status.color}>{status.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LoadMorePagination
        nextPageParams={nextPage}
        isLoading={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
