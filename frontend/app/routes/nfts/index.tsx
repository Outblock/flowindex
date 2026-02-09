import { createFileRoute, Link } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Database } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../../api';
import { Pagination } from '../../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';

interface NFTsSearch {
  page?: number;
}

export const Route = createFileRoute('/nfts/')({
  component: NFTs,
  validateSearch: (search: Record<string, unknown>): NFTsSearch => ({
    page: Number(search.page) || 1,
  }),
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: async ({ deps: { page } }) => {
    const limit = 25;
    const offset = (page - 1) * limit;
    try {
      const res = await api.listFlowNFTCollections(limit, offset);
      return { collections: res?.data || [], meta: res?._meta || null, page };
    } catch (e) {
      console.error('Failed to load NFT collections', e);
      return { collections: [], meta: null, page };
    }
  },
})

function NFTs() {
  const { collections, meta, page } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const nowTick = useTimeTicker(20000);

  const limit = 25;
  const offset = (page - 1) * limit;
  const totalCount = Number(meta?.count || 0);
  const hasNext = totalCount > 0 ? offset + limit < totalCount : collections.length === limit;

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

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
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">NFTs</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">NFT Collections</p>
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
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Collections (Page)</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={collections.length} format={{ useGrouping: true }} />
          </p>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Indexed At Height</p>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-zinc-400" />
            <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
              <NumberFlow value={Number(meta?.height || 0)} format={{ useGrouping: true }} />
            </p>
          </div>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Count</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            `count` is currently page-sized for this endpoint.
          </p>
        </div>
      </motion.div>

      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Collection</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Tokens</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Updated</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {collections.map((c) => {
                  const id = String(c?.id || '');
                  const addr = normalizeHex(c?.address);
                  const count = Number(c?.number_of_tokens || 0);
                  const updatedAt = c?.updated_at || c?.timestamp || '';
                  const rel = updatedAt ? formatRelativeTime(updatedAt, nowTick) : '';
                  const abs = updatedAt ? formatAbsoluteTime(updatedAt) : '';

                  return (
                    <motion.tr
                      layout
                      key={id || `${addr}-${count}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          to={`/nfts/${encodeURIComponent(id)}`}
                          className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline"
                          title={id}
                        >
                          {id}
                        </Link>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {c?.display_name || c?.name || c?.contract_name || ''}
                        </div>
                      </td>
                      <td className="p-4">
                        {addr ? (
                          <Link to={`/accounts/${addr}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                            {addr}
                          </Link>
                        ) : (
                          <span className="text-zinc-500">N/A</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                          {Number.isFinite(count) ? count.toLocaleString() : '0'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-zinc-900 dark:text-white">{rel}</span>
                          <span className="text-xs text-zinc-500">{abs}</span>
                        </div>
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

