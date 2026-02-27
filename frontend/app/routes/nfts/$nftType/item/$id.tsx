import { createFileRoute, Link } from '@tanstack/react-router'
import { motion } from 'framer-motion';
import { Package, Info, Clock, ArrowLeft } from 'lucide-react';
import { ensureHeyApiConfigured } from '../../../../api/heyapi';
import { getFlowV1NftByNftTypeItemById, getFlowV1NftByNftTypeItemByIdTransfer } from '../../../../api/gen/find';
import { RouteErrorBoundary } from '../../../../components/RouteErrorBoundary';
import { GlassCard } from '../../../../components/ui/GlassCard';
import { normalizeAddress } from '../../../../components/account/accountUtils';
import { NFTImage, NFTMetadata, apiItemToCadenceFormat } from '../../../../components/NFTDetailContent';
import { NFTTimeline } from '../../../../components/NFTTimeline';
import { cn } from '../../../../lib/utils';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';

type ItemTab = 'detail' | 'history';

export const Route = createFileRoute('/nfts/$nftType/item/$id')({
  component: NFTItem,
  validateSearch: (search: Record<string, unknown>): { tab?: ItemTab } => {
    const tab = search.tab as string;
    const validTabs: ItemTab[] = ['detail', 'history'];
    return {
      tab: validTabs.includes(tab as ItemTab) ? (tab as ItemTab) : undefined,
    };
  },
  loader: async ({ params }) => {
    const nftType = params.nftType;
    const id = params.id;
    try {
      await ensureHeyApiConfigured();
      const [itemRes, transfersRes] = await Promise.all([
        getFlowV1NftByNftTypeItemById({ path: { nft_type: nftType, id } }),
        getFlowV1NftByNftTypeItemByIdTransfer({ path: { nft_type: nftType, id }, query: { limit: 100, offset: 0 } }),
      ]);
      const itemPayload: any = itemRes?.data;
      const transfersPayload: any = transfersRes?.data;
      const row = (itemPayload?.data && itemPayload.data[0]) || null;
      return {
        item: row,
        transfers: transfersPayload?.data || [],
        nftType,
        id,
      };
    } catch (e) {
      console.error('Failed to load NFT item', e);
      return { item: null, transfers: [], nftType, id };
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
  const { item, transfers, nftType } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const { tab: searchTab } = Route.useSearch();

  const activeTab: ItemTab = searchTab || 'detail';
  const setActiveTab = (tab: ItemTab) => {
    navigate({ search: (prev: any) => ({ ...prev, tab }), replace: true });
  };

  const owner = normalizeAddress(item?.current_owner || item?.owner || item?.address || '');
  const nft = apiItemToCadenceFormat(item);
  const collectionName = nftType.split('.').pop() || nftType;

  const tabs: { id: ItemTab; label: string; icon: typeof Info }[] = [
    { id: 'detail', label: 'Detail', icon: Info },
    { id: 'history', label: 'History', icon: Clock },
  ];

  return (
    <>
      {/* Back */}
      <div className="mb-6">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs uppercase tracking-widest">Back</span>
        </button>
      </div>

      {/* Header: Image + Name/ID */}
      <GlassCard className="overflow-hidden p-0 mb-0 bg-white dark:bg-zinc-900">
        <div className="flex flex-col md:flex-row w-full">
          {/* Image */}
          <NFTImage
            nft={nft}
            collectionId={nftType}
            className="w-full md:w-72 md:h-72 lg:w-96 lg:h-96"
          />

          {/* Name / ID / Collection */}
          <div className="flex-1 min-w-0 p-6 md:p-8 flex flex-col justify-center">
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white mb-3 break-words">
              {nft?.display?.name || `#${nft?.tokenId}`}
            </h1>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 px-2 py-1 text-xs font-mono">
                #{nft?.tokenId}
              </span>
              <Link
                to={`/nfts/${encodeURIComponent(nftType)}` as any}
                className="text-xs text-nothing-green-dark dark:text-nothing-green hover:underline"
              >
                {collectionName}
              </Link>
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-400 font-mono">
              <span className="break-all">{nftType}</span>
              <CopyButton
                content={nftType}
                variant="ghost"
                size="xs"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 flex-shrink-0"
              />
            </div>
            {owner && (
              <div className="mt-4 text-xs text-zinc-500">
                <span className="uppercase tracking-wider">Owner: </span>
                <Link to={`/accounts/${owner}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                  {owner}
                </Link>
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Tabs — scrolls with page, not sticky */}
      <div className="mt-6 space-y-6">
        <div>
          <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md shadow-lg border border-zinc-200 dark:border-white/10 p-1.5 inline-flex flex-wrap gap-1 max-w-full overflow-x-auto relative">
            {tabs.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "relative px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 whitespace-nowrap z-10",
                    isActive ? "text-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="itemPageTab"
                      className="absolute inset-0 bg-zinc-900 dark:bg-white -z-10 shadow-md"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-[400px]">
          {/* Detail Tab */}
          {activeTab === 'detail' && (
            <GlassCard>
              <NFTMetadata nft={nft} collectionName={collectionName} hideHeader />
            </GlassCard>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <GlassCard>
              <NFTTimeline
                transfers={transfers}
                currentOwner={owner || undefined}
              />
            </GlassCard>
          )}
        </div>
      </div>
    </>
  );
}
