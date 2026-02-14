import { GlassCard } from './ui/GlassCard';
import { NFTDetailContent } from './NFTDetailContent';

interface NFTDetailModalProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nft: any;
    collectionId?: string;
    collectionName?: string;
    onClose: () => void;
}

export function NFTDetailModal({ nft, collectionId = '', collectionName, onClose }: NFTDetailModalProps) {
    if (!nft) return null;

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

                <NFTDetailContent nft={nft} collectionId={collectionId} collectionName={collectionName} layout="row" />
            </GlassCard>
        </div>
    );
}
