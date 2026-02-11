import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Image as ImageIcon } from 'lucide-react';
import type { NFTCollection } from '../../../cadence/cadence.gen';
import { normalizeAddress, getNFTThumbnail } from './accountUtils';

const NFT_PAGE_SIZE = 30;

interface Props {
    address: string;
}

interface ExpandedState {
    nfts: any[];
    loading: boolean;
    error: string | null;
    page: number;
}

export function AccountNFTsTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [collections, setCollections] = useState<NFTCollection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, ExpandedState>>({});

    useEffect(() => {
        setCollections([]);
        setError(null);
        setExpanded({});
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

    useEffect(() => {
        if (collections.length === 0 && !loading) loadCollections();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    const getPathId = (col: NFTCollection): string => {
        // path is like "/public/MomentCollection" — extract identifier
        const p = col.path || '';
        return p.split('/').pop() || p;
    };

    const toggleCollection = async (col: NFTCollection, page = 0) => {
        const key = col.id;
        const existing = expanded[key];

        // Collapse if already expanded and clicking header (page 0)
        if (existing && page === 0 && !existing.loading) {
            setExpanded(prev => { const next = { ...prev }; delete next[key]; return next; });
            return;
        }

        setExpanded(prev => ({
            ...prev,
            [key]: { nfts: existing?.nfts || [], loading: true, error: null, page }
        }));

        try {
            const { cadenceService } = await import('../../fclConfig');
            const pathId = getPathId(col);
            const start = page * NFT_PAGE_SIZE;
            const end = start + NFT_PAGE_SIZE;
            const nfts = await cadenceService.getNftListPublic(normalizedAddress, pathId, start, end);
            setExpanded(prev => ({
                ...prev,
                [key]: { nfts: nfts || [], loading: false, error: null, page }
            }));
        } catch (err) {
            console.error('Failed to load NFTs', err);
            setExpanded(prev => ({
                ...prev,
                [key]: { nfts: [], loading: false, error: 'Failed to load NFTs', page }
            }));
        }
    };

    const totalCount = collections.reduce((sum, c) => sum + (c.ids?.length || 0), 0);

    // Extract display info from collectionDisplay (AnyStruct from Cadence)
    const getDisplayInfo = (col: NFTCollection) => {
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

    // Extract contract name from type identifier (A.{address}.{name}.Collection)
    const getContractName = (id: string) => {
        const parts = id.split('.');
        return parts.length >= 3 ? parts[2] : id;
    };

    // Deterministic color from string hash for placeholder banners
    const BANNER_COLORS = [
        'from-violet-500/30 to-indigo-600/30',
        'from-emerald-500/30 to-teal-600/30',
        'from-orange-500/30 to-rose-600/30',
        'from-sky-500/30 to-cyan-600/30',
        'from-pink-500/30 to-fuchsia-600/30',
        'from-amber-500/30 to-yellow-600/30',
        'from-lime-500/30 to-green-600/30',
        'from-blue-500/30 to-purple-600/30',
    ];
    const getBannerColor = (id: string) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
        return BANNER_COLORS[Math.abs(hash) % BANNER_COLORS.length];
    };

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
                        {collections.map((col, i) => {
                            const display = getDisplayInfo(col);
                            const contractName = getContractName(col.id);
                            const count = col.ids?.length || 0;
                            const exp = expanded[col.id];
                            const isExpanded = !!exp;

                            return (
                                <div key={`${col.id}-${i}`} className="border border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-black/40 rounded-sm overflow-hidden">
                                    {/* Banner */}
                                    <button type="button" onClick={() => toggleCollection(col)} className="w-full text-left group">
                                        <div className="relative h-24 overflow-hidden">
                                            {display.bannerImage ? (
                                                <img
                                                    src={display.bannerImage}
                                                    alt=""
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    loading="lazy"
                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                                                />
                                            ) : null}
                                            <div className={`absolute inset-0 bg-gradient-to-br ${getBannerColor(col.id)} ${display.bannerImage ? 'hidden' : ''}`}>
                                                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                                    <span className="text-4xl font-bold font-mono text-zinc-900 dark:text-white uppercase tracking-[0.3em]">{(display.name || contractName).slice(0, 3)}</span>
                                                </div>
                                            </div>
                                            {/* Gradient overlay for text readability */}
                                            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-zinc-50 dark:from-black/80 to-transparent" />
                                        </div>

                                        {/* Info row overlapping banner bottom */}
                                        <div className="px-4 pb-3 -mt-6 relative flex items-end gap-3">
                                            {/* Square avatar */}
                                            <div className="flex-shrink-0">
                                                {display.squareImage ? (
                                                    <img src={display.squareImage} alt="" className="w-12 h-12 rounded-sm border-2 border-white dark:border-zinc-800 object-cover bg-zinc-200 dark:bg-white/5 shadow-sm" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
                                                ) : null}
                                                <div className={`w-12 h-12 rounded-sm border-2 border-white dark:border-zinc-800 bg-zinc-200 dark:bg-white/10 flex items-center justify-center shadow-sm ${display.squareImage ? 'hidden' : ''}`}>
                                                    <ImageIcon className="h-5 w-5 text-zinc-400 dark:text-zinc-600" />
                                                </div>
                                            </div>

                                            <div className="min-w-0 flex-1 pb-0.5">
                                                <div className="text-sm font-mono font-semibold text-zinc-900 dark:text-white truncate">{display.name || contractName}</div>
                                                <div className="text-[10px] text-zinc-500 font-mono truncate" title={col.id}>{contractName}</div>
                                            </div>

                                            <div className="text-right flex-shrink-0 pb-0.5 flex items-center gap-2">
                                                <div>
                                                    <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{count.toLocaleString()}</div>
                                                    <div className="text-[10px] text-zinc-500">items</div>
                                                </div>
                                                {isExpanded ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
                                            </div>
                                        </div>
                                    </button>

                                    {/* Expanded NFT grid */}
                                    {isExpanded && (
                                        <div className="border-t border-zinc-200 dark:border-white/5 p-4">
                                            {exp.loading && exp.nfts.length === 0 && (
                                                <div className="flex items-center justify-center py-8">
                                                    <div className="w-6 h-6 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                                                </div>
                                            )}

                                            {exp.error && <div className="text-xs text-red-500 dark:text-red-400 text-center py-4">{exp.error}</div>}

                                            {exp.nfts.length > 0 && (
                                                <>
                                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                                                        {exp.nfts.map((nft: any, ni: number) => {
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

                                                    {count > NFT_PAGE_SIZE && (
                                                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200 dark:border-white/5">
                                                            <button disabled={exp.page <= 0 || exp.loading} onClick={() => toggleCollection(col, exp.page - 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Previous</button>
                                                            <span className="text-[10px] text-zinc-500">{exp.page * NFT_PAGE_SIZE + 1}–{Math.min((exp.page + 1) * NFT_PAGE_SIZE, count)} of {count.toLocaleString()}</span>
                                                            <button disabled={(exp.page + 1) * NFT_PAGE_SIZE >= count || exp.loading} onClick={() => toggleCollection(col, exp.page + 1)} className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5">Next</button>
                                                        </div>
                                                    )}
                                                </>
                                            )}

                                            {!exp.loading && !exp.error && exp.nfts.length === 0 && (
                                                <div className="text-center text-zinc-500 italic text-xs py-4">No NFTs found in this collection</div>
                                            )}

                                            {exp.loading && exp.nfts.length > 0 && (
                                                <div className="flex items-center justify-center py-2 mt-2">
                                                    <div className="w-4 h-4 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Collection footer (collapsed) */}
                                    {!isExpanded && display.description && (
                                        <div className="px-4 pb-3">
                                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">{display.description}</p>
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
