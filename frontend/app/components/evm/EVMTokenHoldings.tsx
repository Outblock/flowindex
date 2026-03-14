import { useState, useEffect } from 'react';
import { getEVMAddressTokenBalances } from '@/api/evm';
import { formatWei } from '@/lib/evmUtils';
import type { BSTokenBalance } from '@/types/blockscout';

interface EVMTokenHoldingsProps {
  address: string;
}

export function EVMTokenHoldings({ address }: EVMTokenHoldingsProps) {
  const [items, setItems] = useState<BSTokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);

    getEVMAddressTokenBalances(address)
      .then((res) => {
        if (cancelled) return;
        setItems(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load token balances');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Token</th>
              <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Type</th>
              <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Balance</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800/50">
                {Array.from({ length: 3 }).map((_, j) => (
                  <td key={j} className="py-3 px-2">
                    <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
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
        <p className="text-sm">No token holdings found for this address.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Token</th>
            <th className="text-left py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Type</th>
            <th className="text-right py-3 px-2 text-[10px] uppercase tracking-wider text-zinc-500">Balance</th>
          </tr>
        </thead>
        <tbody>
          {items.map((holding, idx) => {
            const decimals = holding.token.decimals ? parseInt(holding.token.decimals, 10) : 18;
            return (
              <tr key={`${holding.token.address}-${idx}`} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                <td className="py-3 px-2">
                  <div className="flex items-center gap-2">
                    {holding.token.icon_url ? (
                      <img
                        src={holding.token.icon_url}
                        alt=""
                        className="w-5 h-5 rounded-full"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                    )}
                    <div>
                      <span className="font-medium">{holding.token.symbol || 'Unknown'}</span>
                      {holding.token.name && (
                        <span className="text-zinc-500 ml-1.5">{holding.token.name}</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="py-3 px-2">
                  <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 uppercase font-medium">
                    {holding.token.type}
                  </span>
                </td>
                <td className="py-3 px-2 text-right font-mono">
                  {formatWei(holding.value, decimals, 6)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
