import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Eye, Clock, ArrowRightLeft, ExternalLink } from 'lucide-react';
import { GlassCard } from './ui/GlassCard';
import { NFTDetailContent } from './NFTDetailContent';
import { NFTTimeline } from './NFTTimeline';
import { AddressLink } from './AddressLink';
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

type ModalTab = 'overview' | 'history' | 'transfers';

export function NFTDetailModal({ nft, nftType, nftId, collectionId = '', collectionName, onClose }: NFTDetailModalProps) {
    const [activeTab, setActiveTab] = useState<ModalTab>('overview');
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
        setActiveTab('overview');
        setTransfers([]);
        transfersFetched.current = false;
    }, [nftId, nftType]);

    // Lazy-fetch transfers when history or transfers tab is first activated
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
            const p: any = res?.data;
            setTransfers(p?.data || []);
        } catch (e) {
            console.error('Failed to fetch NFT transfers for modal', e);
        } finally {
            setTransfersLoading(false);
        }
    }, [nftType, nftId]);

    useEffect(() => {
        if (activeTab === 'history' || activeTab === 'transfers') {
            fetchTransfers();
        }
    }, [activeTab, fetchTransfers]);

    if (!nft) return null;

    const owner = nft?.owner ? normalizeAddress(nft.owner) : null;
    const canShowTabs = !!(nftType && nftId);

    const tabs: { id: ModalTab; label: string; icon: typeof Eye }[] = [
        { id: 'overview', label: 'Overview', icon: Eye },
        { id: 'history', label: 'History', icon: Clock },
        { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <GlassCard className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden p-0 z-10 bg-white dark:bg-zinc-900 shadow-2xl animate-in zoom-in-95 duration-200">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 p-2 bg-white/80 dark:bg-black/60 hover:bg-white dark:hover:bg-black backdrop-blur-md transition-colors rounded-full z-20"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>

                <div className="flex flex-col md:flex-row w-full max-h-[90vh]">
                    {/* Image — always visible */}
                    <NFTDetailContent nft={nft} collectionId={collectionId} collectionName={collectionName} layout="row" />
                </div>

                {/* Tabs section — below the image+metadata on mobile, or below content */}
                {canShowTabs && (
                    <div className="border-t border-zinc-200 dark:border-white/10">
                        {/* Tab buttons */}
                        <div className="flex gap-0 border-b border-zinc-200 dark:border-white/10 bg-zinc-50/50 dark:bg-white/[0.02]">
                            {tabs.map(({ id, label, icon: Icon }) => {
                                const isActive = activeTab === id;
                                return (
                                    <button
                                        key={id}
                                        onClick={() => setActiveTab(id)}
                                        className={cn(
                                            "relative flex-1 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5",
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

                        {/* Tab content */}
                        <div className="p-4 max-h-[30vh] overflow-y-auto">
                            {activeTab === 'overview' && (
                                <div className="space-y-3">
                                    {owner && (
                                        <div className="p-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/5">
                                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Current Owner</div>
                                            <AddressLink address={owner} prefixLen={20} suffixLen={0} className="text-sm" />
                                        </div>
                                    )}
                                    {!owner && (
                                        <div className="text-sm text-zinc-500 italic">No additional details.</div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'history' && (
                                <NFTTimeline
                                    transfers={transfers}
                                    currentOwner={owner || undefined}
                                    loading={transfersLoading}
                                />
                            )}

                            {activeTab === 'transfers' && (
                                <div>
                                    {transfersLoading && (
                                        <div className="flex items-center justify-center py-8">
                                            <div className="w-6 h-6 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                                        </div>
                                    )}
                                    {!transfersLoading && transfers.length > 0 && (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-zinc-200 dark:border-white/5">
                                                        <th className="pb-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">From</th>
                                                        <th className="pb-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">To</th>
                                                        <th className="pb-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Tx</th>
                                                        <th className="pb-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider text-right">Block</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                    {transfers.map((t: any, i: number) => {
                                                        const tx = t?.transaction_hash ? normalizeAddress(t.transaction_hash) : '';
                                                        const from = t?.sender ? normalizeAddress(t.sender) : '';
                                                        const to = t?.receiver ? normalizeAddress(t.receiver) : '';
                                                        const height = Number(t?.block_height || 0);
                                                        return (
                                                            <tr key={`${tx}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                                <td className="py-2 pr-3">
                                                                    {from ? <AddressLink address={from} className="text-xs" /> : <span className="text-zinc-400">&mdash;</span>}
                                                                </td>
                                                                <td className="py-2 pr-3">
                                                                    {to ? <AddressLink address={to} className="text-xs" /> : <span className="text-zinc-400">&mdash;</span>}
                                                                </td>
                                                                <td className="py-2 pr-3">
                                                                    {tx ? (
                                                                        <Link to="/txs/$txId" params={{ txId: tx }} search={{ tab: undefined }} className="font-mono text-[10px] text-nothing-green-dark dark:text-nothing-green hover:underline">
                                                                            {tx.slice(0, 16)}...
                                                                        </Link>
                                                                    ) : <span className="text-zinc-400">&mdash;</span>}
                                                                </td>
                                                                <td className="py-2 text-right font-mono text-[10px] text-zinc-500">
                                                                    {height > 0 ? height.toLocaleString() : ''}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    {!transfersLoading && transfers.length === 0 && (
                                        <div className="text-center text-zinc-500 italic py-8 text-sm">No transfers found.</div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* View Full Page link */}
                        <div className="px-4 pb-3 flex justify-end">
                            <Link
                                to={`/nfts/${encodeURIComponent(nftType!)}/item/${encodeURIComponent(nftId!)}` as any}
                                className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-nothing-green-dark dark:text-nothing-green hover:underline"
                            >
                                View Full Page
                                <ExternalLink className="w-3 h-3" />
                            </Link>
                        </div>
                    </div>
                )}
            </GlassCard>
        </div>
    );
}
