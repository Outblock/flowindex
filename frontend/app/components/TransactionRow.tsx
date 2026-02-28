import { useState, useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, FileCode, Zap, Box, UserPlus, Key, ShoppingBag, Clock, ChevronDown, ChevronRight, ExternalLink, Flame, Droplets, CircleDollarSign, Coins, Loader2, Fuel, Receipt, Layers, User, Users, Wallet, Shield, Image as ImageIcon } from 'lucide-react';
import { formatShort, resolveIPFS } from './account/accountUtils';
import { AddressLink } from './AddressLink';
import { formatRelativeTime } from '../lib/time';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { AvatarGroup, AvatarGroupTooltip } from '@/components/animate-ui/components/animate/avatar-group';
import { resolveApiBaseUrl } from '../api';
import { deriveEnrichments } from '../lib/deriveFromEvents';
import { cadenceService } from '../fclConfig';
import { NFTDetailModal } from './NFTDetailModal';
import { UsdValue } from './UsdValue';

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
    // Import-derived categories (from enrichWithScriptImports)
    token_transfer:   { type: 'ft', label: 'Token Transfer', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10' },
    nft:              { type: 'nft', label: 'NFT', color: 'text-amber-600 dark:text-amber-400', bgColor: 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' },
    marketplace:      { type: 'marketplace', label: 'Marketplace', color: 'text-pink-600 dark:text-pink-400', bgColor: 'border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10' },
    staking:          { type: 'ft', label: 'Staking', color: 'text-violet-600 dark:text-violet-400', bgColor: 'border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10' },
    evm:              { type: 'evm', label: 'EVM', color: 'text-purple-600 dark:text-purple-400', bgColor: 'border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10' },
    defi:             { type: 'swap', label: 'DeFi', color: 'text-teal-600 dark:text-teal-400', bgColor: 'border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10' },
    account_linking:  { type: 'account', label: 'Account Link', color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10' },
    account_creation: { type: 'account', label: 'New Account', color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10' },
    contract_call:    { type: 'contract', label: 'Contract Call', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' },
    crypto:           { type: 'contract', label: 'Crypto', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' },
    system:           { type: 'contract', label: 'System', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' },
};

function mapTemplateCategoryToActivity(category: string, _templateLabel?: string): { type: string; label: string; color: string; bgColor: string } | null {
    // Support comma-separated multi-categories — use first match for badge styling
    const cats = category.split(',').map(c => c.trim()).filter(Boolean);
    for (const cat of cats) {
        const style = templateCategoryStyles[cat];
        if (style) {
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

    // Derived ft_transfers (from deriveEnrichments or detail API)
    if (tx.ft_transfers?.length > 0) {
        const parts = tx.ft_transfers.slice(0, 3).map((ft: any) => {
            const displayName = ft.token_symbol || formatTokenName(ft.token || '');
            const typeLabel = ft.transfer_type === 'mint' ? 'Minted' : ft.transfer_type === 'burn' ? 'Burned' : 'Transferred';
            return `${typeLabel} ${Number(ft.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${displayName}`;
        });
        return parts.join(', ');
    }
    if (tx.nft_transfers?.length > 0) {
        const parts = tx.nft_transfers.slice(0, 3).map((nt: any) => {
            const displayName = nt.collection_name || formatTokenName(nt.token || '');
            const typeLabel = nt.transfer_type === 'mint' ? 'Minted' : nt.transfer_type === 'burn' ? 'Burned' : 'Transferred';
            return `${typeLabel} ${displayName} #${nt.token_id ?? ''}`;
        });
        return parts.join(', ');
    }

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
const txDetailCache = new Map<string, any>();

// --- NFT detail cache (shared across all rows) ---
// Stores full cadence detail for modal use; thumbnail/name is a subset
const nftDetailCache = new Map<string, Record<string, any> | null>();
const nftThumbnailCache = new Map<string, { thumbnail: string; name: string } | null>();

/** Try cadence script to fetch NFT detail from a specific owner. Returns cadence detail or null. */
async function tryCadenceFetch(token: string, tokenId: string, owner: string, parts: string[]): Promise<Record<string, any> | null> {
    const contractName = parts[2];
    const pathCandidates = [
        `${contractName}Collection`,
        `${contractName}`,
        `${contractName[0].toLowerCase()}${contractName.slice(1)}Collection`,
    ];
    const addr = owner.startsWith('0x') ? owner : `0x${owner}`;
    for (const pathId of pathCandidates) {
        try {
            const result = await cadenceService.getNftDetail(addr, pathId, [Number(tokenId)]);
            if (result && result.length > 0 && result[0]?.thumbnail) {
                const detail = result[0];
                const cacheKey = `${token}:${tokenId}`;
                nftDetailCache.set(cacheKey, detail);
                const thumb = resolveIPFS(String(detail.thumbnail));
                const name = detail.name ? String(detail.name) : '';
                nftThumbnailCache.set(cacheKey, { thumbnail: thumb, name });
                // Fire-and-forget backfill to backend
                resolveApiBaseUrl().then(baseUrl => {
                    fetch(`${baseUrl}/flow/nft/backfill`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([{
                            contract_address: parts[1],
                            contract_name: contractName,
                            nft_id: String(tokenId),
                            name: name,
                            thumbnail: thumb,
                        }]),
                    }).catch(() => {});
                });
                return detail;
            }
        } catch { /* try next path candidate */ }
    }
    return null;
}

/** Fetch full NFT detail via cadence script (for modal). Returns cadence-format object. */
export async function fetchNFTFullDetail(token: string, tokenId: string, ownerAddress: string): Promise<Record<string, any> | null> {
    const cacheKey = `${token}:${tokenId}`;
    if (nftDetailCache.has(cacheKey)) return nftDetailCache.get(cacheKey) || null;

    const parts = token.split('.');

    // 1. Try cadence with the provided owner (e.g. to_address from the transfer)
    if (parts.length >= 3 && ownerAddress) {
        const result = await tryCadenceFetch(token, tokenId, ownerAddress, parts);
        if (result) return result;
    }

    // 2. Fallback: backend API — may have metadata, or at least the current owner
    let currentOwner: string | null = null;
    try {
        const baseUrl = await resolveApiBaseUrl();
        const res = await fetch(`${baseUrl}/flow/nft/${encodeURIComponent(token)}/item/${encodeURIComponent(tokenId)}`);
        if (res.ok) {
            const json = await res.json();
            const item = json.data?.[0];
            if (item?.thumbnail) {
                const detail: Record<string, any> = {
                    tokenId: tokenId,
                    thumbnail: resolveIPFS(item.thumbnail),
                    name: item.name || '',
                    ...(item.serial_number != null && { serial: item.serial_number }),
                    ...(item.traits && { traits: item.traits }),
                    ...(item.rarity_description && { rarity: item.rarity_description }),
                    ...(item.external_url && { externalURL: item.external_url }),
                };
                nftDetailCache.set(cacheKey, detail);
                nftThumbnailCache.set(cacheKey, { thumbnail: detail.thumbnail, name: detail.name });
                return detail;
            }
            // No metadata but has current owner — try cadence with that owner
            if (item?.owner) currentOwner = item.owner;
        }
    } catch { /* ignore */ }

    // 3. Retry cadence with the current owner from backend (NFT may have been transferred since tx)
    if (parts.length >= 3 && currentOwner && currentOwner !== ownerAddress) {
        const result = await tryCadenceFetch(token, tokenId, currentOwner, parts);
        if (result) return result;
    }

    nftDetailCache.set(cacheKey, null);
    return null;
}

async function fetchNFTThumbnail(token: string, tokenId: string, ownerAddress: string): Promise<{ thumbnail: string; name: string } | null> {
    const cacheKey = `${token}:${tokenId}`;
    if (nftThumbnailCache.has(cacheKey)) return nftThumbnailCache.get(cacheKey) || null;
    // Delegate to full detail fetch which populates thumbnail cache
    const detail = await fetchNFTFullDetail(token, tokenId, ownerAddress);
    return detail ? (nftThumbnailCache.get(cacheKey) || null) : null;
}

/** Hook: lazy-load NFT detail (thumbnail + name) via cadence when API data is missing */
export function useNFTLazyDetail(nft: { nft_thumbnail?: string; nft_name?: string; collection_logo?: string; token?: string; token_id?: string | number; from_address?: string; to_address?: string; transfer_type?: string }) {
    const thumbUrl = nft.nft_thumbnail ? resolveIPFS(String(nft.nft_thumbnail)) : null;
    const logoUrl = nft.collection_logo ? resolveIPFS(String(nft.collection_logo)) : null;

    const [fetched, setFetched] = useState<{ thumbnail: string; name: string } | null>(null);
    const [loading, setLoading] = useState(!thumbUrl);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (thumbUrl || fetchedRef.current) { setLoading(false); return; }
        fetchedRef.current = true;
        const token = nft.token || '';
        const tokenId = String(nft.token_id ?? '');
        const owner = nft.transfer_type === 'burn' ? nft.from_address : nft.to_address;
        if (!token || !tokenId || !owner) { setLoading(false); return; }
        fetchNFTThumbnail(token, tokenId, owner).then(r => {
            setFetched(r);
            setLoading(false);
        });
    }, [nft.token, nft.token_id, nft.from_address, nft.to_address, thumbUrl]);

    return {
        thumbnailSrc: thumbUrl || fetched?.thumbnail || logoUrl,
        displayName: fetched?.name || nft.nft_name || '',
        loading,
    };
}

/** Reusable NFT image that lazy-loads thumbnail via cadence when API data is missing */
export function NFTTransferImage({ nft, size = 48, onClick, className = '' }: {
    nft: { nft_thumbnail?: string; collection_logo?: string; token?: string; token_id?: string | number; from_address?: string; to_address?: string; transfer_type?: string };
    size?: number;
    onClick?: () => void;
    className?: string;
}) {
    const { thumbnailSrc: src, loading } = useNFTLazyDetail(nft);
    const cursor = onClick ? 'cursor-pointer' : '';

    if (loading) {
        return (
            <div style={{ width: size, height: size }} className={`rounded bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center animate-pulse ${cursor} ${className}`} onClick={onClick}>
                <ImageIcon style={{ width: size * 0.3, height: size * 0.3 }} className="text-purple-500" />
            </div>
        );
    }

    if (src) {
        return (
            <img
                src={src}
                alt=""
                style={{ width: size, height: size }}
                className={`rounded border border-zinc-200 dark:border-white/10 object-cover ${cursor} ${className}`}
                onClick={onClick}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
        );
    }

    return (
        <div style={{ width: size, height: size }} className={`rounded bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center ${cursor} ${className}`} onClick={onClick}>
            <ImageIcon style={{ width: size * 0.3, height: size * 0.3 }} className="text-purple-500" />
        </div>
    );
}

/** NFT thumbnail card — fetches thumbnail lazily, clickable to open detail modal */
function NFTThumbnailCard({ token, tokenId, displayName, ownerAddress, isMint, isBurn }: {
    token: string; tokenId: string; displayName: string; ownerAddress: string;
    isMint?: boolean; isBurn?: boolean;
}) {
    const [thumb, setThumb] = useState<{ thumbnail: string; name: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (fetchedRef.current) return;
        fetchedRef.current = true;
        const cached = nftThumbnailCache.get(`${token}:${tokenId}`);
        if (cached !== undefined) {
            setThumb(cached);
            setLoading(false);
            return;
        }
        fetchNFTThumbnail(token, tokenId, ownerAddress).then(r => {
            setThumb(r);
            setLoading(false);
        });
    }, [token, tokenId, ownerAddress]);

    const nftName = thumb?.name || displayName;

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        // Fetch full detail for modal (uses cache if available)
        await fetchNFTFullDetail(token, tokenId, ownerAddress);
        setShowModal(true);
    };

    // Build cadence-format nft object for modal
    const modalNft = showModal ? (() => {
        const detail = nftDetailCache.get(`${token}:${tokenId}`);
        if (detail) return { ...detail, tokenId };
        // Fallback: minimal object
        return {
            tokenId,
            name: nftName,
            thumbnail: thumb?.thumbnail || '',
        };
    })() : null;

    return (
        <>
            <div className="flex-shrink-0 w-[96px] group/nft cursor-pointer" onClick={handleClick}>
                {/* Thumbnail */}
                <div className="w-[96px] h-[96px] rounded-lg overflow-hidden bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 relative group-hover/nft:border-purple-400 dark:group-hover/nft:border-purple-500/50 transition-colors">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                            <ImageIcon className="w-6 h-6 text-zinc-300 dark:text-zinc-700" />
                        </div>
                    )}
                    {!loading && thumb?.thumbnail ? (
                        <img
                            src={thumb.thumbnail}
                            alt={nftName}
                            className="w-full h-full object-cover group-hover/nft:scale-105 transition-transform"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    ) : !loading ? (
                        <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-6 h-6 text-zinc-300 dark:text-zinc-700" />
                        </div>
                    ) : null}
                    {/* MINT / BURN badge overlay */}
                    {isMint && (
                        <span className="absolute top-1 left-1 text-[8px] px-1 py-px rounded bg-lime-500/90 text-white font-bold">MINT</span>
                    )}
                    {isBurn && (
                        <span className="absolute top-1 left-1 text-[8px] px-1 py-px rounded bg-red-500/90 text-white font-bold">BURN</span>
                    )}
                </div>
                {/* Label */}
                <div className="mt-1.5 text-center">
                    <div className="text-[10px] text-zinc-600 dark:text-zinc-300 truncate font-medium" title={nftName}>{nftName}</div>
                    <div className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500 truncate" title={`#${tokenId}`}>#{tokenId}</div>
                </div>
            </div>
            {showModal && modalNft && (
                <NFTDetailModal
                    nft={modalNft}
                    collectionId={token}
                    collectionName={displayName}
                    onClose={() => setShowModal(false)}
                />
            )}
        </>
    );
}

// --- Expanded Detail Panel (fetches per-tx data on expand) ---

export function ExpandedTransferDetails({ tx, address: currentAddress }: { tx: any; address: string; expanded?: boolean }) {
    const [detail, setDetail] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (fetchedRef.current) return;
        const cached = txDetailCache.get(tx.id);
        if (cached) { setDetail(cached); return; }
        let cancelled = false;
        setLoading(true);
        fetchedRef.current = true;
        (async () => {
            try {
                const baseUrl = await resolveApiBaseUrl();
                const res = await fetch(`${baseUrl}/flow/transaction/${encodeURIComponent(tx.id)}?lite=true`);
                if (!res.ok) throw new Error('fetch failed');
                const json = await res.json();
                const d = json.data?.[0];
                if (d && !cancelled) {
                    const derived = deriveEnrichments(d.events || [], d.script);
                    // Enrich derived ft_transfers with logo/symbol/name from transfer_summary
                    const summaryFT: any[] = tx.transfer_summary?.ft || [];
                    if (summaryFT.length > 0 && derived.ft_transfers.length > 0) {
                        const metaByToken = new Map<string, { logo?: string; symbol?: string; name?: string; usd_price?: number }>();
                        for (const sf of summaryFT) {
                            if (sf.token) metaByToken.set(sf.token, { logo: sf.logo, symbol: sf.symbol, name: sf.name, usd_price: sf.usd_price });
                        }
                        for (const ft of derived.ft_transfers) {
                            const meta = metaByToken.get(ft.token);
                            if (meta) {
                                if (meta.logo && !ft.token_logo) ft.token_logo = meta.logo;
                                if (meta.symbol && !ft.token_symbol) ft.token_symbol = meta.symbol;
                                if (meta.name && !ft.token_name) ft.token_name = meta.name;
                                if (meta.usd_price && !ft.usd_value) ft.usd_value = Number(ft.amount) * meta.usd_price;
                            }
                        }
                    }
                    const enriched = {
                        ...d,
                        ft_transfers: derived.ft_transfers,
                        nft_transfers: derived.nft_transfers,
                        evm_executions: derived.evm_executions,
                        fee: derived.fee,
                        contract_imports: derived.contract_imports.length > 0 ? derived.contract_imports : d.contract_imports,
                    };
                    txDetailCache.set(tx.id, enriched);
                    setDetail(enriched);
                }
            } catch { /* ignore */ }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [tx.id]);

    const merged = detail || tx;
    const ftTransfers: any[] = merged.ft_transfers || [];
    const nftTransfers: any[] = merged.nft_transfers || [];
    const defiEvents: any[] = merged.defi_events || [];
    const evmExecs: any[] = merged.evm_executions || [];
    const summary: TransferSummary | undefined = merged.transfer_summary || tx.transfer_summary;
    const tags: string[] = tx.tags || [];
    const tagsLower = tags.map((t: string) => t.toLowerCase());
    const summaryLine = buildSummaryLine(detail ? { ...tx, ft_transfers: ftTransfers, nft_transfers: nftTransfers, contract_imports: detail.contract_imports || tx.contract_imports } : tx);
    const evmHash = merged.evm_hash || tx.evm_hash;

    const hasFTDetail = ftTransfers.length > 0;
    const hasNFTDetail = nftTransfers.length > 0;

    // Normalize address for comparison (strip 0x, lowercase)
    const normalizeAddr = (a: string) => a?.replace(/^0x/, '').toLowerCase() || '';
    const isCurrentAddress = (addr: string) => normalizeAddr(addr) === normalizeAddr(currentAddress);

    // Helper: render address with "(this account)" tag
    const AddressWithTag = ({ addr, size = 14 }: { addr: string; size?: number }) => (
        <span className="inline-flex items-center gap-1">
            <AddressLink address={addr} size={size} onClick={(e) => e.stopPropagation()} />
            {isCurrentAddress(addr) && (
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 italic">this account</span>
            )}
        </span>
    );

    // Collect signers: group roles by address for compact display
    const rolesByAddr = new Map<string, string[]>();
    const addRole = (addr: string, role: string) => {
        if (!addr) return;
        const key = normalizeAddr(addr);
        const roles = rolesByAddr.get(key) || [];
        if (!roles.includes(role)) roles.push(role);
        rolesByAddr.set(key, roles);
    };
    if (tx.proposer) addRole(tx.proposer, 'Proposer');
    if (tx.payer) addRole(tx.payer, 'Payer');
    const authorizers: string[] = tx.authorizers || merged.authorizers || [];
    for (const auth of authorizers) {
        addRole(auth, 'Authorizer');
    }
    // Build display list with original-cased addresses
    const addrMap = new Map<string, string>(); // normalized → original
    if (tx.proposer) addrMap.set(normalizeAddr(tx.proposer), tx.proposer);
    if (tx.payer) addrMap.set(normalizeAddr(tx.payer), tx.payer);
    for (const auth of authorizers) addrMap.set(normalizeAddr(auth), auth);

    const signers = Array.from(rolesByAddr.entries()).map(([norm, roles]) => ({
        addr: addrMap.get(norm) || norm,
        roles,
    }));
    const isMultiSign = authorizers.length > 1;

    return (
        <div className="px-4 sm:px-6 pb-4 pt-1 ml-7 sm:ml-[88px] space-y-3">
            {/* Loading indicator */}
            {loading && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Loading details...</span>
                </div>
            )}

            {/* Summary line */}
            {summaryLine && (
                <div className="text-xs text-zinc-600 dark:text-zinc-400">{summaryLine}</div>
            )}

            {/* EVM Hash */}
            {(tx.is_evm || evmHash) && evmHash && (
                <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20">
                    <Zap className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                    <a
                        href={`https://evm.flowindex.io/tx/0x${evmHash.replace(/^0x/i, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        0x{formatShort(evmHash.replace(/^0x/i, ''), 16, 12)}
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
            )}

            {/* Account Creation tag */}
            {tagsLower.some(t => t.includes('account_created')) && (
                <div className="flex items-center gap-2 text-xs">
                    <UserPlus className="h-3 w-3 text-cyan-500" />
                    <span className="text-zinc-500">Created new account</span>
                </div>
            )}

            {/* FT Transfers from detail API (preferred) */}
            {hasFTDetail && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Token Transfers</div>
                    <div className="space-y-1.5">
                        {ftTransfers.map((ft: any, i: number) => {
                            const displayName = ft.token_symbol || ft.token_name || formatTokenName(ft.token || '');
                            const isMint = ft.transfer_type === 'mint';
                            const isBurn = ft.transfer_type === 'burn';
                            return (
                                <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                                    <TokenIcon logo={ft.token_logo} symbol={displayName} size={18} />
                                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                                        {Number(ft.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                    </span>
                                    <span className="text-zinc-500">{displayName}</span>
                                    {ft.usd_value > 0 && <UsdValue value={ft.usd_value} className="text-[10px]" />}
                                    {isMint && <span className="text-[9px] px-1 py-0.5 rounded border border-lime-300 dark:border-lime-500/30 text-lime-600 dark:text-lime-400 bg-lime-50 dark:bg-lime-500/10 font-semibold">MINT</span>}
                                    {isBurn && <span className="text-[9px] px-1 py-0.5 rounded border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 font-semibold">BURN</span>}
                                    {ft.from_address && ft.to_address && (
                                        <span className="text-zinc-400 text-[10px] inline-flex items-center gap-1 flex-wrap">
                                            <AddressWithTag addr={ft.evm_from_address || ft.from_address} />
                                            {ft.evm_from_address && <span className="text-[8px] text-purple-400">EVM</span>}
                                            <span>→</span>
                                            <AddressWithTag addr={ft.evm_to_address || ft.to_address} />
                                            {ft.evm_to_address && <span className="text-[8px] text-purple-400">EVM</span>}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* FT Transfers from summary (fallback when no detail) */}
            {!hasFTDetail && summary?.ft && summary.ft.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Token Transfers</div>
                    <div className="space-y-1.5">
                        {summary.ft.map((f, i) => {
                            const displayName = f.symbol || f.name || formatTokenName(f.token);
                            const isOut = f.direction === 'out';
                            const isTransfer = f.direction === 'transfer';
                            const [cpFrom, cpTo] = isTransfer && f.counterparty ? f.counterparty.split('>') : [undefined, undefined];
                            return (
                                <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                                    <TokenIcon logo={f.logo} symbol={displayName} size={18} />
                                    {isTransfer ? (
                                        <span className="inline-flex items-center gap-0.5 font-medium text-blue-500">
                                            <ArrowRightLeft className="h-3 w-3" />Transfer
                                        </span>
                                    ) : (
                                        <span className={`inline-flex items-center gap-0.5 font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                            {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                            {isOut ? 'Sent' : 'Received'}
                                        </span>
                                    )}
                                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                                        {Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                    </span>
                                    <span className="text-zinc-500">{displayName}</span>
                                    {isTransfer && cpFrom && cpTo ? (
                                        <span className="text-zinc-400 text-[10px] inline-flex items-center gap-1">
                                            <AddressWithTag addr={cpFrom} />
                                            <span>→</span>
                                            <AddressWithTag addr={cpTo} />
                                        </span>
                                    ) : f.counterparty && !isTransfer ? (
                                        <span className="text-zinc-400 text-[10px]">
                                            {isOut ? 'to' : 'from'}{' '}
                                            <AddressWithTag addr={f.counterparty} />
                                        </span>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* NFT Transfers — horizontal thumbnail cards */}
            {(hasNFTDetail || (summary?.nft && summary.nft.length > 0)) && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">NFT Transfers</div>
                    {/* Thumbnail row */}
                    <div className="flex gap-3 overflow-x-auto pb-1">
                        {hasNFTDetail ? nftTransfers.map((nt: any, i: number) => {
                            const displayName = nt.collection_name || formatTokenName(nt.token || '');
                            // Owner for thumbnail fetch: to_address for transfers/mints, from_address for burns
                            const owner = nt.transfer_type === 'burn' ? nt.from_address : nt.to_address;
                            return (
                                <NFTThumbnailCard
                                    key={i}
                                    token={nt.token || ''}
                                    tokenId={String(nt.token_id ?? '')}
                                    displayName={displayName}
                                    ownerAddress={owner || currentAddress}
                                    isMint={nt.transfer_type === 'mint'}
                                    isBurn={nt.transfer_type === 'burn'}
                                />
                            );
                        }) : summary!.nft.map((n, i) => (
                            <NFTThumbnailCard
                                key={i}
                                token={n.collection || ''}
                                tokenId={String(i)}
                                displayName={n.name || formatTokenName(n.collection)}
                                ownerAddress={currentAddress}
                                isMint={false}
                                isBurn={false}
                            />
                        ))}
                    </div>
                    {/* Address flow under thumbnails */}
                    {hasNFTDetail && nftTransfers.some((nt: any) => nt.from_address && nt.to_address) && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-400">
                            {(() => {
                                const first = nftTransfers.find((nt: any) => nt.from_address && nt.to_address);
                                if (!first) return null;
                                return (
                                    <>
                                        <AddressWithTag addr={first.from_address} />
                                        <span>→</span>
                                        <AddressWithTag addr={first.to_address} />
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>
            )}

            {/* DeFi Events */}
            {defiEvents.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">DeFi Events</div>
                    <div className="space-y-1.5">
                        {defiEvents.map((de: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                                <Repeat className="h-3 w-3 text-teal-500" />
                                <span className="font-medium text-teal-600 dark:text-teal-400">{de.event_type || 'Swap'}</span>
                                {de.asset0_symbol && de.asset1_symbol && (
                                    <span className="text-zinc-500">{de.asset0_symbol}/{de.asset1_symbol}</span>
                                )}
                                <span className="text-zinc-400 text-[10px]">{de.dex || ''}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* EVM Executions */}
            {evmExecs.length > 0 && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">EVM Executions</div>
                    <div className="space-y-2">
                        {evmExecs.map((exec: any, i: number) => (
                            <div key={i} className="flex flex-col gap-1 px-2.5 py-1.5 rounded-md bg-purple-50/50 dark:bg-purple-500/5 border border-purple-100 dark:border-purple-500/10">
                                {exec.hash && (
                                    <a
                                        href={`https://evm.flowindex.io/tx/0x${exec.hash.replace(/^0x/i, '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono text-xs text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1 w-fit"
                                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                    >
                                        <Zap className="h-3 w-3 flex-shrink-0" />
                                        0x{formatShort(exec.hash.replace(/^0x/i, ''), 10, 8)}
                                        <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                )}
                                <div className="flex items-center gap-1 text-[10px] text-zinc-400 flex-wrap">
                                    {exec.from && <AddressWithTag addr={exec.from} />}
                                    {exec.from && exec.to && <span>→</span>}
                                    {exec.to && <AddressWithTag addr={exec.to} />}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Transaction metadata - two rows with clear separation */}
            <div className="border-t border-zinc-100 dark:border-white/5 pt-2.5 space-y-2">
                {/* Row 1: Gas / Fee / Block */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
                    {tx.gas_used != null && (
                        <span className="inline-flex items-center gap-1">
                            <Fuel className="h-3 w-3 text-zinc-400" />
                            <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(tx.gas_used).toLocaleString()}</span>
                        </span>
                    )}
                    {tx.fee != null && tx.fee > 0 && (
                        <span className="inline-flex items-center gap-1">
                            <Receipt className="h-3 w-3 text-zinc-400" />
                            <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(tx.fee).toFixed(8)} FLOW</span>
                        </span>
                    )}
                    {tx.block_height && (
                        <span className="inline-flex items-center gap-1">
                            <Layers className="h-3 w-3 text-zinc-400" />
                            <Link to={`/blocks/${tx.block_height}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                {Number(tx.block_height).toLocaleString()}
                            </Link>
                        </span>
                    )}
                </div>

                {/* Row 2: Signers (Proposer / Payer / Authorizer) */}
                {signers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
                        {isMultiSign && (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <Users className="h-3 w-3" />
                                <span className="font-medium text-[10px]">Multi-Sign</span>
                            </span>
                        )}
                        {signers.map((s, i) => {
                            const roleIcon = s.roles.includes('Proposer') ? <User className="h-3 w-3" />
                                : s.roles.includes('Payer') ? <Wallet className="h-3 w-3" />
                                : <Shield className="h-3 w-3" />;
                            return (
                                <span key={i} className="inline-flex items-center gap-1">
                                    <span className="text-zinc-400">{roleIcon}</span>
                                    <span className="text-zinc-500 text-[10px]">{s.roles.join(' / ')}</span>
                                    <AddressWithTag addr={s.addr} size={12} />
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
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

    // Priority 4: tags hint — derive label from contract_imports names
    const tags: string[] = tx.tags || [];
    const tagsSet = new Set(tags);
    const imports: string[] = tx.contract_imports || [];
    // Extract readable contract names (e.g. "A.xxx.FlowToken" → "FlowToken")
    const contractNames = imports.map(c => formatTokenName(c)).filter(n => n && n !== 'Crypto' && n !== 'FungibleToken' && n !== 'NonFungibleToken');
    if (tagsSet.has('FT_TRANSFER') || tagsSet.has('FT_SENDER') || tagsSet.has('FT_RECEIVER')) {
        const label = contractNames[0] || 'FT';
        items.push({ type: 'ft', icon: null, label });
    }
    if (tagsSet.has('NFT_TRANSFER') || tagsSet.has('NFT_SENDER') || tagsSet.has('NFT_RECEIVER')) {
        const label = contractNames[0] || 'NFT';
        items.push({ type: 'nft', icon: null, label });
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
    const tags: string[] = tx.tags || [];
    const activity = deriveActivityType(tx);
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
                        className="absolute right-0 top-0 bottom-0 w-40 pointer-events-none opacity-[0.18] dark:opacity-[0.12]"
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
                            to={`/txs/${tx.id}` as any}
                            className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-xs flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {formatShort(tx.id, 12, 8)}
                        </Link>
                        {/* Tags */}
                        {tags.length > 0 ? tags.map((tag) => {
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
                        }) : activity.type !== 'tx' && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 border rounded-sm text-[9px] font-bold uppercase tracking-wider ${activity.bgColor} ${activity.color}`}>
                                {activity.label}
                            </span>
                        )}
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

                {/* Col 3: Label + Transfer preview (right-aligned, vertically centered) */}
                {tx.template_label && tx.template_label !== activity.label && (
                    <span className={`flex-shrink-0 self-center text-[10px] font-medium truncate max-w-[180px] ${activity.color}`} title={tx.template_label}>
                        {tx.template_label}
                    </span>
                )}
                {transferPreview.length > 0 && (
                    <div className="flex-shrink-0 self-center relative z-[1]" onClick={(e) => e.stopPropagation()}>
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
