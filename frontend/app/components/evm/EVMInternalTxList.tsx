import { useState, useEffect, useCallback } from 'react';
import { getEVMAddressInternalTxs, getEVMTransactionInternalTxs } from '@/api/evm';
import { formatWei, formatGas, internalTxTypeLabel } from '@/lib/evmUtils';
import { AddressLink } from '@/components/AddressLink';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSInternalTransaction, BSPageParams } from '@/types/blockscout';

interface EVMInternalTxListProps {
  address?: string;
  txHash?: string;
}

export function EVMInternalTxList({ address, txHash }: EVMInternalTxListProps) {
  const [items, setItems] = useState<BSInternalTransaction[]>([]);
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

    const fetchFn = address
      ? getEVMAddressInternalTxs(address)
      : txHash
        ? getEVMTransactionInternalTxs(txHash)
        : null;

    if (!fetchFn) {
      setLoading(false);
      setError('No address or transaction hash provided');
      return;
    }

    fetchFn
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNextPage(res.next_page_params);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load internal transactions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [address, txHash]);

  const loadMore = useCallback(async (params: BSPageParams) => {
    setLoadingMore(true);
    try {
      const res = address
        ? await getEVMAddressInternalTxs(address, params)
        : await getEVMTransactionInternalTxs(txHash!, params);
      setItems((prev) => [...prev, ...res.items]);
      setNextPage(res.next_page_params);
    } catch (e: any) {
      setError(e?.message || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [address, txHash]);

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Type</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">From</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">To</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Value</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Gas Used</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Result</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800/50">
                {Array.from({ length: 6 }).map((_, j) => (
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
        <p className="text-sm">No internal transactions found.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Type</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">From</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">To</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Value</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Gas Used</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Result</th>
            </tr>
          </thead>
          <tbody>
            {items.map((itx, idx) => (
              <tr key={`${itx.transaction_hash}-${itx.index}-${idx}`} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                <td className="py-3 px-2">
                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 rounded">
                    {internalTxTypeLabel(itx.type, itx.call_type)}
                  </span>
                </td>
                <td className="py-3 px-2">
                  <AddressLink address={itx.from.hash} prefixLen={6} suffixLen={4} size={14} />
                </td>
                <td className="py-3 px-2">
                  {itx.to ? (
                    <AddressLink address={itx.to.hash} prefixLen={6} suffixLen={4} size={14} />
                  ) : itx.created_contract ? (
                    <AddressLink address={itx.created_contract.hash} prefixLen={6} suffixLen={4} size={14} />
                  ) : (
                    <span className="text-zinc-400">-</span>
                  )}
                </td>
                <td className="py-3 px-2 text-right font-mono">
                  {formatWei(itx.value)} <span className="text-zinc-500">FLOW</span>
                </td>
                <td className="py-3 px-2 text-right font-mono text-zinc-500">
                  {formatGas(itx.gas_used)}
                </td>
                <td className="py-3 px-2 text-right">
                  {itx.success ? (
                    <span className="text-green-600 dark:text-green-400">Success</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400" title={itx.error || undefined}>
                      Failed
                    </span>
                  )}
                </td>
              </tr>
            ))}
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
