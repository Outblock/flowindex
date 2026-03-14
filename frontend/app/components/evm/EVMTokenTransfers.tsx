import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { getEVMAddressTokenTransfers, getEVMTransactionTokenTransfers } from '@/api/evm';
import { formatRelativeTime } from '@/lib/time';
import { formatWei, truncateHash } from '@/lib/evmUtils';
import { AddressLink } from '@/components/AddressLink';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSTokenTransfer, BSPageParams } from '@/types/blockscout';

interface EVMTokenTransfersProps {
  address?: string;
  txHash?: string;
}

export function EVMTokenTransfers({ address, txHash }: EVMTokenTransfersProps) {
  const [items, setItems] = useState<BSTokenTransfer[]>([]);
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
      ? getEVMAddressTokenTransfers(address)
      : txHash
        ? getEVMTransactionTokenTransfers(txHash)
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
        setError(e?.message || 'Failed to load token transfers');
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
        ? await getEVMAddressTokenTransfers(address, params)
        : await getEVMTransactionTokenTransfers(txHash!, params);
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
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Tx Hash</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Age</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">From</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">To</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Token</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Amount</th>
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
        <p className="text-sm">No token transfers found.</p>
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
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Age</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">From</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">To</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Token</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((transfer, idx) => {
              const decimals = transfer.token.decimals ? parseInt(transfer.token.decimals, 10) : 18;
              const amount = transfer.total?.value
                ? formatWei(transfer.total.value, decimals)
                : '-';
              return (
                <tr key={`${transfer.tx_hash}-${transfer.log_index}-${idx}`} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <td className="py-3 px-2">
                    <Link
                      to={`/txs/${transfer.tx_hash}` as any}
                      className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono"
                    >
                      {truncateHash(transfer.tx_hash)}
                    </Link>
                  </td>
                  <td className="py-3 px-2 text-zinc-500" title={transfer.timestamp}>
                    {formatRelativeTime(transfer.timestamp)}
                  </td>
                  <td className="py-3 px-2">
                    <AddressLink address={transfer.from.hash} prefixLen={6} suffixLen={4} size={14} />
                  </td>
                  <td className="py-3 px-2">
                    <AddressLink address={transfer.to.hash} prefixLen={6} suffixLen={4} size={14} />
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1.5">
                      {transfer.token.icon_url && (
                        <img
                          src={transfer.token.icon_url}
                          alt=""
                          className="w-4 h-4 rounded-full"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <span className="font-medium">{transfer.token.symbol || 'Unknown'}</span>
                      <span className="text-[9px] px-1 py-px bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 uppercase">
                        {transfer.token.type}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right font-mono">
                    {amount}
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
