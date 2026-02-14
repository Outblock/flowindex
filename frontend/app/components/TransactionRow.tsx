import { useState, useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, FileCode, Zap, Box, UserPlus, Key, ShoppingBag, Clock, ChevronDown, ChevronRight, ExternalLink, Loader2, Globe, Flame, Droplets, CircleDollarSign, Coins } from 'lucide-react';
import { normalizeAddress, formatShort } from './account/accountUtils';
import { AddressLink } from './AddressLink';
import { formatRelativeTime } from '../lib/time';
import { ensureHeyApiConfigured } from '../api/heyapi';
import { getFlowV1TransactionById } from '../api/gen/find/sdk.gen';
import { NFTDetailModal } from './NFTDetailModal';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { AvatarGroup, AvatarGroupTooltip } from '@/components/animate-ui/components/animate/avatar-group';

// --- Interfaces ---

export interface FTSummaryItem {
    token: string;
    amount: string;
    direction: string;
    counterparty?: string;
    symbol?: string;
    name?: string;
    logo?: any;
}

export interface NFTSummaryItem {
    collection: string;
    count: number;
    direction: string;
    counterparty?: string;
    name?: string;
    logo?: any;
}

export interface TransferSummary {
    ft: FTSummaryItem[];
    nft: NFTSummaryItem[];
}

export interface TokenMetaEntry {
    name: string;
    symbol: string;
    logo: any;
    type: 'ft' | 'nft';
    banner_image?: string | null;
}

// --- Helpers ---

