import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../../../components/AddressLink';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, ArrowRightLeft, ExternalLink, Calendar, Hash, User, Shield } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured } from '../../../../api/heyapi';
import { getFlowV1NftByNftTypeItemById, getFlowV1NftByNftTypeItemByIdTransfer } from '../../../../api/gen/find';
import { Pagination } from '../../../../components/Pagination';
import { RouteErrorBoundary } from '../../../../components/RouteErrorBoundary';
import { PageHeader } from '../../../../components/ui/PageHeader';
import { GlassCard } from '../../../../components/ui/GlassCard';
import { getNFTThumbnail, normalizeAddress } from '../../../../components/account/accountUtils';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';

export const Route = createFileRoute('/nfts/$nftType/item/$id')({
  component: NFTItem,
  loader: async ({ params, location }) => {
    const nftType = params.nftType;
    const id = params.id;
    const sp = new URLSearchParams(location.search);
    const page = Number(sp.get('page') || '1') || 1;
    const limit = 25;
    const offset = (page - 1) * limit;
    try {
      await ensureHeyApiConfigured();
      const [itemRes, transfersRes] = await Promise.all([
        getFlowV1NftByNftTypeItemById({ path: { nft_type: nftType, id } }),
        getFlowV1NftByNftTypeItemByIdTransfer({ path: { nft_type: nftType, id }, query: { limit, offset } }),
      ]);
      const itemPayload: any = itemRes?.data;
      const transfersPayload: any = transfersRes?.data;
      const row = (itemPayload?.data && itemPayload.data[0]) || null;
      return {
        item: row,
        transfers: transfersPayload?.data || [],
        transfersMeta: transfersPayload?._meta || null,
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
  return (
    <RouteErrorBoundary title="NFT Item Page Error">
      <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 pt-8 pb-16">
          <NFTItemInner />
        </div>
      </div>
    </RouteErrorBoundary>
  );
}

function NFTItemInner() {
  const { item, transfers, transfersMeta, nftType, id, page } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  const owner = normalizeAddress(item?.current_owner || item?.owner || item?.address || '');
  const display = item?.display;
  const name = display?.name || `#${id}`;
  const description = display?.description;
  const thumbnail = getNFTThumbnail(item);

  const limit = 25;
  const offset = (page - 1) * limit;
  const total = Number(transfersMeta?.count || 0);
  const hasNext = total > 0 ? offset + limit < total : transfers.length === limit;

  const setPage = (newPage: number) => {
    navigate({ search: { page: newPage } });
  };

  const collectionName = nftType.split('.').pop() || nftType;

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`${collectionName} • #${id}`}
        backgroundImage={thumbnail}
      >
        <div className="flex gap-2">
          <Link
            to="/nfts/$nftType"
            params={{ nftType: String(nftType) }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md text-sm font-semibold text-white transition-colors"
          >
            <Package className="w-4 h-4" />
            View Collection
          </Link>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Image & Quick Stats */}
        <div className="lg:col-span-5 space-y-6">
          <GlassCard className="overflow-hidden p-0 bg-zinc-100 dark:bg-white/5 border-zinc-200 dark:border-white/10">
            <div className="aspect-square relative flex items-center justify-center p-8 bg-zinc-100 dark:bg-black/20">
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt={name}
                  className="w-full h-full object-contain rounded-lg shadow-2xl"
                />
              ) : (
                <Package className="w-32 h-32 text-zinc-300 dark:text-zinc-700 opacity-20" />
              )}
            </div>
          </GlassCard>

          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Collection</p>
            <Link
              to="/nfts/$nftType"
              params={{ nftType: String(nftType) }}
              className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline break-all"
            >
              {String(nftType)}
            </Link>
          </div>
          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Current Owner</p>
            <p className="text-sm font-mono text-zinc-900 dark:text-white break-all">
              {owner ? (
                <span className="flex items-center gap-1">
                  <AddressLink address={owner} prefixLen={20} suffixLen={0} />
                  <CopyButton
                    content={owner}
                    variant="ghost"
                    size="xs"
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  />
                </span>
              ) : (
                '—'
              )}
            </p>
          </div>
        </div>

        {/* Right Column: Metadata & History */}
        <div className="lg:col-span-7 space-y-8">
          {description && (
            <GlassCard>
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                Description
              </h3>
              <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {description}
              </p>
            </GlassCard>
          )}

          {/* Traits / Attributes if available */}
          {item?.traits && item?.traits.length > 0 && (
            <GlassCard>
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-2">
                <Hash className="w-4 h-4" />
                Traits
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {item.traits.map((trait: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/5 flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 truncate mb-1">
                      {trait.name || trait.display?.name}
                    </span>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {String(trait.value || trait.display?.value)}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Transfer History */}
          <GlassCard className="p-0 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4" />
                Transfer History
                <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-white/10 text-xs text-zinc-600 dark:text-zinc-400">
                  <NumberFlow value={Number.isFinite(total) ? total : transfers.length} />
                </span>
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-zinc-50/50 dark:bg-white/5">
                  <tr>
                    <th className="px-6 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">From</th>
                    <th className="px-6 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">To</th>
                    <th className="px-6 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Transaction</th>
                    <th className="px-6 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider text-right">Block</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  <AnimatePresence mode="popLayout">
                    {transfers.map((t: any) => {
                      const tx = String(t?.transaction_hash || '');
                      const from = normalizeAddress(t?.sender);
                      const to = normalizeAddress(t?.receiver);
                      const height = Number(t?.block_height || 0);

                      return (
                        <motion.tr
                          key={`${tx}-${from}-${to}-${height}`}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <AddressLink address={from} prefixLen={20} suffixLen={0} className="text-xs" />
                              <CopyButton
                                content={from}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <AddressLink address={to} prefixLen={20} suffixLen={0} className="text-xs" />
                              <CopyButton
                                content={to}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {tx ? (
                              <Link to="/tx/$txId" params={{ txId: normalizeAddress(tx) }} className="font-mono text-xs text-nothing-green-dark dark:text-nothing-green hover:underline">
                                {normalizeAddress(tx).slice(0, 18)}...
                              </Link>
                            ) : <span className="text-zinc-300 dark:text-zinc-700">—</span>}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="font-mono text-xs text-zinc-500">
                              {height.toLocaleString()}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                  {transfers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-zinc-500 italic text-sm">
                        No transfer history found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-zinc-200 dark:border-white/10 bg-zinc-50/30 dark:bg-white/5">
              <Pagination currentPage={page} onPageChange={setPage} hasNext={hasNext} />
            </div>
          </GlassCard>
        </div>
      </div>
    </>
  );
}
