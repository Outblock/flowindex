import { createFileRoute, Link } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Database, Layers } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { useState } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Nft } from '../../api/gen/find';
import { Pagination } from '../../components/Pagination';

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
      await ensureHeyApiConfigured();
      const res = await getFlowV1Nft({ query: { limit, offset } });
      const payload: any = res.data;
      return { collections: payload?.data || [], meta: payload?._meta || null, page };
    } catch (e) {
      console.error('Failed to load NFT collections', e);
      return { collections: [], meta: null, page };
    }
  },
})

function CollectionImage({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?')[0].toUpperCase();

  if (!src || failed) {
    return (
      <div className="aspect-square w-full bg-zinc-100 dark:bg-white/10 flex items-center justify-center">
        <span className="text-4xl font-bold font-mono text-zinc-400 dark:text-zinc-500 select-none">
          {letter}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className="aspect-square object-cover w-full"
      onError={() => setFailed(true)}
    />
  );
}

function NFTs() {
  const { collections, meta, page } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  const limit = 25;
  const offset = (page - 1) * limit;
  const totalCount = Number(meta?.count || 0);
  const hasNext = totalCount > 0 ? offset + limit < totalCount : collections.length === limit;

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
          <div className="p-3 bg-nothing-green/10">
            <Image className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">NFTs</h1>
            <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">NFT Collections on Flow</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 shadow-sm dark:shadow-none">
          <p className="text-xs font-mono text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Total Collections</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={Number(meta?.count || 0)} format={{ useGrouping: true }} />
          </p>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 shadow-sm dark:shadow-none">
          <p className="text-xs font-mono text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Indexed Height</p>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-zinc-400" />
            <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
              <NumberFlow value={Number(meta?.height || 0)} format={{ useGrouping: true }} />
            </p>
          </div>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 shadow-sm dark:shadow-none">
          <p className="text-xs font-mono text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Showing</p>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-zinc-400" />
            <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
              <NumberFlow value={collections.length} format={{ useGrouping: true }} />
              <span className="text-sm font-normal text-zinc-500 ml-2">of {totalCount.toLocaleString()}</span>
            </p>
          </div>
        </div>
      </motion.div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <AnimatePresence mode="popLayout">
            {collections.map((c: any, i: number) => {
              const id = String(c?.id || '');
              const displayName = c?.display_name || c?.name || c?.contract_name || id;
              const contractId = id;
              const count = Number(c?.number_of_tokens || 0);
              const squareImage = c?.square_image || '';

              return (
                <motion.div
                  layout
                  key={id || `col-${i}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <Link
                    to={`/nfts/${encodeURIComponent(id)}`}
                    className="block bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 transition-all overflow-hidden group"
                  >
                    <div className="overflow-hidden">
                      <CollectionImage name={displayName} src={squareImage} />
                    </div>
                    <div className="p-3 space-y-1.5">
                      <h3 className="font-mono font-bold text-sm text-zinc-900 dark:text-white truncate group-hover:text-nothing-green-dark dark:group-hover:text-nothing-green transition-colors">
                        {displayName}
                      </h3>
                      <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate" title={contractId}>
                        {contractId}
                      </p>
                      <div className="pt-1">
                        <span className="inline-block font-mono text-[10px] uppercase tracking-widest bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 rounded-sm">
                          {Number.isFinite(count) ? count.toLocaleString() : '0'} items
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
          <Pagination currentPage={page} onPageChange={setPage} hasNext={hasNext} />
        </div>
      </div>
    </div>
  );
}
