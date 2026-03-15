import { useState, useEffect, useCallback } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { ImageWithFallback } from '@flowindex/flow-ui';
import { getEVMAddressNFTs } from '@/api/evm';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSTokenBalance, BSPageParams } from '@/types/blockscout';

interface EVMNFTsTabProps {
    address: string;
}

function resolveImage(item: BSTokenBalance): string | null {
    const meta = item.token_instance?.metadata;
    if (!meta) return item.token.icon_url || null;
    return meta.image || meta.image_url || item.token.icon_url || null;
}

function resolveName(item: BSTokenBalance): string {
    const meta = item.token_instance?.metadata;
    if (meta?.name) return meta.name;
    if (item.token.name && item.token_id) return `${item.token.name} #${item.token_id}`;
    if (item.token_id) return `#${item.token_id}`;
    return 'Unknown NFT';
}

export function EVMNFTsTab({ address }: EVMNFTsTabProps) {
    const [items, setItems] = useState<BSTokenBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextPageParams, setNextPageParams] = useState<BSPageParams | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setItems([]);
        setNextPageParams(null);

        getEVMAddressNFTs(address)
            .then((res) => {
                if (cancelled) return;
                setItems(res.items || []);
                setNextPageParams(res.next_page_params);
            })
            .catch((err) => {
                if (!cancelled) console.warn('[EVMNFTsTab]', err?.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [address]);

    const handleLoadMore = useCallback((params: BSPageParams) => {
        setLoadingMore(true);
        getEVMAddressNFTs(address, params)
            .then((res) => {
                setItems((prev) => [...prev, ...(res.items || [])]);
                setNextPageParams(res.next_page_params);
            })
            .catch((err) => console.warn('[EVMNFTsTab] load more:', err?.message))
            .finally(() => setLoadingMore(false));
    }, [address]);

    if (loading) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                ))}
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-12 text-zinc-500">
                <ImageIcon className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No EVM NFTs found for this address.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map((item, idx) => {
                    const img = resolveImage(item);
                    const name = resolveName(item);
                    const collection = item.token.name || item.token.symbol || 'Unknown Collection';

                    return (
                        <div
                            key={`${item.token.address}-${item.token_id}-${idx}`}
                            className="group border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
                        >
                            {/* Image */}
                            <div className="aspect-square bg-zinc-100 dark:bg-zinc-800 relative overflow-hidden">
                                {img ? (
                                    <ImageWithFallback
                                        src={img}
                                        alt={name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <ImageIcon className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                                    </div>
                                )}
                                {/* Token type badge */}
                                <span className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 bg-black/60 text-white font-bold uppercase tracking-wider backdrop-blur-sm">
                                    {item.token.type}
                                </span>
                            </div>

                            {/* Info */}
                            <div className="p-2.5">
                                <p className="text-xs font-medium truncate" title={name}>{name}</p>
                                <p className="text-[10px] text-zinc-500 truncate mt-0.5" title={collection}>{collection}</p>
                                {item.token_id && (
                                    <p className="text-[10px] font-mono text-zinc-400 truncate mt-0.5">ID: {item.token_id}</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <LoadMorePagination
                nextPageParams={nextPageParams}
                isLoading={loadingMore}
                onLoadMore={handleLoadMore}
            />
        </div>
    );
}