export function deriveActivityType(tx: any): { type: string; label: string; color: string; bgColor: string } {
    const tags: string[] = tx.tags || [];
    const imports: string[] = tx.contract_imports || [];
    const summary: TransferSummary | undefined = tx.transfer_summary;

    const tagsLower = tags.map(t => t.toLowerCase());
    const importsLower = imports.map(c => c.toLowerCase());

    if (tagsLower.some(t => t.includes('account_created'))) {
        return { type: 'account', label: 'New Account', color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10' };
    }
    if (tagsLower.some(t => t.includes('key_update'))) {
        return { type: 'key', label: 'Key Update', color: 'text-orange-600 dark:text-orange-400', bgColor: 'border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10' };
    }
    if (tagsLower.some(t => t.includes('scheduled'))) {
        return { type: 'scheduled', label: 'Scheduled', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10' };
    }
    if (tagsLower.some(t => t.includes('deploy') || t.includes('contract_added') || t.includes('contract_updated') || t.includes('contract_deploy'))) {
        return { type: 'deploy', label: 'Deploy', color: 'text-blue-600 dark:text-blue-400', bgColor: 'border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10' };
    }
    // Only classify as EVM if there's actual EVM execution evidence (evm_hash, evm_executions),
    // not just because the tx imports EVM (system heartbeat txs import EVM but aren't user EVM txs).
    if (tx.evm_hash || tx.evm_executions?.length > 0 || tagsLower.some(t => t.includes('evm'))) {
        return { type: 'evm', label: 'EVM', color: 'text-purple-600 dark:text-purple-400', bgColor: 'border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10' };
    }
    if (tagsLower.some(t => t.includes('marketplace'))) {
        return { type: 'marketplace', label: 'Marketplace', color: 'text-pink-600 dark:text-pink-400', bgColor: 'border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10' };
    }
    if (summary?.nft && summary.nft.length > 0) {
        return { type: 'nft', label: 'NFT Transfer', color: 'text-amber-600 dark:text-amber-400', bgColor: 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' };
    }
    if (summary?.ft && summary.ft.length > 0) {
        return { type: 'ft', label: 'FT Transfer', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10' };
    }
    // Check ft_transfers array directly (transfer_summary may be null even when ft_transfers exist)
    if (tx.ft_transfers?.length > 0 || tagsLower.some(t => t.includes('ft_transfer'))) {
        return { type: 'ft', label: 'FT Transfer', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10' };
    }
    if (tx.nft_transfers?.length > 0 || tagsLower.some(t => t.includes('nft_transfer'))) {
        return { type: 'nft', label: 'NFT Transfer', color: 'text-amber-600 dark:text-amber-400', bgColor: 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' };
    }
    // Check defi_events for swaps
    if (tx.defi_events?.length > 0) {
        return { type: 'swap', label: 'Swap', color: 'text-teal-600 dark:text-teal-400', bgColor: 'border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10' };
    }
    // Script template classification (from admin-labeled script hashes)
    if (tx.template_category) {
        const mapped = mapTemplateCategoryToActivity(tx.template_category, tx.template_label);
        if (mapped) return mapped;
    }
    if (imports.length > 0) {
        return { type: 'contract', label: 'Contract Call', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' };
    }
    return { type: 'tx', label: 'Transaction', color: 'text-zinc-500 dark:text-zinc-500', bgColor: 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5' };
}

const templateCategoryStyles: Record<string, { type: string; label: string; color: string; bgColor: string }> = {
    FT_TRANSFER:      { type: 'ft', label: 'FT Transfer', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10' },
    FT_MINT:          { type: 'ft', label: 'FT Mint', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10' },
    NFT_TRANSFER:     { type: 'nft', label: 'NFT Transfer', color: 'text-amber-600 dark:text-amber-400', bgColor: 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' },
    NFT_MINT:         { type: 'nft', label: 'NFT Mint', color: 'text-amber-600 dark:text-amber-400', bgColor: 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' },
    NFT_PURCHASE:     { type: 'marketplace', label: 'NFT Purchase', color: 'text-pink-600 dark:text-pink-400', bgColor: 'border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10' },
    NFT_LISTING:      { type: 'marketplace', label: 'NFT Listing', color: 'text-pink-600 dark:text-pink-400', bgColor: 'border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10' },
    STAKING:          { type: 'ft', label: 'Staking', color: 'text-violet-600 dark:text-violet-400', bgColor: 'border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10' },
    ACCOUNT_CREATION: { type: 'account', label: 'New Account', color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10' },
    ACCOUNT_SETUP:    { type: 'account', label: 'Account Setup', color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10' },
    SCHEDULED:        { type: 'scheduled', label: 'Scheduled', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10' },
    EVM_BRIDGE:       { type: 'evm', label: 'EVM Bridge', color: 'text-purple-600 dark:text-purple-400', bgColor: 'border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10' },
    EVM_CALL:         { type: 'evm', label: 'EVM Call', color: 'text-purple-600 dark:text-purple-400', bgColor: 'border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10' },
    SWAP:             { type: 'swap', label: 'Swap', color: 'text-teal-600 dark:text-teal-400', bgColor: 'border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10' },
    LIQUIDITY:        { type: 'swap', label: 'Liquidity', color: 'text-teal-600 dark:text-teal-400', bgColor: 'border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10' },
    CONTRACT_DEPLOY:  { type: 'deploy', label: 'Deploy', color: 'text-blue-600 dark:text-blue-400', bgColor: 'border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10' },
    SYSTEM:           { type: 'contract', label: 'System', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' },
    OTHER:            { type: 'contract', label: 'Contract Call', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' },
};

function mapTemplateCategoryToActivity(category: string, templateLabel?: string): { type: string; label: string; color: string; bgColor: string } | null {
    // Support comma-separated multi-categories — use first match for badge styling
    const cats = category.split(',').map(c => c.trim()).filter(Boolean);
    for (const cat of cats) {
        const style = templateCategoryStyles[cat];
        if (style) {
            if (templateLabel) {
                return { ...style, label: templateLabel };
            }
            return style;
        }
    }
    return null;
}

export function formatTokenName(identifier: string): string {
    if (!identifier) return '';
    const parts = identifier.split('.');
    return parts.length >= 3 ? parts[2] : identifier;
}

export function extractLogoUrl(logo: any): string | null {
    if (!logo) return null;
    if (typeof logo === 'string') {
        if (logo.startsWith('http')) return logo;
        return null;
    }
    try {
        const json = typeof logo === 'string' ? JSON.parse(logo) : logo;
        const findUrl = (obj: any): string | null => {
            if (!obj || typeof obj !== 'object') return null;
            if (typeof obj.url === 'string' && obj.url.startsWith('http')) return obj.url;
            if (typeof obj.value === 'string' && obj.value.startsWith('http')) return obj.value;
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const found = findUrl(item);
                    if (found) return found;
                }
            }
            if (obj.value && typeof obj.value === 'object') {
                return findUrl(obj.value);
            }
            if (obj.fields && Array.isArray(obj.fields)) {
                for (const field of obj.fields) {
                    const found = findUrl(field);
                    if (found) return found;
                }
            }
            return null;
        };
        return findUrl(json);
    } catch {
        return null;
    }
}

export function TokenIcon({ logo, symbol, size = 16 }: { logo?: any; symbol?: string; size?: number }) {
    const url = extractLogoUrl(logo);
    if (url) {
        return (
            <img
                src={url}
                alt={symbol || ''}
                width={size}
                height={size}
                className="rounded-full object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
        );
    }
    return null;
}

export function buildSummaryLine(tx: any): string {
    const summary: TransferSummary | undefined = tx.transfer_summary;
    const imports: string[] = tx.contract_imports || [];
    const tags: string[] = tx.tags || [];
    const tagsLower = tags.map(t => t.toLowerCase());

    if (tagsLower.some(t => t.includes('account_created'))) return 'Created new account';
    if (tagsLower.some(t => t.includes('key_update'))) return 'Updated account key';

    // Transfer summary (available on detail/expand, not on list)
    if (summary?.ft && summary.ft.length > 0) {
        const parts = summary.ft.map(f => {
            const displayName = f.symbol || f.name || formatTokenName(f.token);
            const direction = f.direction === 'out' ? 'Sent' : 'Received';
            const cp = f.counterparty ? ` ${f.direction === 'out' ? 'to' : 'from'} ${formatShort(f.counterparty)}` : '';
            return `${direction} ${Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${displayName}${cp}`;
        });
        return parts.join(', ');
    }

    if (summary?.nft && summary.nft.length > 0) {
        const parts = summary.nft.map(n => {
            const displayName = n.name || formatTokenName(n.collection);
            const direction = n.direction === 'out' ? 'Sent' : 'Received';
            const cp = n.counterparty ? ` ${n.direction === 'out' ? 'to' : 'from'} ${formatShort(n.counterparty)}` : '';
            return `${direction} ${n.count} ${displayName}${cp}`;
        });
        return parts.join(', ');
    }

    if (tagsLower.some(t => t.includes('deploy') || t.includes('contract_added') || t.includes('contract_updated') || t.includes('contract_deploy'))) {
        const contractNames = imports.map(c => formatTokenName(c)).filter(Boolean);
        return contractNames.length > 0 ? `Deployed ${contractNames.join(', ')}` : 'Contract deployment';
    }

    if (tx.template_description) return tx.template_description;
    if (tx.template_label) return tx.template_label;

    if (imports.length > 0) {
        const contractNames = imports.slice(0, 3).map(c => formatTokenName(c)).filter(Boolean);
        const suffix = imports.length > 3 ? ` +${imports.length - 3} more` : '';
        return `Called ${contractNames.join(', ')}${suffix}`;
    }

    return '';
}

// --- Detail cache (persists across re-renders, shared across rows) ---
const detailCache = new Map<string, any>();

// --- Expanded Detail Panel with lazy fetch ---

export function ExpandedTransferDetails({ tx, address, expanded }: { tx: any; address: string; expanded: boolean }) {
    const [detail, setDetail] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const fetchedRef = useRef(false);

    // NFT detail modal state
    const [selectedNft, setSelectedNft] = useState<any>(null);
    const [selectedNftCollectionId, setSelectedNftCollectionId] = useState('');
    const [selectedNftCollectionName, setSelectedNftCollectionName] = useState('');
    const [nftLoadingIdx, setNftLoadingIdx] = useState<number | null>(null);

    useEffect(() => {
        if (!expanded || fetchedRef.current) return;
        fetchedRef.current = true;

        const txId = tx.id;
        if (detailCache.has(txId)) {
            setDetail(detailCache.get(txId));
            return;
        }

        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getFlowV1TransactionById({ path: { id: txId } });
                const raw: any = (res.data as any)?.data?.[0] ?? res.data;
                if (!cancelled) {
                    detailCache.set(txId, raw);
                    setDetail(raw);
                }
            } catch {
                if (!cancelled) setError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [expanded, tx.id]);

    // Handler: click NFT transfer row → fetch full Cadence detail → show modal
    const handleNftClick = async (nt: any, idx: number) => {
        // Determine owner address: receiver is most likely current holder
        const ownerAddr = nt.to_address || nt.from_address;
        const publicPath = nt.public_path;
        const tokenId = nt.token_id;

        if (!ownerAddr || !publicPath || !tokenId) {
            // Can't fetch on-chain detail without these — just skip
            return;
        }

        setNftLoadingIdx(idx);
        try {
            const { cadenceService } = await import('../fclConfig');
            const nftDetail = await cadenceService.getNftDetail(ownerAddr, publicPath, parseInt(tokenId));
            // Ensure tokenId is included in the result
            if (nftDetail && !nftDetail.tokenId) {
                nftDetail.tokenId = tokenId;
            }
            setSelectedNft(nftDetail);
            setSelectedNftCollectionId(nt.token || '');
            setSelectedNftCollectionName(nt.collection_name || '');
        } catch (err) {
            console.warn('Failed to fetch NFT detail (may be burned/moved)', err);
            // Graceful fallback: show modal with whatever metadata we have from the transfer
            setSelectedNft({
                display: {
                    name: nt.nft_name || `#${tokenId}`,
                    thumbnail: nt.nft_thumbnail ? { url: nt.nft_thumbnail } : undefined,
                },
                tokenId,
                rarity: nt.nft_rarity ? { description: nt.nft_rarity } : undefined,
            });
            setSelectedNftCollectionId(nt.token || '');
            setSelectedNftCollectionName(nt.collection_name || '');
        } finally {
            setNftLoadingIdx(null);
        }
    };

    // Fallback to list-level data while loading or on error
    const summary: TransferSummary | undefined = tx.transfer_summary;
    const tags: string[] = tx.tags || [];
    const tagsLower = tags.map((t: string) => t.toLowerCase());

    // Derive rich data from detail response
    const evmExecs: any[] = detail?.evm_executions || [];
    const ftTransfers: any[] = detail?.ft_transfers || [];
    const nftTransfers: any[] = detail?.nft_transfers || [];
    const defiEvents: any[] = detail?.defi_events || [];
    const events: any[] = detail?.events || [];

    // Extract created accounts from events
    const createdAccounts: string[] = [];
    if (tagsLower.some(t => t.includes('account_created'))) {
        for (const ev of events) {
            const name = ev.name || ev.type || '';
            if (name.includes('AccountCreated')) {
                try {
                    const payload = ev.values || ev.payload || ev.data || ev.fields;
                    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
                    // Cadence event: { type: "Event", value: { fields: [{ name: "address", value: { value: "0x..." } }] } }
                    const extractAddr = (obj: any): string | null => {
                        if (!obj) return null;
                        if (typeof obj === 'string' && obj.startsWith('0x')) return obj;
                        if (obj.value !== undefined) return extractAddr(obj.value);
                        if (Array.isArray(obj.fields)) {
                            const addrField = obj.fields.find((f: any) => f.name === 'address');
                            if (addrField) return extractAddr(addrField.value || addrField);
                        }
                        if (Array.isArray(obj)) {
                            for (const item of obj) {
                                const found = extractAddr(item);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    const addr = extractAddr(parsed);
                    if (addr) createdAccounts.push(addr.replace(/^0x/, ''));
                } catch { /* skip */ }
            }
        }
    }

    // Build summary from detail data (richer) or fall back to list-level data
    const summarySource = detail || tx;
    const summaryLine = buildSummaryLine(summarySource);

    return (
        <div className="px-4 pb-4 pt-1 ml-[88px] space-y-3">
            {/* Summary line */}
            {summaryLine && (
                <div className="text-xs text-zinc-600 dark:text-zinc-400">{summaryLine}</div>
            )}

            {/* Loading indicator */}
            {loading && (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading details...</span>
                </div>
            )}

            {/* EVM Executions (from detail API) */}
            {evmExecs.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">EVM Executions</div>
                    <div className="space-y-1.5">
                        {evmExecs.map((exec: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                                <a
                                    href={`https://evm.flowscan.io/tx/0x${exec.hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                >
                                    0x{formatShort(exec.hash, 10, 8)}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                                {exec.from && (
                                    <>
                                        <span className="text-zinc-400">from</span>
                                        <a
                                            href={`https://evm.flowscan.io/address/0x${exec.from}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                        >
                                            0x{formatShort(exec.from, 6, 4)}
                                        </a>
                                    </>
                                )}
                                {exec.to && (
                                    <>
                                        <span className="text-zinc-400">&rarr;</span>
                                        <a
                                            href={`https://evm.flowscan.io/address/0x${exec.to}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                        >
                                            0x{formatShort(exec.to, 6, 4)}
                                        </a>
                                    </>
                                )}
                                {!exec.to && <span className="text-zinc-400 italic">Contract Creation</span>}
                                {exec.value && exec.value !== '0' && (
                                    <span className="text-zinc-500 font-mono">{(Number(exec.value) / 1e18).toFixed(4)} FLOW</span>
                                )}
                                <span className={`text-[9px] uppercase px-1 py-0.5 rounded-sm border ${
                                    exec.status === 'SEALED' || exec.status === 'SUCCESS'
                                        ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10'
                                        : exec.status ? 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10' : ''
                                }`}>
                                    {exec.status || ''}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Fallback: EVM from list data when detail not loaded yet */}
            {evmExecs.length === 0 && !detail && (tx.is_evm || tx.evm_hash) && tx.evm_hash && (
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500 uppercase tracking-wider text-[10px] w-20 flex-shrink-0">EVM Hash</span>
                    <Link to={`/tx/${tx.evm_hash}` as any} className="font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
                        {formatShort(tx.evm_hash, 16, 12)}
                        <ExternalLink className="h-3 w-3" />
                    </Link>
                </div>
            )}

            {/* Account Creation */}
            {createdAccounts.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Created Accounts</div>
                    <div className="space-y-1">
                        {createdAccounts.map((addr, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                                <UserPlus className="h-3 w-3 text-cyan-500 flex-shrink-0" />
                                <AddressLink address={addr} prefixLen={20} suffixLen={0} onClick={(e) => e.stopPropagation()} />
                                {(tx.payer || tx.authorizers?.[0]) && (
                                    <span className="text-zinc-400 text-[10px]">
                                        by{' '}
                                        <AddressLink address={tx.payer || tx.authorizers[0]} size={14} onClick={(e) => e.stopPropagation()} />
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Account creation fallback before detail loads */}
            {createdAccounts.length === 0 && !detail && tagsLower.some(t => t.includes('account_created')) && (
                <div className="flex items-center gap-2 text-xs">
                    <UserPlus className="h-3 w-3 text-cyan-500" />
                    <span className="text-zinc-500">Created new account</span>
                    {!loading && <span className="text-zinc-400 text-[10px]">(expand to see address)</span>}
                </div>
            )}

            {/* FT Transfers (rich, from detail API) */}
            {ftTransfers.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Token Transfers</div>
                    <div className="space-y-1.5">
                        {ftTransfers.map((ft: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                                {ft.token_logo ? (
                                    <img src={ft.token_logo} alt="" className="w-[18px] h-[18px] rounded-full object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                    <TokenIcon logo={null} symbol={ft.token_symbol} size={18} />
                                )}
                                <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                                    {ft.amount != null ? Number(ft.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                </span>
                                <span className="text-zinc-500 text-[10px] uppercase font-medium">{ft.token_symbol || ft.token?.split('.').pop() || ''}</span>
                                {ft.is_cross_vm && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1 py-0.5 rounded uppercase">
                                        <Globe className="w-2.5 h-2.5" />
                                        Cross-VM
                                    </span>
                                )}
                                {ft.from_address && (
                                    <span className="text-zinc-400 text-[10px]">
                                        from{' '}
                                        <AddressLink address={ft.from_address} prefixLen={8} suffixLen={4} size={14} onClick={(e) => e.stopPropagation()} />
                                    </span>
                                )}
                                {ft.from_address && ft.to_address && <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>}
                                {ft.to_address && (
                                    <span className="text-zinc-400 text-[10px]">
                                        to{' '}
                                        <AddressLink address={ft.to_address} prefixLen={8} suffixLen={4} size={14} onClick={(e) => e.stopPropagation()} />
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* FT fallback from list summary when detail not loaded */}
            {ftTransfers.length === 0 && !detail && summary?.ft && summary.ft.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Token Transfers</div>
                    <div className="space-y-1.5">
                        {summary.ft.map((f, i) => {
                            const displayName = f.symbol || f.name || formatTokenName(f.token);
                            const isOut = f.direction === 'out';
                            return (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                    <TokenIcon logo={f.logo} symbol={displayName} size={18} />
                                    <span className={`inline-flex items-center gap-0.5 font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                        {isOut ? 'Sent' : 'Received'}
                                    </span>
                                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                                        {Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                    </span>
                                    <span className="text-zinc-500">{displayName}</span>
                                    {f.counterparty && (
                                        <span className="text-zinc-400 text-[10px]">
                                            {isOut ? 'to' : 'from'}{' '}
                                            <AddressLink address={f.counterparty} size={14} onClick={(e) => e.stopPropagation()} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* NFT Transfers (rich, from detail API) */}
            {nftTransfers.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">NFT Transfers</div>
                    <div className="space-y-2">
                        {nftTransfers.map((nt: any, i: number) => {
                            const isClickable = !!(nt.public_path && nt.token_id && (nt.to_address || nt.from_address));
                            const isLoadingThis = nftLoadingIdx === i;
                            return (
                                <div
                                    key={i}
                                    className={`flex items-center gap-2.5 text-xs ${isClickable ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/5 -mx-2 px-2 py-1.5 rounded-md transition-colors' : ''}`}
                                    onClick={isClickable && !isLoadingThis ? (e) => { e.stopPropagation(); handleNftClick(nt, i); } : undefined}
                                >
                                    {/* NFT thumbnail or collection icon */}
                                    {isLoadingThis ? (
                                        <div className="w-10 h-10 rounded-md bg-zinc-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                                            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                                        </div>
                                    ) : nt.nft_thumbnail ? (
                                        <img
                                            src={nt.nft_thumbnail}
                                            alt={nt.nft_name || ''}
                                            className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-zinc-200 dark:border-white/10"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                    ) : nt.collection_logo ? (
                                        <div className="w-10 h-10 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                                            <TokenIcon logo={nt.collection_logo} symbol={nt.collection_name} size={32} />
                                        </div>
                                    ) : (
                                        <div className="w-10 h-10 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center flex-shrink-0">
                                            <ShoppingBag className="h-4 w-4 text-amber-500" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className={`font-medium truncate ${isClickable ? 'text-nothing-green-dark dark:text-nothing-green' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                                {nt.nft_name || `#${nt.token_id}`}
                                            </span>
                                            <span className="text-zinc-400 text-[10px]">
                                                {nt.collection_name || formatTokenName(nt.token)}
                                            </span>
                                            {nt.nft_rarity && (
                                                <span className="text-[9px] px-1 py-0.5 rounded-sm border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 uppercase">
                                                    {nt.nft_rarity}
                                                </span>
                                            )}
                                            {nt.is_cross_vm && (
                                                <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1 py-0.5 rounded uppercase">
                                                    <Globe className="w-2.5 h-2.5" />
                                                    Cross-VM
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 mt-0.5">
                                            {nt.from_address && (
                                                <span>
                                                    from{' '}
                                                    <AddressLink address={nt.from_address} prefixLen={8} suffixLen={4} size={14} onClick={(e) => e.stopPropagation()} />
                                                </span>
                                            )}
                                            {nt.from_address && nt.to_address && <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>}
                                            {nt.to_address && (
                                                <span>
                                                    to{' '}
                                                    <AddressLink address={nt.to_address} prefixLen={8} suffixLen={4} size={14} onClick={(e) => e.stopPropagation()} />
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* NFT fallback from list summary when detail not loaded */}
            {nftTransfers.length === 0 && !detail && summary?.nft && summary.nft.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">NFT Transfers</div>
                    <div className="space-y-1.5">
                        {summary.nft.map((n, i) => {
                            const displayName = n.name || formatTokenName(n.collection);
                            const isOut = n.direction === 'out';
                            return (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                    <TokenIcon logo={n.logo} symbol={displayName} size={18} />
                                    <span className={`inline-flex items-center gap-0.5 font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                        {isOut ? 'Sent' : 'Received'}
                                    </span>
                                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{n.count}x</span>
                                    <span className="text-zinc-500">{displayName}</span>
                                    {n.counterparty && (
                                        <span className="text-zinc-400 text-[10px]">
                                            {isOut ? 'to' : 'from'}{' '}
                                            <AddressLink address={n.counterparty} size={14} onClick={(e) => e.stopPropagation()} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* DeFi Swap Events (from detail API) */}
            {defiEvents.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">DeFi Swaps</div>
                    <div className="space-y-2">
                        {defiEvents.map((de: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                                {/* Input side */}
                                <div className="inline-flex items-center gap-1">
                                    <TokenIcon logo={de.asset0_logo} symbol={de.asset0_symbol} size={16} />
                                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                                        {de.asset0_in && de.asset0_in !== '0' ? Number(de.asset0_in).toLocaleString(undefined, { maximumFractionDigits: 6 }) :
                                         de.asset0_out && de.asset0_out !== '0' ? Number(de.asset0_out).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0'}
                                    </span>
                                    <span className="text-zinc-500 text-[10px] uppercase font-medium">{de.asset0_symbol || ''}</span>
                                </div>
                                <ArrowRightLeft className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                                {/* Output side */}
                                <div className="inline-flex items-center gap-1">
                                    <TokenIcon logo={de.asset1_logo} symbol={de.asset1_symbol} size={16} />
                                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                                        {de.asset1_out && de.asset1_out !== '0' ? Number(de.asset1_out).toLocaleString(undefined, { maximumFractionDigits: 6 }) :
                                         de.asset1_in && de.asset1_in !== '0' ? Number(de.asset1_in).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0'}
                                    </span>
                                    <span className="text-zinc-500 text-[10px] uppercase font-medium">{de.asset1_symbol || ''}</span>
                                </div>
                                {/* DEX badge */}
                                {de.dex && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-sm border border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 uppercase font-medium">
                                        {de.dex}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Error state */}
            {error && !detail && (
                <div className="text-xs text-zinc-400">Failed to load details</div>
            )}

            {/* General tx info */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-zinc-500">
                {tx.gas_used != null && <span>Gas: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(tx.gas_used).toLocaleString()}</span></span>}
                {tx.fee != null && tx.fee > 0 && <span>Fee: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(tx.fee).toFixed(8)}</span></span>}
                {tx.block_height && <span>Block: <Link to={`/blocks/${tx.block_height}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{tx.block_height}</Link></span>}
                {tx.proposer && <span>Proposer: <AddressLink address={tx.proposer} size={12} onClick={(e) => e.stopPropagation()} /></span>}
                {tx.payer && tx.payer !== tx.proposer && <span>Payer: <AddressLink address={tx.payer} size={12} onClick={(e) => e.stopPropagation()} /></span>}
                {tx.contract_imports?.length > 0 && <span>Contracts: {tx.contract_imports.map((c: string, i: number) => (
                    <span key={c}>{i > 0 && ', '}<Link to={`/contracts/${c}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>{formatTokenName(c)}</Link></span>
                ))}</span>}
            </div>

            {/* NFT Detail Modal */}
            {selectedNft && (
                <NFTDetailModal
                    nft={selectedNft}
                    collectionId={selectedNftCollectionId}
                    collectionName={selectedNftCollectionName}
                    onClose={() => setSelectedNft(null)}
                />
            )}
        </div>
    );
}

// --- Activity Row ---

const tagStyles: Record<string, string> = {
    FT_TRANSFER:      'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10',
    FT_SENDER:        'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10',
    FT_RECEIVER:      'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10',
    NFT_TRANSFER:     'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10',
    NFT_SENDER:       'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10',
    NFT_RECEIVER:     'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10',
    SCHEDULED_TX:     'text-indigo-600 dark:text-indigo-400 border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10',
    EVM:              'text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10',
    CONTRACT_DEPLOY:  'text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10',
    ACCOUNT_CREATED:  'text-cyan-600 dark:text-cyan-400 border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10',
    KEY_UPDATE:       'text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10',
    MARKETPLACE:      'text-pink-600 dark:text-pink-400 border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10',
    STAKING:          'text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10',
    LIQUID_STAKING:   'text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10',
    SWAP:             'text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10',
    LIQUIDITY:        'text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10',
    TOKEN_MINT:       'text-lime-600 dark:text-lime-400 border-lime-300 dark:border-lime-500/30 bg-lime-50 dark:bg-lime-500/10',
    TOKEN_BURN:       'text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10',
};

const defaultTagStyle = 'text-zinc-500 dark:text-zinc-500 border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5';

const tagIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    FT_TRANSFER:      ArrowRightLeft,
    FT_SENDER:        ArrowUpRight,
    FT_RECEIVER:      ArrowDownLeft,
    NFT_TRANSFER:     ShoppingBag,
    NFT_SENDER:       ArrowUpRight,
    NFT_RECEIVER:     ArrowDownLeft,
    SCHEDULED_TX:     Clock,
    EVM:              Zap,
    CONTRACT_DEPLOY:  FileCode,
    ACCOUNT_CREATED:  UserPlus,
    KEY_UPDATE:       Key,
    MARKETPLACE:      ShoppingBag,
    STAKING:          Coins,
    LIQUID_STAKING:   Droplets,
    SWAP:             ArrowRightLeft,
    LIQUIDITY:        Droplets,
    TOKEN_MINT:       CircleDollarSign,
    TOKEN_BURN:       Flame,
};

function formatTagLabel(tag: string): string {
    return tag.replace(/_/g, ' ');
}

interface TransferPreviewItem {
    type: 'ft' | 'nft';
    icon: any;
    label: string;
    amount?: string;
    symbol?: string;
    count?: number;
}

function deriveTransferPreview(tx: any, tokenMeta?: Map<string, TokenMetaEntry>): TransferPreviewItem[] {
    const items: TransferPreviewItem[] = [];

    // Priority 1: rich ft_transfers / nft_transfers arrays
    if (tx.ft_transfers?.length > 0) {
        for (const ft of tx.ft_transfers) {
            if (items.length >= 3) break;
            const sym = ft.token_symbol || ft.token?.split('.').pop() || '';
            items.push({
                type: 'ft',
                icon: ft.token_logo || null,
                label: sym,
                amount: ft.amount != null ? Number(ft.amount).toLocaleString(undefined, { maximumFractionDigits: 4 }) : undefined,
                symbol: sym,
            });
        }
    }
    if (tx.nft_transfers?.length > 0) {
        // Group NFT transfers by collection
        const collMap = new Map<string, { count: number; icon: any; name: string }>();
        for (const nt of tx.nft_transfers) {
            const key = nt.token || nt.collection_name || 'NFT';
            const existing = collMap.get(key);
            if (existing) {
                existing.count++;
            } else {
                collMap.set(key, { count: 1, icon: nt.collection_logo || null, name: nt.collection_name || formatTokenName(nt.token || '') });
            }
        }
        for (const [, val] of collMap) {
            if (items.length >= 3) break;
            items.push({ type: 'nft', icon: val.icon, label: val.name, count: val.count });
        }
    }
    if (items.length > 0) return items;

    // Priority 2: transfer_summary
    const summary: TransferSummary | undefined = tx.transfer_summary;
    if (summary?.ft?.length) {
        for (const f of summary.ft) {
            if (items.length >= 3) break;
            const sym = f.symbol || f.name || formatTokenName(f.token);
            items.push({
                type: 'ft',
                icon: f.logo || null,
                label: sym,
                amount: f.amount ? Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 4 }) : undefined,
                symbol: sym,
            });
        }
    }
    if (summary?.nft?.length) {
        for (const n of summary.nft) {
            if (items.length >= 3) break;
            const name = n.name || formatTokenName(n.collection);
            items.push({ type: 'nft', icon: n.logo || null, label: name, count: n.count });
        }
    }
    if (items.length > 0) return items;

    // Priority 3: contract_imports + tokenMeta (labels only)
    if (tokenMeta && tokenMeta.size > 0) {
        const imports: string[] = tx.contract_imports || [];
        const seen = new Set<string>();
        for (const imp of imports) {
            if (items.length >= 3) break;
            if (seen.has(imp)) continue;
            const meta = tokenMeta.get(imp);
            if (meta) {
                seen.add(imp);
                items.push({
                    type: meta.type,
                    icon: meta.logo,
                    label: meta.symbol || meta.name || formatTokenName(imp),
                });
            }
        }
        if (items.length > 0) return items;
    }

    // Priority 4: tags hint — when tags say FT/NFT but no rich data available
    const tags: string[] = tx.tags || [];
    const tagsSet = new Set(tags);
    if (tagsSet.has('FT_TRANSFER') || tagsSet.has('FT_SENDER') || tagsSet.has('FT_RECEIVER')) {
        items.push({ type: 'ft', icon: null, label: 'Token Transfer' });
    }
    if (tagsSet.has('NFT_TRANSFER') || tagsSet.has('NFT_SENDER') || tagsSet.has('NFT_RECEIVER')) {
        items.push({ type: 'nft', icon: null, label: 'NFT Transfer' });
    }
    return items;
}

function findNftBannerImage(tx: any, tokenMeta?: Map<string, TokenMetaEntry>): string | null {
    if (!tokenMeta || tokenMeta.size === 0) return null;
    const imports: string[] = tx.contract_imports || [];
    for (const imp of imports) {
        const meta = tokenMeta.get(imp);
        if (meta?.type === 'nft' && meta.banner_image) return meta.banner_image;
    }
    return null;
}

export function ActivityRow({ tx, address = '', expanded, onToggle, tokenMeta }: { tx: any; address?: string; expanded: boolean; onToggle: () => void; tokenMeta?: Map<string, TokenMetaEntry> }) {
    const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';
    const tags: string[] = (tx.tags || []).filter((t: string) => t !== 'FEE');
    const hasDetails = true;
    const transferPreview = deriveTransferPreview(tx, tokenMeta);
    const bannerUrl = findNftBannerImage(tx, tokenMeta);

    return (
        <div className={`border-b border-zinc-100 dark:border-white/5 transition-colors ${expanded ? 'bg-zinc-50/50 dark:bg-white/[0.02]' : ''}`}>
            <div
                className={`relative overflow-hidden flex items-start gap-3 p-4 ${hasDetails ? 'cursor-pointer' : ''} hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group`}
                onClick={hasDetails ? onToggle : undefined}
            >
                {/* NFT banner gradient overlay */}
                {bannerUrl && !expanded && (
                    <div
                        className="absolute right-0 top-0 bottom-0 w-32 pointer-events-none opacity-[0.08] dark:opacity-[0.06]"
                        style={{
                            backgroundImage: `url(${bannerUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            maskImage: 'linear-gradient(to right, transparent, black)',
                            WebkitMaskImage: 'linear-gradient(to right, transparent, black)',
                        }}
                    />
                )}

                {/* Expand chevron */}
                <div className="flex-shrink-0 pt-1 w-4">
                    {hasDetails && (
                        expanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                            : <ChevronRight className="h-3.5 w-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
                    )}
                </div>

                {/* Col 2: Main content */}
                <div className="flex-1 min-w-0">
                    {/* Line 1: txid + tags + error */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link
                            to={`/tx/${tx.id}` as any}
                            className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-xs flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {formatShort(tx.id, 12, 8)}
                        </Link>
                        {/* Tags */}
                        {tags.map((tag) => {
                            const Icon = tagIcons[tag];
                            return (
                                <span
                                    key={tag}
                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 border rounded-sm text-[9px] font-bold uppercase tracking-wider ${tagStyles[tag] || defaultTagStyle}`}
                                >
                                    {Icon && <Icon className="h-2.5 w-2.5" />}
                                    {formatTagLabel(tag)}
                                </span>
                            );
                        })}
                        {/* Error badge (only for sealed-with-error, not normal status) */}
                        {(tx.error_message || tx.error) && tx.status === 'SEALED' && (
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-sm border font-semibold text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10">
                                ERROR
                            </span>
                        )}
                        {tx.status && tx.status !== 'SEALED' && (
                            <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded-sm border font-semibold ${
                                (tx.error_message || tx.error) || tx.status === 'EXPIRED'
                                    ? 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10'
                                    : 'text-yellow-600 dark:text-yellow-500 border-yellow-300 dark:border-yellow-500/30 bg-yellow-50 dark:bg-yellow-500/10'
                            }`}>
                                {tx.status}
                            </span>
                        )}
                    </div>
                    {/* Line 2: relative time + block link */}
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-400">
                        {timeStr && <span>{timeStr}</span>}
                        {timeStr && tx.block_height && <span>·</span>}
                        {tx.block_height && (
                            <Link
                                to={`/blocks/${tx.block_height}` as any}
                                className="font-mono hover:text-nothing-green-dark dark:hover:text-nothing-green hover:underline"
                                onClick={(e) => e.stopPropagation()}
                            >
                                Block {Number(tx.block_height).toLocaleString()}
                            </Link>
                        )}
                    </div>
                </div>

                {/* Col 3: Transfer preview as avatar group (right-aligned) */}
                {transferPreview.length > 0 && (
                    <div className="flex-shrink-0 relative z-[1]" onClick={(e) => e.stopPropagation()}>
                        <AvatarGroup className="h-7 -space-x-2">
                            {transferPreview.map((item, i) => {
                                const logoUrl = extractLogoUrl(item.icon);
                                const fallbackChar = (item.symbol || item.label || '?')[0].toUpperCase();
                                const tooltipText = item.type === 'ft'
                                    ? (item.amount ? `${item.amount} ${item.label}` : item.label)
                                    : (item.count != null ? `${item.label} ×${item.count}` : item.label);
                                return (
                                    <Avatar key={i} className="h-7 w-7 border-2 border-white dark:border-zinc-900">
                                        {logoUrl && <AvatarImage src={logoUrl} alt={item.label} />}
                                        <AvatarFallback className="text-[9px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                                            {fallbackChar}
                                        </AvatarFallback>
                                        <AvatarGroupTooltip>{tooltipText}</AvatarGroupTooltip>
                                    </Avatar>
                                );
                            })}
                        </AvatarGroup>
                    </div>
                )}
            </div>

            {/* Expanded detail panel */}
            {expanded && hasDetails && (
                <ExpandedTransferDetails tx={tx} address={address} expanded={expanded} />
            )}
        </div>
    );
}

// --- Dedup helper ---

export function dedup(txs: any[]): any[] {
    const seen = new Set<string>();
    return txs.filter(tx => {
        // Use id+block_height as key: system transactions reuse the same id across blocks
        const key = tx.id ? `${tx.id}:${tx.block_height ?? tx.blockHeight ?? ''}` : '';
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
