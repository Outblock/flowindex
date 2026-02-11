import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, ChevronDown, Image as ImageIcon } from 'lucide-react';
import type { NFTCollectionInfo } from '../../../cadence/cadence.gen';
import { normalizeAddress, formatShort, getNFTThumbnail } from './accountUtils';

const NFT_PAGE_SIZE = 30;

interface Props {
    address: string;
}

export function AccountNFTsTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [collections, setCollections] = useState<NFTCollectionInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Collection expand state: { [storagePath]: { nfts, nftCount, loading, error, page } }
    const [expandedNFTs, setExpandedNFTs] = useState<Record<string, { nfts: any[]; nftCount: number; loading: boolean; error: string | null; page: number }>>({});

    useEffect(() => {
        setCollections([]);
        setError(null);
        setExpandedNFTs({});
    }, [address]);

    const loadCollections = async () => {
        setLoading(true);
        setError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const res = await cadenceService.getNftCollections(normalizedAddress);
            setCollections(res || []);
        } catch (err) {
            console.error('Failed to load NFT collections', err);
            setError('Failed to load NFT collections');
        } finally {
            setLoading(false);
        }
    };

    const toggleCollectionNFTs = async (storagePath: string, page = 0) => {
        const pathId = storagePath.split('/').pop() || '';
        if (!pathId) return;

        const existing = expandedNFTs[storagePath];
        if (existing && page === 0 && !existing.loading) {
            setExpandedNFTs(prev => { const next = { ...prev }; delete next[storagePath]; return next; });
            return;
        }

        setExpandedNFTs(prev => ({
            ...prev,
            [storagePath]: { nfts: existing?.nfts || [], nftCount: existing?.nftCount || 0, loading: true, error: null, page }
        }));

        try {
            const { cadenceService } = await import('../../fclConfig');
            const start = page * NFT_PAGE_SIZE;
            const end = start + NFT_PAGE_SIZE;
            const nfts = await cadenceService.getNftListPublic(normalizedAddress, pathId, start, end);
            // Get total count from the collections list
            const collectionInfo = collections.find(col => (col.storagePath as any)?.split?.('/')?.pop() === pathId || col.identifier?.includes(pathId));
            const nftCount = collectionInfo?.count || nfts.length;
            setExpandedNFTs(prev => ({
                ...prev,
                [storagePath]: { nfts, nftCount, loading: false, error: null, page }
            }));
        } catch (err) {
            console.error('Failed to load collection NFTs', err);
            setExpandedNFTs(prev => ({
                ...prev,
                [storagePath]: { nfts: [], nftCount: 0, loading: false, error: 'Failed to load NFTs', page }
            }));
        }
    };

    useEffect(() => {
        if (collections.length === 0 && !loading) loadCollections();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    const totalCount = collections.reduce((sum, c) => sum + c.count, 0);

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                    NFT Collections
                    {collections.length > 0 && <span className="ml-1 text-zinc-400">({totalCount.toLocaleString()} total)</span>}
                </div>
                {loading && <div className="text-[10px] text-zinc-500">Loading...</div>}
            </div>

            {error && <div className="text-xs text-red-500 dark:text-red-400 mb-4">{error}</div>}

            <div className="min-h-[120px] relative">
                {collections.length > 0 ? (
                    <div className="space-y-4">
                        {collections.map((c, i) => {
                            const expanded = expandedNFTs[c.storagePath as any];
                            const isExpanded = !!expanded;

                            return (
                                <div key={`${c.identifier}-${i}`} className="border border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-black/40 rounded-sm overflow-hidden">
                                    {/* Collection header */}
                                    <button type="button" onClick={() => toggleCollectionNFTs(c.storagePath as any)} className="w-full text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
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
                                                        {expanded.nfts.map((nft: any, ni: number) => {
                                                            const thumb = getNFTThumbnail(nft);
                                                            const name = nft?.display?.name || `#${nft?.tokenId ?? ni}`;
                                                            return (
                                                                <div key={`${nft?.tokenId ?? ni}`} className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden bg-white dark:bg-black/40 hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors">
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
                                                                        <div className="text-[9px] text-zinc-400">#{nft?.tokenId ?? ni}</div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    {expanded.nftCount > NFT_PAGE_SIZE && (
                                                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200 dark:border-white/5">
                                                            <button disabled={expanded.page <= 0 || expanded.loading} onClick={() => toggleCollectionNFTs(c.storagePath as any, expanded.page - 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Previous</button>
                                                            <span className="text-[10px] text-zinc-500">{expanded.page * NFT_PAGE_SIZE + 1}–{Math.min((expanded.page + 1) * NFT_PAGE_SIZE, expanded.nftCount)} of {expanded.nftCount.toLocaleString()}</span>
                                                            <button disabled={(expanded.page + 1) * NFT_PAGE_SIZE >= expanded.nftCount || expanded.loading} onClick={() => toggleCollectionNFTs(c.storagePath as any, expanded.page + 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Next</button>
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

                                    {/* Collection footer (collapsed) */}
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
                        })}
                    </div>
                ) : !loading ? (
                    <div className="text-center text-zinc-500 italic py-8">No NFT collections found</div>
                ) : null}
            </div>
        </div>
    );
}
