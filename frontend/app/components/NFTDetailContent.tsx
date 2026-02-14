import { Package, ExternalLink } from 'lucide-react';
import { ImageWithFallback } from './ui/ImageWithFallback';
import { getNFTMedia } from './account/accountUtils';

interface NFTDetailContentProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nft: any;
    collectionId?: string;
    collectionName?: string;
    /** Layout variant: 'row' for side-by-side (modal), 'column' for stacked (page) */
    layout?: 'row' | 'column';
}

/**
 * Convert flat API NFT item format to the nested Cadence-like structure
 * that this component expects (display.name, serial.number, etc.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiItemToCadenceFormat(item: any): any {
    if (!item) return null;
    // Already in Cadence format (has display.name)
    if (item.display?.name) return item;

    const result: Record<string, unknown> = {
        tokenId: item.nft_id || item.id,
    };

    // Display
    if (item.name || item.description || item.thumbnail) {
        result.display = {
            name: item.name || '',
            description: item.description || '',
            thumbnail: item.thumbnail || '',
        };
    }

    // Serial
    if (item.serial_number != null) {
        result.serial = { number: item.serial_number };
    }

    // Editions
    if (item.edition_number != null || item.edition_max != null) {
        result.editions = [{
            name: item.edition_name || '',
            number: item.edition_number,
            max: item.edition_max,
        }];
    }

    // Rarity
    if (item.rarity_score || item.rarity_description) {
        result.rarity = {
            score: item.rarity_score || null,
            description: item.rarity_description || '',
        };
    }

    // External URL
    if (item.external_url) {
        result.externalURL = { url: item.external_url };
    }

    // Traits (API returns array directly, modal expects .traits or .traits.traits)
    if (item.traits && Array.isArray(item.traits) && item.traits.length > 0) {
        result.traits = item.traits;
    }

    // Pass through owner
    if (item.owner || item.current_owner) {
        result.owner = item.owner || item.current_owner;
    }

    return result;
}

export function NFTDetailContent({ nft, collectionId = '', collectionName, layout = 'row' }: NFTDetailContentProps) {
    if (!nft) return null;

    const isRow = layout === 'row';

    return (
        <div className={`flex ${isRow ? 'flex-col md:flex-row' : 'flex-col'} w-full`}>
            {/* Image/Video */}
            <div className={`${isRow ? 'w-full md:w-auto md:h-[min(80vh,600px)] md:aspect-square' : 'w-full aspect-square max-h-[500px]'} bg-zinc-100 dark:bg-black/20 relative overflow-hidden flex-shrink-0`}>
                <div className="aspect-square w-full h-full">
                    {(() => {
                        const media = getNFTMedia(nft, collectionId);
                        if (media.type === 'video') {
                            return (
                                <video
                                    src={media.url}
                                    poster={media.fallbackImage}
                                    controls autoPlay loop muted
                                    className="absolute inset-0 w-full h-full object-cover"
                                />
                            );
                        }
                        return (
                            <ImageWithFallback
                                src={media.url}
                                alt={nft?.display?.name}
                                className="absolute inset-0 w-full h-full object-cover"
                                fallback={<Package className="w-24 h-24 text-zinc-300 dark:text-zinc-700 opacity-20" />}
                            />
                        );
                    })()}
                </div>
            </div>

            {/* Metadata */}
            <div className={`flex-1 min-w-0 p-6 overflow-y-auto ${isRow ? 'max-h-[50vh] md:max-h-[min(80vh,600px)]' : ''}`}>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
                    {nft?.display?.name || `#${nft?.tokenId}`}
                </h2>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <span className="bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 px-2 py-1 text-xs font-mono">
                        #{nft?.tokenId}
                    </span>
                    {collectionName && (
                        <span className="text-xs text-zinc-500">
                            {collectionName}
                        </span>
                    )}
                </div>

                {nft?.display?.description && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
                        {nft.display.description}
                    </p>
                )}

                {/* Key Metadata Grid */}
                <div className="grid grid-cols-2 gap-2 mb-5">
                    {nft?.serial && (
                        <div className="p-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/5">
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Serial</div>
                            <div className="font-mono text-sm font-semibold">{nft.serial.number}</div>
                        </div>
                    )}
                    {nft?.editions && nft.editions.length > 0 && (
                        <div className="p-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/5">
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Edition</div>
                            <div className="font-mono text-sm font-semibold">
                                {nft.editions[0].number}
                                <span className="text-zinc-400 font-normal"> / {nft.editions[0].max || '?'}</span>
                            </div>
                        </div>
                    )}
                    {nft?.rarity && (
                        <div className="p-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/5 col-span-2">
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">Rarity</div>
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-sm">{nft.rarity.description || 'Unknown'}</span>
                                {nft.rarity.score && (
                                    <span className="text-xs bg-zinc-200 dark:bg-white/10 px-2 py-0.5 rounded-full">
                                        Score: {nft.rarity.score}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* External Links */}
                {nft?.externalURL && (
                    <a
                        href={nft.externalURL.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between w-full p-2.5 mb-5 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20 transition-colors text-xs font-semibold uppercase tracking-wider"
                    >
                        <span>View External Resource</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                )}

                {/* Traits */}
                {(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const traitsList = (nft.traits as any)?.traits || nft.traits;
                    if (Array.isArray(traitsList) && traitsList.length > 0) {
                        return (
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Traits</h3>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {traitsList.map((trait: any, i: number) => (
                                        <div key={i} className="p-2 bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/5">
                                            <div className="text-[10px] uppercase text-zinc-500 truncate">{trait?.name || trait?.display?.name || 'Trait'}</div>
                                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 truncate">
                                                {String(trait?.value || trait?.display?.value || '\u2014')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    }
                    return null;
                })()}
            </div>
        </div>
    );
}
