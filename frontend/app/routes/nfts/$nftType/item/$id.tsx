import { createFileRoute, Link } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion';
import { Image, ArrowRightLeft } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../../../../api';
import { Pagination } from '../../../../components/Pagination';

interface ItemSearch {
  page?: number;
}

export const Route = createFileRoute('/nfts/$nftType/item/$id')({
  component: NFTItem,
  validateSearch: (search: Record<string, unknown>): ItemSearch => ({
    page: Number(search.page) || 1,
  }),
  loaderDeps: ({ params: { nftType, id }, search: { page } }) => ({ nftType, id, page }),
  loader: async ({ deps: { nftType, id, page } }) => {
    const limit = 25;
    const offset = (page - 1) * limit;
    try {
      const [itemRes, transfersRes] = await Promise.all([
        api.getFlowNFTItem(nftType, id),
        api.listFlowNFTItemTransfers(nftType, id, limit, offset),
      ]);
      const row = (itemRes?.data && itemRes.data[0]) || null;
      return {
        item: row,
        transfers: transfersRes?.data || [],
        transfersMeta: transfersRes?._meta || null,
        nftType,
        id,
        page,
      };
    } catch (e) {
      console.error('Failed to load NFT item', e);
      return { item: null, transfers: [], transfersMeta: null, nftType, id, page };
    }
  },
})

function NFTItem() {
  const { item, transfers, transfersMeta, nftType, id, page } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const owner = normalizeHex(item?.current_owner || item?.owner || item?.address || '');

  const limit = 25;
  const offset = (page - 1) * limit;
  const total = Number(transfersMeta?.count || 0);
  const hasNext = total > 0 ? offset + limit < total : transfers.length === limit;

  const setPage = (newPage: number) => {
    navigate({ search: { page: newPage } });
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10 rounded-lg">
            <Image className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">
              NFT Item
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono break-all">
              {String(nftType)} #{String(id)}
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Collection</p>
          <Link
            to={`/nfts/${encodeURIComponent(String(nftType))}`}
            className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline break-all"
          >
            {String(nftType)}
          </Link>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Current Owner</p>
          <p className="text-sm font-mono text-zinc-900 dark:text-white break-all">
            {owner ? (
              <Link to={`/accounts/${owner}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline">
                {owner}
              </Link>
            ) : (
              '—'
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Transfers</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={Number.isFinite(total) ? total : transfers.length} format={{ useGrouping: true }} />
          </p>
        </div>
      </motion.div>

      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
        <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-zinc-500" />
          <span className="text-xs uppercase tracking-widest font-semibold text-zinc-600 dark:text-zinc-300">Transfer History</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">From</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">To</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Tx</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Height</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {transfers.map((t) => {
                  const tx = String(t?.transaction_hash || '');
                  const from = normalizeHex(t?.sender);
                  const to = normalizeHex(t?.receiver);
                  const height = Number(t?.block_height || 0);
                  return (
                    <motion.tr
                      layout
                      key={`${tx}-${from}-${to}-${height}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4">
                        {from ? (
                          <Link to={`/accounts/${from}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:underline">
                            {from.slice(0, 14)}...
                          </Link>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        {to ? (
                          <Link to={`/accounts/${to}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:underline">
                            {to.slice(0, 14)}...
                          </Link>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        {tx ? (
                          <Link to={`/transactions/${normalizeHex(tx)}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                            {normalizeHex(tx).slice(0, 18)}...
                          </Link>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                          {Number.isFinite(height) ? height.toLocaleString() : '0'}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-zinc-200 dark:border-white/5">
          <Pagination currentPage={page} onPageChange={setPage} hasNext={hasNext} />
        </div>
      </div>
    </div>
  );
}

