import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import {
    ChevronRight, ChevronDown, Image as ImageIcon, X, LayoutGrid, List,
    ExternalLink, Hash, Star
} from 'lucide-react';
import type { NFTCollectionInfo } from '../../../cadence/cadence.gen';
import { normalizeAddress, formatShort, getStoragePathId, storagePathStr, getNFTThumbnail } from './accountUtils';

const NFT_PAGE_SIZE = 30;

interface Props {
    address: string;
}

export function AccountNFTsTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [collections, setCollections] = useState<NFTCollectionInfo[]>([]);
    const [collectionsLoading, setCollectionsLoading] = useState(false);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [totalNFTCount, setTotalNFTCount] = useState<number | null>(null);

    // Collection expand state
    const [expandedNFTs, setExpandedNFTs] = useState<Record<string, { nfts: any[]; nftCount: number; loading: boolean; error: string | null; page: number }>>({});

    // View mode: collections vs all
    const [viewMode, setViewMode] = useState<'collections' | 'all'>('collections');
    const [allNFTs, setAllNFTs] = useState<any[]>([]);
    const [allNFTsLoading, setAllNFTsLoading] = useState(false);
    const [allNFTsPage, setAllNFTsPage] = useState(0);

    // NFT detail modal
    const [detailOpen, setDetailOpen] = useState(false);
    const [detail, setDetail] = useState<any>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    useEffect(() => {
        setCollections([]);
        setCollectionsError(null);
        setExpandedNFTs({});
        setTotalNFTCount(null);
        setAllNFTs([]);
        setAllNFTsPage(0);
        setViewMode('collections');
        setDetailOpen(false);
        setDetail(null);
    }, [address]);

    const loadCollections = async () => {
        setCollectionsLoading(true);
        setCollectionsError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const res = await cadenceService.getNftCollections(normalizedAddress);
            setCollections(res || []);
        } catch (err) {
            console.error('Failed to load NFT collections', err);
            setCollectionsError('Failed to load NFT collections');
        } finally {
            setCollectionsLoading(false);
        }
    };

    const loadTotalCount = async () => {
        try {
            const { cadenceService } = await import('../../fclConfig');
            const count = await cadenceService.getAllNftCount(normalizedAddress);
            setTotalNFTCount(typeof count === 'number' ? count : Number(count) || 0);
        } catch (err) {
            console.error('Failed to load total NFT count', err);
        }
    };

    const loadAllNFTs = async (page = 0) => {
        setAllNFTsLoading(true);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const start = page * NFT_PAGE_SIZE;
            const end = start + NFT_PAGE_SIZE;
            const res = await cadenceService.getAllNfts(normalizedAddress, start, end);
            setAllNFTs(res || []);
            setAllNFTsPage(page);
        } catch (err) {
            console.error('Failed to load all NFTs', err);
        } finally {
            setAllNFTsLoading(false);
        }
    };

    const toggleCollectionNFTs = async (storagePath: any, page = 0) => {
        const key = storagePathStr(storagePath);
        const pathId = getStoragePathId(storagePath);
        if (!pathId) return;

        const existing = expandedNFTs[key];
        if (existing && page === 0 && !existing.loading) {
            setExpandedNFTs(prev => { const next = { ...prev }; delete next[key]; return next; });
            return;
        }

        setExpandedNFTs(prev => ({
            ...prev,
            [key]: { nfts: existing?.nfts || [], nftCount: existing?.nftCount || 0, loading: true, error: null, page }
        }));

        try {
            const { cadenceService } = await import('../../fclConfig');
            const start = page * NFT_PAGE_SIZE;
            const end = start + NFT_PAGE_SIZE;
            const res = await cadenceService.getNftListPublic(normalizedAddress, pathId, start, end);
            const nfts = res || [];
            // Use collection count from collections array if available
            const collectionCount = collections.find(col => getStoragePathId(col.storagePath) === pathId)?.count || nfts.length;
            setExpandedNFTs(prev => ({
                ...prev,
                [key]: { nfts, nftCount: collectionCount, loading: false, error: null, page }
            }));
        } catch (err) {
            console.error('Failed to load collection NFTs', err);
            setExpandedNFTs(prev => ({
                ...prev,
                [key]: { nfts: [], nftCount: 0, loading: false, error: 'Failed to load NFTs', page }
            }));
        }
    };

    const openNFTDetail = async (collectionPathId: string, tokenId: number) => {
        setDetailOpen(true);
        setDetail(null);
        setDetailLoading(true);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const res = await cadenceService.getNftDetail(normalizedAddress, collectionPathId, tokenId);
            setDetail(res);
        } catch (err) {
            console.error('Failed to load NFT detail', err);
            setDetail({ error: 'Failed to load NFT detail' });
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => {
        if (collections.length === 0 && !collectionsLoading) loadCollections();
        if (totalNFTCount === null) loadTotalCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                    {viewMode === 'collections' ? 'NFT Collections' : 'All NFTs'}
                    {totalNFTCount !== null && <span className="ml-1 text-zinc-400">({totalNFTCount.toLocaleString()} total)</span>}
                </div>
                <div className="flex items-center gap-2">
                    {collectionsLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                    <div className="flex border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                        <button onClick={() => setViewMode('collections')} className={`p-1.5 transition-colors ${viewMode === 'collections' ? 'bg-zinc-200 dark:bg-white/10 text-zinc-900 dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`} title="By Collection">
                            <List className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => { setViewMode('all'); if (allNFTs.length === 0 && !allNFTsLoading) loadAllNFTs(0); }} className={`p-1.5 transition-colors ${viewMode === 'all' ? 'bg-zinc-200 dark:bg-white/10 text-zinc-900 dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`} title="All NFTs">
                            <LayoutGrid className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {collectionsError && <div className="text-xs text-red-500 dark:text-red-400 mb-4">{collectionsError}</div>}

            {/* All NFTs grid view */}
            {viewMode === 'all' && (
                <AllNFTsGrid
                    nfts={allNFTs} loading={allNFTsLoading} page={allNFTsPage}
                    totalCount={totalNFTCount} onPageChange={loadAllNFTs}
                    onClickNFT={openNFTDetail}
                />
            )}

            {/* Collections view */}
            {viewMode === 'collections' && (
                <div className="min-h-[120px]">
                    {collections.length > 0 ? (
                        <div className="space-y-4">
                            {collections.map((c, i) => (
                                <CollectionCard
                                    key={`${c.identifier}-${i}`}
                                    collection={c}
                                    expanded={expandedNFTs[storagePathStr(c.storagePath)]}
                                    onToggle={(page) => toggleCollectionNFTs(c.storagePath, page)}
                                    onClickNFT={openNFTDetail}
                                />
                            ))}
                        </div>
                    ) : !collectionsLoading ? (
                        <div className="text-center text-zinc-500 italic py-8">No NFT collections found</div>
                    ) : null}
                </div>
            )}

            {/* NFT Detail Modal */}
            {detailOpen && (
                <NFTDetailModal
                    detail={detail} loading={detailLoading}
                    onClose={() => setDetailOpen(false)}
                />
            )}
        </div>
    );
}

