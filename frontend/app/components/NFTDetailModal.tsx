import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Info, Clock, ExternalLink, X } from 'lucide-react';
import { GlassCard } from './ui/GlassCard';
import { NFTImage, NFTMetadata } from './NFTDetailContent';
import { NFTTimeline } from './NFTTimeline';
import { normalizeAddress } from './account/accountUtils';
import { ensureHeyApiConfigured } from '../api/heyapi';
import { getFlowV1NftByNftTypeItemByIdTransfer } from '../api/gen/find';
import { cn } from '../lib/utils';

interface NFTDetailModalProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nft: any;
    nftType?: string;
    nftId?: string;
    collectionId?: string;
    collectionName?: string;
    onClose: () => void;
}

type ModalTab = 'detail' | 'history';

export function NFTDetailModal({ nft, nftType, nftId, collectionId = '', collectionName, onClose }: NFTDetailModalProps) {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<ModalTab>('detail');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [transfers, setTransfers] = useState<any[]>([]);
    const [transfersLoading, setTransfersLoading] = useState(false);
    const transfersFetched = useRef(false);

    // Escape key handler
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    // Reset when NFT changes
    useEffect(() => {
        setActiveTab('detail');
        setTransfers([]);
        transfersFetched.current = false;
    }, [nftId, nftType]);

    // Lazy-fetch transfers when history tab first activated
    const fetchTransfers = useCallback(async () => {
        if (transfersFetched.current || !nftType || !nftId) return;
        transfersFetched.current = true;
        setTransfersLoading(true);
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1NftByNftTypeItemByIdTransfer({
                path: { nft_type: nftType, id: nftId },
                query: { limit: 100, offset: 0 },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p: any = res?.data;
            setTransfers(p?.data || []);
        } catch (e) {
            console.error('Failed to fetch NFT transfers for modal', e);
        } finally {
            setTransfersLoading(false);
        }
    }, [nftType, nftId]);

    useEffect(() => {
        if (activeTab === 'history') {
            fetchTransfers();
        }
    }, [activeTab, fetchTransfers]);

    if (!nft) return null;

    const owner = nft?.owner ? normalizeAddress(nft.owner) : null;
    const canShowTabs = !!(nftType && nftId);

    const tabs: { id: ModalTab; label: string; icon: typeof Info }[] = [
        { id: 'detail', label: 'Detail', icon: Info },
        { id: 'history', label: 'History', icon: Clock },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <GlassCard className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden p-0 z-10 bg-white dark:bg-zinc-900 shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex flex-col md:flex-row w-full max-h-[90vh]">
                    {/* Left: Image */}
                    <NFTImage
                        nft={nft}
                        collectionId={collectionId}
                        className="w-full md:w-auto md:h-[min(80vh,600px)] md:aspect-square"
                    />

                    {/* Right panel */}
                    <div className="flex-1 min-w-0 flex flex-col max-h-[50vh] md:max-h-[min(80vh,600px)]">
                        {/* Header: Name/ID + Close button */}
                        <div className="flex items-start justify-between p-4 pb-2 flex-shrink-0">
                            <div className="min-w-0">
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white truncate">
                                    {nft?.display?.name || `#${nft?.tokenId}`}
                                </h2>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 text-[10px] font-mono">
                                        #{nft?.tokenId}
                                    </span>
                                    {collectionName && (
                                        <span className="text-[10px] text-zinc-500">{collectionName}</span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors flex-shrink-0 ml-2"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Tab bar */}
                        {canShowTabs && (
                            <div className="flex border-b border-zinc-200 dark:border-white/10 mx-4 flex-shrink-0">
                                {tabs.map(({ id, label, icon: Icon }) => {
                                    const isActive = activeTab === id;
                                    return (
                                        <button
                                            key={id}
                                            onClick={() => setActiveTab(id)}
                                            className={cn(
                                                "relative flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5",
                                                isActive
                                                    ? "text-zinc-900 dark:text-white"
                                                    : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                            )}
                                        >
                                            {isActive && (
                                                <motion.div
                                                    layoutId="modalTab"
                                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-white"
                                                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                                                />
                                            )}
                                            <Icon className="w-3 h-3" />
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* Tab content */}
                        <div className="flex-1 overflow-y-auto p-4">
                            {activeTab === 'detail' && (
                                <NFTMetadata nft={nft} collectionName={collectionName} />
                            )}

                            {activeTab === 'history' && (
                                <NFTTimeline
                                    transfers={transfers}
                                    currentOwner={owner || undefined}
                                    loading={transfersLoading}
                                />
                            )}
                        </div>

                        {/* View Full Page link */}
                        {canShowTabs && (
                            <div className="px-4 py-2.5 border-t border-zinc-200 dark:border-white/10 flex justify-end flex-shrink-0">
                                <button
                                    onClick={() => {
                                        onClose();
                                        navigate({ to: '/nfts/$nftType/item/$id', params: { nftType: nftType!, id: nftId! } });
                                    }}
                                    className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-nothing-green-dark dark:text-nothing-green hover:underline"
                                >
                                    View Full Page
                                    <ExternalLink className="w-3 h-3" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}
