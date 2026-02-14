import { createFileRoute, Link, useRouterState } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Users, ArrowRightLeft, ArrowLeft, Grid3X3, Search } from 'lucide-react';
import { EVMBridgeBadge } from '../../components/ui/EVMBridgeBadge';
import { SafeNumberFlow } from '../../components/SafeNumberFlow';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import {
  getFlowV1NftByNftType,
  getFlowV1NftByNftTypeHolding,
  getFlowV1NftTransfer,
  getFlowV1NftByNftTypeItem,
  getFlowV1NftSearch,
} from '../../api/gen/find';
import { Pagination } from '../../components/Pagination';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary';
import { PageHeader } from '../../components/ui/PageHeader';
import { GlassCard } from '../../components/ui/GlassCard';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { cn } from '../../lib/utils';
import { NFTDetailModal } from '../../components/NFTDetailModal';
import { apiItemToCadenceFormat } from '../../components/NFTDetailContent';

const VALID_TABS = ['nfts', 'owners', 'transfers'] as const;
type CollectionTab = (typeof VALID_TABS)[number];

export const Route = createFileRoute('/nfts/$nftType')({
  component: NFTCollectionDetail,
  validateSearch: (search: Record<string, unknown>): { tab?: CollectionTab; page?: number } => {
    const tab = search.tab as string;
    const page = Number(search.page) || undefined;
    return {
      tab: VALID_TABS.includes(tab as CollectionTab) ? (tab as CollectionTab) : undefined,
      page,
    };
  },
  loader: async ({ params }) => {
    const nftType = params.nftType;
    try {
      await ensureHeyApiConfigured();
      const [collectionRes, itemsRes] = await Promise.all([
        getFlowV1NftByNftType({ path: { nft_type: nftType } }),
        getFlowV1NftByNftTypeItem({ path: { nft_type: nftType }, query: { limit: 25, offset: 0 } }),
      ]);
      const collectionPayload: any = collectionRes?.data;
      const itemsPayload: any = itemsRes?.data;
      const row = (collectionPayload?.data && collectionPayload.data[0]) || null;
      return {
        collection: row,
        initialItems: itemsPayload?.data || [],
        initialItemsMeta: itemsPayload?._meta || null,
        nftType,
      };
    } catch (e) {
      console.error('Failed to load NFT collection', e);
      return { collection: null, initialItems: [], initialItemsMeta: null, nftType };
    }
  },
})

function NFTCollectionDetail() {
  return (
    <RouteErrorBoundary title="NFT Page Error">
      <NFTCollectionDetailInner />
    </RouteErrorBoundary>
  );
}

function normalizeHex(value: any) {
  if (!value) return '';
  const lower = String(value).toLowerCase();
  return lower.startsWith('0x') ? lower : `0x${lower}`;
}

function extractImageUrl(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const s = raw.replace(/^"|"$/g, '');
    return s.startsWith('http') ? s : null;
  }
  try {
    const obj = typeof raw === 'object' ? raw : JSON.parse(raw);
    const find = (o: any): string | null => {
      if (!o || typeof o !== 'object') return null;
      if (typeof o.url === 'string' && o.url.startsWith('http')) return o.url;
      if (typeof o.value === 'string' && o.value.startsWith('http')) return o.value;
      if (Array.isArray(o)) { for (const i of o) { const f = find(i); if (f) return f; } }
      if (o.value && typeof o.value === 'object') return find(o.value);
      if (o.fields && Array.isArray(o.fields)) { for (const f of o.fields) { const r = find(f); if (r) return r; } }
      return null;
    };
    return find(obj);
  } catch { return null; }
}