/* ── Sub-components ─────────────────────────────── */

function NFTCard({ nft, index, onClick }: { nft: any; index: number; onClick?: () => void }) {
    const thumb = getNFTThumbnail(nft);
    const name = nft?.display?.name || `#${nft?.tokenId ?? index}`;
    return (
        <button
            type="button"
            className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden bg-white dark:bg-black/40 hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors text-left"
            onClick={onClick}
        >
            <div className="aspect-square bg-zinc-100 dark:bg-white/5 relative overflow-hidden">
                {thumb ? (
                    <img src={thumb} alt={name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; e.currentTarget.parentElement!.querySelector('.nft-placeholder')?.classList.remove('hidden'); }} />
                ) : null}
                <div className={`nft-placeholder absolute inset-0 flex items-center justify-center ${thumb ? 'hidden' : ''}`}>
                    <ImageIcon className="h-6 w-6 text-zinc-300 dark:text-zinc-700" />
                </div>
            </div>
            <div className="p-2">
                <div className="text-[10px] font-mono text-zinc-700 dark:text-zinc-300 truncate" title={name}>{name}</div>
                <div className="text-[9px] text-zinc-400">#{nft?.tokenId ?? index}</div>
            </div>
        </button>
    );
}

function AllNFTsGrid({ nfts, loading, page, totalCount, onPageChange, onClickNFT }: {
    nfts: any[]; loading: boolean; page: number; totalCount: number | null;
    onPageChange: (page: number) => void; onClickNFT: (pathId: string, tokenId: number) => void;
}) {
    return (
        <div className="min-h-[120px]">
            {loading && nfts.length === 0 && (
                <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                </div>
            )}
            {nfts.length > 0 && (
                <>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                        {nfts.map((nft, ni) => {
                            const collectionName = nft?.collectionDisplay?.name || '';
                            return (
                                <div key={`${nft?.tokenId ?? ni}-${ni}`} className="relative">
                                    <NFTCard nft={nft} index={ni} onClick={() => {
                                        const cdPath = nft?.collectionData?.storagePath;
                                        const pathId = cdPath ? getStoragePathId(cdPath) : '';
                                        if (pathId && nft?.tokenId != null) onClickNFT(pathId, nft.tokenId);
                                    }} />
                                    {collectionName && <div className="text-[8px] text-zinc-400 truncate px-2 -mt-1 pb-1">{collectionName}</div>}
                                </div>
                            );
                        })}
                    </div>
                    {totalCount !== null && totalCount > NFT_PAGE_SIZE && (
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200 dark:border-white/5">
                            <button disabled={page <= 0 || loading} onClick={() => onPageChange(page - 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Previous</button>
                            <span className="text-[10px] text-zinc-500">{page * NFT_PAGE_SIZE + 1}–{Math.min((page + 1) * NFT_PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</span>
                            <button disabled={(page + 1) * NFT_PAGE_SIZE >= totalCount || loading} onClick={() => onPageChange(page + 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Next</button>
                        </div>
                    )}
                </>
            )}
            {!loading && nfts.length === 0 && <div className="text-center text-zinc-500 italic py-8">No NFTs found</div>}
            {loading && nfts.length > 0 && (
                <div className="flex items-center justify-center py-4">
                    <div className="w-4 h-4 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                </div>
            )}
        </div>
    );
}

function CollectionCard({ collection: c, expanded, onToggle, onClickNFT }: {
    collection: NFTCollectionInfo; expanded: any; onToggle: (page?: number) => void;
    onClickNFT: (pathId: string, tokenId: number) => void;
}) {
    const isExpanded = !!expanded;
    const pathId = getStoragePathId(c.storagePath);

    return (
        <div className="border border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-black/40 rounded-sm overflow-hidden">
            {/* Header */}
            <button type="button" onClick={() => onToggle(0)} className="w-full text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                <div className="p-4 flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-zinc-500 flex-shrink-0" />}
                    {c.squareImageURL ? (
                        <img src={c.squareImageURL} alt="" className="w-10 h-10 rounded-sm border border-zinc-200 dark:border-white/10 object-cover flex-shrink-0 bg-zinc-200 dark:bg-white/5" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
                    ) : null}
                    <div className={`w-10 h-10 rounded-sm border border-zinc-200 dark:border-white/10 bg-zinc-200 dark:bg-white/5 flex items-center justify-center flex-shrink-0 ${c.squareImageURL ? 'hidden' : ''}`}>
                        <ImageIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-mono text-zinc-900 dark:text-white truncate">{c.name || c.contractName}</div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate" title={c.identifier}>{c.contractName}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{c.count.toLocaleString()}</div>
                        <div className="text-[10px] text-zinc-500">items</div>
                    </div>
                </div>
            </button>

            {/* Expanded NFT grid */}
            {isExpanded && (
                <div className="border-t border-zinc-200 dark:border-white/5 p-4">
                    {expanded.loading && expanded.nfts.length === 0 && (
                        <div className="flex items-center justify-center py-8">
                            <div className="w-6 h-6 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                        </div>
                    )}
                    {expanded.error && <div className="text-xs text-red-500 dark:text-red-400 text-center py-4">{expanded.error}</div>}
                    {expanded.nfts.length > 0 && (
                        <>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                                {expanded.nfts.map((nft: any, ni: number) => (
                                    <NFTCard key={nft?.tokenId ?? ni} nft={nft} index={ni} onClick={() => {
                                        if (pathId && nft?.tokenId != null) onClickNFT(pathId, nft.tokenId);
                                    }} />
                                ))}
                            </div>
                            {expanded.nftCount > NFT_PAGE_SIZE && (
                                <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200 dark:border-white/5">
                                    <button disabled={expanded.page <= 0 || expanded.loading} onClick={() => onToggle(expanded.page - 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Previous</button>
                                    <span className="text-[10px] text-zinc-500">{expanded.page * NFT_PAGE_SIZE + 1}–{Math.min((expanded.page + 1) * NFT_PAGE_SIZE, expanded.nftCount)} of {expanded.nftCount.toLocaleString()}</span>
                                    <button disabled={(expanded.page + 1) * NFT_PAGE_SIZE >= expanded.nftCount || expanded.loading} onClick={() => onToggle(expanded.page + 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Next</button>
                                </div>
                            )}
                        </>
                    )}
                    {!expanded.loading && !expanded.error && expanded.nfts.length === 0 && (
                        <div className="text-center text-zinc-500 italic text-xs py-4">No NFTs found in this collection</div>
                    )}
                    {expanded.loading && expanded.nfts.length > 0 && (
                        <div className="flex items-center justify-center py-2 mt-2">
                            <div className="w-4 h-4 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                        </div>
                    )}
                </div>
            )}

            {/* Footer (collapsed) */}
            {!isExpanded && (
                <div className="px-4 pb-3">
                    {c.description && <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1 mb-2">{c.description}</p>}
                    <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-white/5">
                        <Link to={`/accounts/${normalizeAddress(c.contractAddress)}` as any} className="text-[10px] font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">{formatShort(c.contractAddress)}</Link>
                        {c.externalURL && <a href={c.externalURL} target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors uppercase tracking-wider">Website</a>}
                    </div>
                </div>
            )}
        </div>
    );
}

function NFTDetailModal({ detail, loading, onClose }: { detail: any; loading: boolean; onClose: () => void }) {
    const display = detail?.display || {};
    const thumb = detail ? getNFTThumbnail(detail) : '';
    const collDisplay = detail?.collectionDisplay || {};
    const traits = detail?.traits?.traits || [];
    const editions = detail?.editions?.infoList || [];
    const rarity = detail?.rarity;
    const serial = detail?.serial;
    const externalURL = detail?.externalURL?.url;
    const royalties = detail?.royalties?.cutInfos || [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-white/5">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">NFT Detail</div>
                    <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-sm transition-colors">
                        <X className="h-4 w-4 text-zinc-500" />
                    </button>
                </div>

                {loading && (
                    <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                    </div>
                )}
                {detail?.error && <div className="p-6 text-center text-xs text-red-500">{detail.error}</div>}
                {detail && !detail.error && !loading && (
                    <div>
                        <div className="aspect-square bg-zinc-100 dark:bg-white/5 relative overflow-hidden">
                            {thumb ? (
                                <img src={thumb} alt={display.name || ''} className="w-full h-full object-contain" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; e.currentTarget.parentElement!.querySelector('.nft-placeholder')?.classList.remove('hidden'); }} />
                            ) : null}
                            <div className={`nft-placeholder absolute inset-0 flex items-center justify-center ${thumb ? 'hidden' : ''}`}>
                                <ImageIcon className="h-12 w-12 text-zinc-300 dark:text-zinc-700" />
                            </div>
                        </div>

                        <div className="p-4 space-y-4">
                            <div>
                                <h3 className="text-lg font-mono font-bold text-zinc-900 dark:text-white">{display.name || `NFT #${detail.tokenId}`}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] font-mono text-zinc-500">ID: {detail.tokenId}</span>
                                    {collDisplay.name && <span className="text-[10px] text-zinc-400">· {collDisplay.name}</span>}
                                </div>
                            </div>

                            {display.description && <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{display.description}</p>}

                            {externalURL && (
                                <a href={externalURL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-nothing-green-dark dark:text-nothing-green hover:underline uppercase tracking-wider">
                                    <ExternalLink className="h-3 w-3" /> View on External Site
                                </a>
                            )}

                            {(serial || rarity) && (
                                <div className="flex gap-4">
                                    {serial && (
                                        <div className="flex items-center gap-1.5">
                                            <Hash className="h-3 w-3 text-zinc-400" />
                                            <span className="text-[10px] text-zinc-500">Serial:</span>
                                            <span className="text-[10px] font-mono text-zinc-900 dark:text-white">{serial.number?.toString()}</span>
                                        </div>
                                    )}
                                    {rarity && (
                                        <div className="flex items-center gap-1.5">
                                            <Star className="h-3 w-3 text-zinc-400" />
                                            <span className="text-[10px] text-zinc-500">Rarity:</span>
                                            <span className="text-[10px] font-mono text-zinc-900 dark:text-white">{rarity.description || rarity.score?.toString()}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {editions.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Editions</div>
                                    <div className="flex flex-wrap gap-2">
                                        {editions.map((ed: any, ei: number) => (
                                            <span key={ei} className="px-2 py-1 text-[10px] font-mono border border-zinc-200 dark:border-white/10 rounded-sm bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-zinc-300">
                                                {ed.name ? `${ed.name}: ` : ''}{ed.number?.toString()}{ed.max ? ` / ${ed.max}` : ''}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {traits.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Traits</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {traits.map((trait: any, ti: number) => (
                                            <div key={ti} className="border border-zinc-200 dark:border-white/10 rounded-sm p-2 bg-zinc-50 dark:bg-white/5">
                                                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">{trait.name || 'trait'}</div>
                                                <div className="text-[11px] font-mono text-zinc-900 dark:text-white truncate">{String(trait.value ?? '')}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {royalties.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Royalties</div>
                                    <div className="space-y-1">
                                        {royalties.map((r: any, ri: number) => (
                                            <div key={ri} className="flex items-center justify-between text-[10px] font-mono">
                                                <span className="text-zinc-600 dark:text-zinc-400 truncate">{r.receiver?.address || 'Unknown'}</span>
                                                <span className="text-zinc-900 dark:text-white">{(Number(r.cut) * 100).toFixed(2)}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
