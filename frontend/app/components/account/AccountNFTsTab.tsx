import { useState, useEffect } from 'react';
import { Package, Image as ImageIcon, ExternalLink, Grid, List as ListIcon } from 'lucide-react';
import type { NFTCollection } from '../../../cadence/cadence.gen';
import { normalizeAddress, getNFTThumbnail, backfillNFTData, toBackfillItem } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { cn } from '../../lib/utils';
import { ImageWithFallback } from '../ui/ImageWithFallback';
import { NFTDetailModal } from '../NFTDetailModal';

const NFT_PAGE_SIZE = 30;

interface Props {
    address: string;
}

interface CollectionState {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nfts: any[];
    loading: boolean;
    error: string | null;
    page: number;
    hasLoaded: boolean;
}

export function AccountNFTsTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [collections, setCollections] = useState<NFTCollection[]>([]);
    const [loadingCollections, setLoadingCollections] = useState(false);
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
    const [collectionStates, setCollectionStates] = useState<Record<string, CollectionState>>({});
    const [layout, setLayout] = useState<'grid' | 'list'>('grid');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [selectedNft, setSelectedNft] = useState<any | null>(null);

    // Load Collections
    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoadingCollections(true);
            try {
                const { cadenceService } = await import('../../fclConfig');
                const res = await cadenceService.getNftCollections(normalizedAddress);
                if (active) {
                    const sorted = (res || []).sort((a, b) => (b.ids?.length || 0) - (a.ids?.length || 0));
                    setCollections(sorted);
                    // Select first collection by default if available
                    if (sorted.length > 0 && !selectedCollectionId) {
                        setSelectedCollectionId(sorted[0].id);
                    }
                    // Fire-and-forget: backfill ownership + public paths to backend.
                    backfillNFTData(normalizedAddress, sorted.map(col => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const pp = col.collectionData?.publicPath as any;
                        const publicPath = typeof pp === 'string' ? pp : pp?.identifier || '';
                        return {
                            id: col.id,
                            public_path: publicPath,
                            nft_ids: (col.ids || []).map(String),
                        };
                    }));
                }
            } catch (err) {
                console.error('Failed to load NFT collections', err);
            } finally {
                if (active) setLoadingCollections(false);
            }
        };
        load();
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [normalizedAddress]);

    // Load NFTs for selected collection
    useEffect(() => {
        if (!selectedCollectionId) return;

        const currentState = collectionStates[selectedCollectionId];
        // Prevent infinite loop if already loading, or skip if already loaded
        if (currentState?.loading || currentState?.hasLoaded) return;

        const loadNFTs = async () => {
            setCollectionStates(prev => ({
                ...prev,
                [selectedCollectionId]: {
                    nfts: prev[selectedCollectionId]?.nfts || [],
                    loading: true,
                    error: null,
                    page: prev[selectedCollectionId]?.page || 0,
                    hasLoaded: prev[selectedCollectionId]?.hasLoaded || false
                }
            }));

            try {
                const { cadenceService } = await import('../../fclConfig');

                // Get storage identifier from path
                // e.g. /storage/MomentCollection -> MomentCollection
                const collection = collections.find(c => c.id === selectedCollectionId);

                // Robustly handle storagePath (string or object)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawPath = collection?.collectionData?.storagePath as any;
                let identifier = '';

                if (typeof rawPath === 'string') {
                    identifier = rawPath;
                } else if (rawPath && typeof rawPath === 'object' && rawPath.identifier) {
                    identifier = rawPath.identifier;
                } else if (collection?.path) {
                    // Fallback: extract identifier from public/storage path
                    // e.g. /public/MomentCollection -> MomentCollection
                    // e.g. /storage/TopShotCollection -> TopShotCollection
                    const fallbackPath = typeof collection.path === 'string'
                        ? collection.path
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        : (collection.path as any)?.identifier || '';
                    if (fallbackPath) {
                        identifier = fallbackPath.includes('/')
                            ? fallbackPath.split('/').pop() || ''
                            : fallbackPath;
                    }
                }

                if (identifier && identifier.includes('/')) {
                    identifier = identifier.split('/').pop() || identifier;
                }

                if (!identifier) throw new Error(`No storage path available for ${getContractName(selectedCollectionId)}`);

                const page = currentState?.page || 0;
                const start = page * NFT_PAGE_SIZE;
                const end = start + NFT_PAGE_SIZE;

                // Use the new optimized method
                const nfts = await cadenceService.getNftsFromCollection(normalizedAddress, identifier, start, end);

                setCollectionStates(prev => ({
                    ...prev,
                    [selectedCollectionId]: {
                        nfts: nfts || [],
                        loading: false,
                        error: null,
                        page,
                        hasLoaded: true
                    }
                }));

                // Fire-and-forget: backfill detailed metadata to backend.
                if (nfts && nfts.length > 0 && collection) {
                    const items = nfts.map(toBackfillItem).filter(Boolean) as NonNullable<ReturnType<typeof toBackfillItem>>[];
                    if (items.length > 0) {
                        backfillNFTData(normalizedAddress, [{
                            id: collection.id,
                            public_path: '',
                            nft_ids: [],
                            items,
                        }]);
                    }
                }
            } catch (err) {
                console.error('Failed to load NFTs', err);
                setCollectionStates(prev => ({
                    ...prev,
                    [selectedCollectionId]: {
                        ...prev[selectedCollectionId],
                        loading: false,
                        error: 'Failed to load NFTs',
                        page: prev[selectedCollectionId]?.page || 0,
                        hasLoaded: true
                    }
                }));
            }
        };

        loadNFTs();
    }, [selectedCollectionId, normalizedAddress, collections, collectionStates]); // Removed getGlobalOffset dependency

    const handlePageChange = (newPage: number) => {
        if (!selectedCollectionId) return;
        setCollectionStates(prev => ({
            ...prev,
            [selectedCollectionId]: { ...prev[selectedCollectionId], page: newPage, hasLoaded: false } // Trigger reload
        }));
    };

    const selectedCollection = collections.find(c => c.id === selectedCollectionId);
    const selectedState = selectedCollectionId ? collectionStates[selectedCollectionId] : null;

    const getDisplayInfo = (col: NFTCollection) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = col.collectionDisplay as any;
        if (!d) return { name: null, description: null, squareImage: null, bannerImage: null, externalURL: null };
        return {
            name: d.name || null,
            description: d.description || null,
            squareImage: d.squareImage?.file?.url || d.squareImage?.file?.uri || null,
            bannerImage: d.bannerImage?.file?.url || d.bannerImage?.file?.uri || null,
            externalURL: d.externalURL?.url || null,
        };
    };

    const getContractName = (id: string) => {
        const parts = id.split('.');
        return parts.length >= 3 ? parts[2] : id;
    };

    if (loadingCollections && collections.length === 0) {
        return (
            <GlassCard className="p-12 flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-8 h-8 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-full animate-spin mb-4" />
                <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest">Loading Collections...</p>
            </GlassCard>
        );
    }

    if (!loadingCollections && collections.length === 0) {
        return (
            <GlassCard className="p-12 flex flex-col items-center justify-center min-h-[400px]">
                <Package className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mb-4" />
                <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest">No NFT Collections Found</p>
            </GlassCard>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row gap-6 items-start h-[calc(100vh-200px)] min-h-[600px]">
            {/* Sidebar: Collection List (unchanged) */}
            <GlassCard className="w-full lg:w-80 flex-shrink-0 flex flex-col h-full overflow-hidden p-0 bg-white/50 dark:bg-black/40">
                <div className="p-4 border-b border-zinc-200 dark:border-white/10 bg-zinc-50/50 dark:bg-white/5 backdrop-blur-sm">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Collections ({collections.length})</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {collections.map(col => {
                        const display = getDisplayInfo(col);
                        const contractName = getContractName(col.id);
                        const isSelected = col.id === selectedCollectionId;

                        return (
                            <button
                                key={col.id}
                                onClick={() => setSelectedCollectionId(col.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 p-3 text-left transition-all duration-200 group",
                                    isSelected
                                        ? "bg-white dark:bg-white/10 shadow-sm ring-1 ring-zinc-200 dark:ring-white/10"
                                        : "hover:bg-zinc-100 dark:hover:bg-white/5"
                                )}
                            >
                                <div className="h-10 w-10 overflow-hidden bg-zinc-200 dark:bg-white/10 flex-shrink-0 border border-black/5 dark:border-white/10">
                                    {display.squareImage ? (
                                        <img src={display.squareImage} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <ImageIcon className="h-5 w-5 text-zinc-400" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className={cn("text-sm font-semibold truncate", isSelected ? "text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300")}>
                                        {display.name || contractName}
                                    </div>
                                    <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1.5">
                                        <span>{col.ids?.length || 0} items</span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </GlassCard>

            {/* Main Content: NFT Grid */}
            <div className="flex-1 h-full flex flex-col min-w-0 relative">
                {selectedCollection ? (
                    <GlassCard className="h-full flex flex-col overflow-hidden p-0 bg-white/50 dark:bg-black/40">
                        {/* Collection Header (unchanged) */}
                        <div className="relative h-32 md:h-48 flex-shrink-0 bg-zinc-100 dark:bg-white/5 overflow-hidden border-b border-zinc-200 dark:border-white/10">
                            {getDisplayInfo(selectedCollection).bannerImage && (
                                <img
                                    src={getDisplayInfo(selectedCollection).bannerImage!}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                                />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-black/80 to-transparent" />

                            <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col justify-end">
                                <div className="flex items-end justify-between gap-4">
                                    <div>
                                        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                            {getDisplayInfo(selectedCollection).name || getContractName(selectedCollection.id)}
                                            {getDisplayInfo(selectedCollection).externalURL && (
                                                <a href={getDisplayInfo(selectedCollection).externalURL!} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                                                    <ExternalLink className="h-4 w-4" />
                                                </a>
                                            )}
                                        </h2>
                                        {getDisplayInfo(selectedCollection).description && (
                                            <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1 max-w-2xl mt-1">
                                                {getDisplayInfo(selectedCollection).description}
                                            </p>
                                        )}
                                    </div>

                                    {/* View Toggle */}
                                    <div className="flex bg-white/50 dark:bg-black/50 backdrop-blur-md p-1 border border-zinc-200 dark:border-white/10 shadow-sm">
                                        <button onClick={() => setLayout('grid')} className={cn("p-1.5 transition-colors", layout === 'grid' ? "bg-white dark:bg-white/20 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5")}>
                                            <Grid className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                                        </button>
                                        <button onClick={() => setLayout('list')} className={cn("p-1.5 transition-colors", layout === 'list' ? "bg-white dark:bg-white/20 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5")}>
                                            <ListIcon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* NFT List/Grid */}
                        <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/50 dark:bg-transparent">
                            {selectedState?.loading && selectedState?.nfts.length === 0 ? (
                                <div className="flex h-full items-center justify-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-8 h-8 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                        <div className="text-xs text-zinc-500 uppercase tracking-widest">Loading NFTs...</div>
                                    </div>
                                </div>
                            ) : selectedState?.error ? (
                                <div className="flex flex-col h-full items-center justify-center gap-4">
                                    <div className="text-red-500 text-sm font-medium">{selectedState.error}</div>
                                    <button
                                        onClick={() => {
                                            if (!selectedCollectionId) return;
                                            setCollectionStates(prev => ({
                                                ...prev,
                                                [selectedCollectionId]: {
                                                    ...prev[selectedCollectionId],
                                                    loading: false,
                                                    error: null,
                                                    hasLoaded: false // Trigger useEffect
                                                }
                                            }));
                                        }}
                                        className="px-4 py-2 bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/20 text-zinc-900 dark:text-white text-xs uppercase tracking-widest rounded-md transition-colors flex items-center gap-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
                                        Retry
                                    </button>
                                </div>
                            ) : selectedState?.loading && selectedState?.nfts.length === 0 ? (
                                <div className="flex h-64 items-center justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                </div>
                            ) : selectedState?.nfts.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-zinc-500 text-sm italic">
                                    No NFTs found in this collection.
                                </div>
                            ) : (
                                <div className="relative min-h-[200px]">
                                    {selectedState?.loading && (
                                        <div className="absolute inset-0 z-10 bg-white/50 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-lg transition-all duration-300">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 dark:border-white"></div>
                                        </div>
                                    )}
                                    {layout === 'grid' ? (
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                            {selectedState?.nfts.map((nft, i) => {
                                                const thumb = getNFTThumbnail(nft);
                                                const name = nft?.display?.name || `#${nft?.tokenId ?? i}`;
                                                const nftId = nft?.tokenId ?? String(i);

                                                return (
                                                    <button
                                                        key={nftId}
                                                        onClick={() => setSelectedNft(nft)}
                                                        className="group flex flex-col overflow-hidden border border-zinc-200 dark:border-white/5 bg-white dark:bg-white/5 hover:ring-2 hover:ring-zinc-900 dark:hover:ring-white transition-all duration-300 shadow-sm hover:shadow-md text-left"
                                                    >
                                                        <div className="aspect-square relative overflow-hidden">
                                                            <ImageWithFallback
                                                                src={thumb}
                                                                alt={name}
                                                                className="w-full h-full transform transition-transform duration-500 group-hover:scale-110"
                                                            />
                                                        </div>
                                                        <div className="p-3">
                                                            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate mb-0.5">{name}</div>
                                                            <div className="text-[10px] text-zinc-500 font-mono">#{nftId}</div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {selectedState?.nfts.map((nft, i) => {
                                                const thumb = getNFTThumbnail(nft);
                                                const name = nft?.display?.name || `#${nft?.tokenId ?? i}`;
                                                const nftId = nft?.tokenId ?? String(i);

                                                return (
                                                    <button
                                                        key={nftId}
                                                        onClick={() => setSelectedNft(nft)}
                                                        className="w-full flex items-center gap-4 p-2 hover:bg-white dark:hover:bg-white/10 border border-transparent hover:border-zinc-200 dark:hover:border-white/5 transition-all group text-left"
                                                    >
                                                        <div className="h-12 w-12 flex-shrink-0 bg-zinc-100 dark:bg-white/5 relative overflow-hidden border border-zinc-200 dark:border-white/5">
                                                            <ImageWithFallback
                                                                src={thumb}
                                                                alt={name}
                                                                className="w-full h-full"
                                                            />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{name}</div>
                                                            <div className="text-xs text-zinc-500 line-clamp-1">{nft?.display?.description}</div>
                                                        </div>
                                                        <div className="text-xs font-mono text-zinc-500">#{nftId}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Pagination Controls */}
                                    <div className="flex items-center justify-center gap-4 mt-8 pb-4">
                                        <button
                                            disabled={!selectedState || selectedState.page <= 0 || selectedState.loading}
                                            onClick={() => handlePageChange((selectedState?.page || 0) - 1)}
                                            className="px-4 py-2 text-xs uppercase tracking-widest border border-zinc-200 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        >
                                            Previous
                                        </button>
                                        <span className="text-xs text-zinc-500 font-mono">
                                            Page {(selectedState?.page || 0) + 1}
                                        </span>
                                        <button
                                            disabled={!selectedState || ((selectedState.nfts.length < NFT_PAGE_SIZE) && (selectedCollection.ids?.length || 0) <= NFT_PAGE_SIZE) || selectedState.loading}
                                            onClick={() => handlePageChange((selectedState?.page || 0) + 1)}
                                            className="px-4 py-2 text-xs uppercase tracking-widest border border-zinc-200 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </GlassCard>
                ) : (
                    <div className="h-full flex items-center justify-center text-zinc-400">
                        Select a collection to view NFTs
                    </div>
                )}
            </div>

            {/* NFT Modal Overlay */}
            {selectedNft && (
                <NFTDetailModal
                    nft={selectedNft}
                    collectionId={selectedCollectionId || ''}
                    collectionName={selectedCollection ? (getDisplayInfo(selectedCollection).name || getContractName(selectedCollection.id)) : undefined}
                    onClose={() => setSelectedNft(null)}
                />
            )}
        </div >
    );
}