function NFTCollectionDetailInner() {
  const { collection, initialItems, initialItemsMeta, nftType } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const { tab: searchTab, page: searchPage } = Route.useSearch();

  const activeTab: CollectionTab = searchTab || 'nfts';
  const currentPage = searchPage || 1;

  const setActiveTab = (tab: CollectionTab) => {
    navigate({ search: { tab, page: 1 }, replace: true });
  };
  const setPage = (page: number) => {
    navigate({ search: { tab: activeTab, page }, replace: true });
  };

  const id = String(collection?.id || nftType);
  const addr = normalizeHex(collection?.address);
  const displayName = collection?.display_name || collection?.name || id;
  const tokenCount = Number(collection?.number_of_tokens || 0);
  const holderCount = Number(collection?.holder_count || collection?.owner_count || 0);
  const squareImage = extractImageUrl(collection?.square_image);
  const bannerImage = extractImageUrl(collection?.banner_image);
  const description = collection?.description || '';

  // --- NFT Items state ---
  const [items, setItems] = useState<any[]>(initialItems);
  const [itemsMeta, setItemsMeta] = useState<any>(initialItemsMeta);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedNft, setSelectedNft] = useState<any>(null);

  // --- Owners state (lazy) ---
  const [owners, setOwners] = useState<any[]>([]);
  const [ownersMeta, setOwnersMeta] = useState<any>(null);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const ownersLoaded = useRef(false);

  // --- Transfers state (lazy) ---
  const [transfers, setTransfers] = useState<any[]>([]);
  const [transfersMeta, setTransfersMeta] = useState<any>(null);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const transfersLoaded = useRef(false);

  const limit = 25;
  const offset = (currentPage - 1) * limit;

  // Load NFT items when tab=nfts and page changes
  useEffect(() => {
    if (activeTab !== 'nfts') return;
    if (searchActive) return; // search handles its own loading
    let cancelled = false;
    const load = async () => {
      setItemsLoading(true);
      try {
        await ensureHeyApiConfigured();
        const res = await getFlowV1NftByNftTypeItem({ path: { nft_type: nftType }, query: { limit, offset } });
        if (cancelled) return;
        const p: any = res?.data;
        setItems(p?.data || []);
        setItemsMeta(p?._meta || null);
      } catch (e) { console.error('Failed to load items', e); }
      finally { if (!cancelled) setItemsLoading(false); }
    };
    if (currentPage > 1 || initialItems.length === 0) load();
    return () => { cancelled = true; };
  }, [activeTab, nftType, currentPage]);

  // Load owners lazily
  useEffect(() => {
    if (activeTab !== 'owners') return;
    let cancelled = false;
    const load = async () => {
      setOwnersLoading(true);
      try {
        await ensureHeyApiConfigured();
        const res = await getFlowV1NftByNftTypeHolding({ path: { nft_type: nftType }, query: { limit, offset } });
        if (cancelled) return;
        const p: any = res?.data;
        setOwners(p?.data || []);
        setOwnersMeta(p?._meta || null);
        ownersLoaded.current = true;
      } catch (e) { console.error('Failed to load owners', e); }
      finally { if (!cancelled) setOwnersLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, nftType, currentPage]);

  // Load transfers lazily
  useEffect(() => {
    if (activeTab !== 'transfers') return;
    let cancelled = false;
    const load = async () => {
      setTransfersLoading(true);
      try {
        await ensureHeyApiConfigured();
        const res = await getFlowV1NftTransfer({ query: { limit, offset, nft_type: nftType } });
        if (cancelled) return;
        const p: any = res?.data;
        setTransfers(p?.data || []);
        setTransfersMeta(p?._meta || null);
        transfersLoaded.current = true;
      } catch (e) { console.error('Failed to load transfers', e); }
      finally { if (!cancelled) setTransfersLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, nftType, currentPage]);

  // Search handler
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchActive(false);
      // Reload page 1 items
      setItemsLoading(true);
      try {
        await ensureHeyApiConfigured();
        const res = await getFlowV1NftByNftTypeItem({ path: { nft_type: nftType }, query: { limit, offset: 0 } });
        const p: any = res?.data;
        setItems(p?.data || []);
        setItemsMeta(p?._meta || null);
      } catch (e) { console.error(e); }
      finally { setItemsLoading(false); }
      return;
    }
    setSearchActive(true);
    setItemsLoading(true);
    try {
      await ensureHeyApiConfigured();
      const res = await getFlowV1NftSearch({ query: { q, collection: nftType, limit, offset: 0 } });
      const p: any = res?.data;
      setItems(p?.data || []);
      setItemsMeta(p?._meta || null);
    } catch (e) { console.error('Search failed', e); }
    finally { setItemsLoading(false); }
  };

  const isLoading = activeTab === 'nfts' ? itemsLoading : activeTab === 'owners' ? ownersLoading : transfersLoading;

  const hasNext = (() => {
    if (activeTab === 'nfts') return itemsMeta?.has_more === true;
    if (activeTab === 'owners') return ownersMeta?.has_more === true;
    return transfersMeta?.has_more === true;
  })();

  const tabs = [
    { id: 'nfts' as const, label: 'NFTs', icon: Grid3X3 },
    { id: 'owners' as const, label: 'Owners', icon: Users },
    { id: 'transfers' as const, label: 'Recent Transfers', icon: ArrowRightLeft },
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono transition-colors duration-300 selection:bg-nothing-green selection:text-black">
      <div className="max-w-7xl mx-auto px-4 pt-12 pb-24">

        <Link to="/nfts" className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-6 group">
          <ArrowLeft className="h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs uppercase tracking-widest">All Collections</span>
        </Link>

        {/* Header with banner + icon */}
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              {displayName}
              {collection?.evm_address && <EVMBridgeBadge evmAddress={String(collection.evm_address)} />}
            </span>
          }
          subtitle={
            <div className="flex items-center gap-1">
              {id}
              <CopyButton
                content={id}
                variant="ghost"
                size="xs"
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              />
            </div>
          }
          backgroundImage={bannerImage || undefined}
        >
          {squareImage && (
            <div className="w-20 h-20 md:w-24 md:h-24 border-4 border-white dark:border-zinc-800 shadow-xl overflow-hidden flex-shrink-0 bg-zinc-100 dark:bg-zinc-800">
              <img src={squareImage} alt={displayName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}
        </PageHeader>

        {/* Description */}
        {description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6 max-w-3xl line-clamp-3">{description}</p>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <GlassCard className="p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Image className="h-12 w-12" />
            </div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Total Items</p>
            <p className="text-2xl font-bold">
              <SafeNumberFlow value={Number.isFinite(tokenCount) ? tokenCount : 0} format={{ useGrouping: true }} />
            </p>
          </GlassCard>

          <GlassCard className="p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Users className="h-12 w-12" />
            </div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Holders</p>
            <p className="text-2xl font-bold">
              <SafeNumberFlow value={Number.isFinite(holderCount) ? holderCount : 0} format={{ useGrouping: true }} />
            </p>
          </GlassCard>

          <GlassCard className="p-6 relative overflow-hidden group">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Contract</p>
            <p className="text-sm font-mono text-zinc-900 dark:text-white break-all">
              {addr ? (
                <AddressLink address={addr} prefixLen={20} suffixLen={0} />
              ) : 'N/A'}
            </p>
          </GlassCard>
        </div>

        {/* Tabs */}
        <div className="space-y-6">
          <div className="sticky top-4 z-50">
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
                        layoutId="collectionTab"
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

          <div className="min-h-[500px]">
            {/* NFTs Tab */}
            {activeTab === 'nfts' && (
              <div>
                {/* Search bar */}
                <div className="flex gap-2 mb-6">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="Search NFTs by name or description..."
                      className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 text-sm font-mono text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-nothing-green/30"
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    className="px-5 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs uppercase tracking-widest font-bold hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
                  >
                    Search
                  </button>
                </div>

                {/* Loading overlay */}
                {itemsLoading && (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                  </div>
                )}

                {/* NFT items grid */}
                {!itemsLoading && items.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <AnimatePresence mode="popLayout">
                      {items.map((item: any) => {
                        const nftId = item.nft_id || item.id || '';
                        const name = item.name || `#${nftId}`;
                        const thumb = extractImageUrl(item.thumbnail);
                        return (
                          <motion.div
                            key={nftId}
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="group cursor-pointer"
                            onClick={() => setSelectedNft(apiItemToCadenceFormat(item))}
                          >
                              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 overflow-hidden hover:border-nothing-green dark:hover:border-nothing-green transition-colors">
                                <div className="aspect-square bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                                  {thumb ? (
                                    <img
                                      src={thumb}
                                      alt={name}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                                    />
                                  ) : null}
                                  <div className={`flex items-center justify-center w-full h-full text-2xl font-bold text-zinc-300 dark:text-zinc-600 ${thumb ? 'hidden' : ''}`}>
                                    {(name).charAt(0).toUpperCase()}
                                  </div>
                                </div>
                                <div className="p-3">
                                  <p className="text-xs font-medium text-zinc-900 dark:text-white truncate">{name}</p>
                                  <p className="text-[10px] text-zinc-400 font-mono">#{nftId}</p>
                                </div>
                              </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}

                {!itemsLoading && items.length === 0 && (
                  <div className="text-center text-zinc-500 italic py-16">
                    {searchActive ? 'No NFTs match your search.' : 'No NFT items found.'}
                  </div>
                )}

                {!searchActive && (
                  <div className="mt-6">
                    <Pagination currentPage={currentPage} onPageChange={setPage} hasNext={hasNext} />
                  </div>
                )}
              </div>
            )}

            {/* Owners Tab */}
            {activeTab === 'owners' && (
              <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 overflow-hidden">
                {ownersLoading && (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                  </div>
                )}
                {!ownersLoading && owners.length > 0 && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                            <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                            <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          <AnimatePresence mode="popLayout">
                            {owners.map((o: any) => {
                              const a = normalizeHex(o?.owner || o?.address);
                              const count = Number(o?.count || 0);
                              return (
                                <motion.tr
                                  layout
                                  key={`${a}-${count}`}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                >
                                  <td className="p-4">
                                    <AddressLink address={a} prefixLen={20} suffixLen={0} />
                                  </td>
                                  <td className="p-4 text-right">
                                    <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                                      {Number.isFinite(count) ? count : 0}
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
                      <Pagination currentPage={currentPage} onPageChange={setPage} hasNext={hasNext} />
                    </div>
                  </>
                )}
                {!ownersLoading && owners.length === 0 && (
                  <div className="text-center text-zinc-500 italic py-16">No owners found.</div>
                )}
              </div>
            )}

            {/* Transfers Tab */}
            {activeTab === 'transfers' && (
              <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 overflow-hidden">
                {transfersLoading && (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                  </div>
                )}
                {!transfersLoading && transfers.length > 0 && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                            <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Item</th>
                            <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">From</th>
                            <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">To</th>
                            <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Tx</th>
                          </tr>
                        </thead>
                        <tbody>
                          <AnimatePresence mode="popLayout">
                            {transfers.map((t: any) => {
                              const tx = String(t?.transaction_hash || '');
                              const from = normalizeHex(t?.sender);
                              const to = normalizeHex(t?.receiver);
                              const nftId = String(t?.nft_id || '');
                              return (
                                <motion.tr
                                  layout
                                  key={`${tx}-${nftId}-${from}-${to}`}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                >
                                  <td className="p-4">
                                    {nftId ? (
                                      <Link
                                        to={`/nfts/${encodeURIComponent(id)}/item/${encodeURIComponent(nftId)}`}
                                        className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                                      >
                                        #{nftId}
                                      </Link>
                                    ) : (
                                      <span className="text-zinc-500">—</span>
                                    )}
                                  </td>
                                  <td className="p-4">
                                    {from ? (
                                      <AddressLink address={from} />
                                    ) : <span className="text-zinc-500">—</span>}
                                  </td>
                                  <td className="p-4">
                                    {to ? (
                                      <AddressLink address={to} />
                                    ) : <span className="text-zinc-500">—</span>}
                                  </td>
                                  <td className="p-4">
                                    {tx ? (
                                      <Link to={`/tx/${normalizeHex(tx)}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                        {normalizeHex(tx).slice(0, 18)}...
                                      </Link>
                                    ) : <span className="text-zinc-500">—</span>}
                                  </td>
                                </motion.tr>
                              );
                            })}
                          </AnimatePresence>
                        </tbody>
                      </table>
                    </div>
                    <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                      <Pagination currentPage={currentPage} onPageChange={setPage} hasNext={hasNext} />
                    </div>
                  </>
                )}
                {!transfersLoading && transfers.length === 0 && (
                  <div className="text-center text-zinc-500 italic py-16">No transfers found.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* NFT Detail Modal */}
      {selectedNft && (
        <NFTDetailModal
          nft={selectedNft}
          collectionId={id}
          collectionName={displayName}
          onClose={() => setSelectedNft(null)}
        />
      )}
    </div>
  );
}
