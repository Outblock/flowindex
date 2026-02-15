import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Database, Layers, LayoutGrid, LayoutList } from 'lucide-react';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';
import { EVMBridgeBadge } from '../../components/ui/EVMBridgeBadge';
import NumberFlow from '@number-flow/react';
import { useState, useRef } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Nft } from '../../api/gen/find';
import { Pagination } from '../../components/Pagination';
import { getCollectionPreviewVideo } from '../../components/account/accountUtils';

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

function CollectionImage({ name, src, videoUrl }: { name: string; src?: string; videoUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const letter = (name || '?')[0].toUpperCase();

  const handleMouseEnter = () => {
    setHovered(true);
    videoRef.current?.play().catch(() => {});
  };
  const handleMouseLeave = () => {
    setHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <div
      className="aspect-square w-full bg-zinc-100 dark:bg-white/10 relative overflow-hidden"
      onMouseEnter={videoUrl ? handleMouseEnter : undefined}
      onMouseLeave={videoUrl ? handleMouseLeave : undefined}
    >
      {(!src || failed) ? (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-4xl font-bold font-mono text-zinc-400 dark:text-zinc-500 select-none">
            {letter}
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={name}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${hovered && videoUrl ? 'opacity-0' : 'opacity-100'}`}
          onError={() => setFailed(true)}
        />
      )}
      {videoUrl && (
        <video
          ref={videoRef}
          src={hovered ? videoUrl : undefined}
          muted
          loop
          playsInline
          preload="none"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${hovered ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}

function CollectionLogo({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?')[0].toUpperCase();

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        width={32}
        height={32}
        className="w-8 h-8 object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-white/10 font-mono text-sm font-bold text-zinc-500 dark:text-zinc-400">
      {letter}
    </div>
  );
}

function NFTs() {
  const { collections, meta, page } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const limit = 25;
  const offset = (page - 1) * limit;
  const totalCount = Number(meta?.count || 0);
  const hasNext = totalCount > 0 ? offset + limit < totalCount : collections.length === limit;

  const normalizeHex = (value: any) => {
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
          <div className="p-3 bg-nothing-green/10">
            <Image className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">NFTs</h1>
            <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">NFT Collections on Flow</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-white/10 p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            <LayoutList className="w-4 h-4" />
          </button>
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
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <AnimatePresence mode="popLayout">
              {collections.map((c: any, i: number) => {
                const id = String(c?.id || '');
                const displayName = c?.display_name || c?.name || c?.contract_name || id;
                const contractId = id;
                const count = Number(c?.number_of_tokens || 0);
                const squareImage = c?.square_image || '';
                const evmAddress = String(c?.evm_address || '');
                const isVerified = Boolean(c?.is_verified);
                const videoUrl = getCollectionPreviewVideo(id);

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
                        <CollectionImage name={displayName} src={squareImage} videoUrl={videoUrl} />
                      </div>
                      <div className="p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-mono font-bold text-sm text-zinc-900 dark:text-white truncate group-hover:text-nothing-green-dark dark:group-hover:text-nothing-green transition-colors">
                            {displayName}
                          </h3>
                          {isVerified && <VerifiedBadge size={14} />}
                          {evmAddress && <EVMBridgeBadge evmAddress={evmAddress} />}
                        </div>
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
        ) : (
          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 overflow-hidden shadow-sm dark:shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Collection</th>
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Address</th>
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">Items</th>
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">Holders</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {collections.map((c: any, i: number) => {
                      const id = String(c?.id || '');
                      const displayName = c?.display_name || c?.name || c?.contract_name || id;
                      const addr = normalizeHex(c?.address);
                      const count = Number(c?.number_of_tokens || 0);
                      const holderCount = Number(c?.holder_count || 0);
                      const squareImage = c?.square_image || '';
                      const evmAddress = String(c?.evm_address || '');
                      const isVerified = Boolean(c?.is_verified);

                      return (
                        <motion.tr
                          layout
                          key={id || `col-${i}`}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <CollectionLogo name={displayName} src={squareImage} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    to={`/nfts/${encodeURIComponent(id)}`}
                                    className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline truncate"
                                    title={id}
                                  >
                                    {displayName}
                                  </Link>
                                  {isVerified && <VerifiedBadge size={14} />}
                                  {evmAddress && <EVMBridgeBadge evmAddress={evmAddress} />}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate" title={id}>
                                  {c?.contract_name || id}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            {addr ? (
                              <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                            ) : (
                              <span className="text-zinc-500 font-mono text-sm">N/A</span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <span className="font-mono text-sm text-zinc-900 dark:text-white">
                              {count.toLocaleString()}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <span className="font-mono text-sm text-zinc-900 dark:text-white">
                              {holderCount.toLocaleString()}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
          <Pagination currentPage={page} onPageChange={setPage} hasNext={hasNext} />
        </div>
      </div>
    </div>
  );
}
