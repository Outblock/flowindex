import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { resolveApiBaseUrl } from '../../api';
import {
    getFlowV1AccountByAddressTransaction,
    getFlowV1AccountByAddressFtTransfer,
    getFlowV1NftTransfer,
} from '../../api/gen/find';
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, FileCode, Zap, Box, UserPlus, Key, ShoppingBag, Clock, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { normalizeAddress, formatShort } from './accountUtils';
import { formatRelativeTime } from '../../lib/time';

interface Props {
    address: string;
    initialTransactions: any[];
    initialNextCursor?: string;
}

type FilterMode = 'all' | 'ft' | 'nft' | 'scheduled';

interface FTSummaryItem {
    token: string;
    amount: string;
    direction: string;
    counterparty?: string;
    symbol?: string;
    name?: string;
    logo?: any;
}

interface NFTSummaryItem {
    collection: string;
    count: number;
    direction: string;
    counterparty?: string;
    name?: string;
    logo?: any;
}

interface TransferSummary {
    ft: FTSummaryItem[];
    nft: NFTSummaryItem[];
}

function deriveActivityType(tx: any): { type: string; label: string; color: string; bgColor: string } {
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
    if (tagsLower.some(t => t.includes('evm')) || importsLower.some(c => c.includes('evm'))) {
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
    if (imports.length > 0) {
        return { type: 'contract', label: 'Contract Call', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' };
    }
    return { type: 'tx', label: 'Transaction', color: 'text-zinc-500 dark:text-zinc-500', bgColor: 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5' };
}

function formatTokenName(identifier: string): string {
    if (!identifier) return '';
    const parts = identifier.split('.');
    return parts.length >= 3 ? parts[2] : identifier;
}

function extractLogoUrl(logo: any): string | null {
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

function TokenIcon({ logo, symbol, size = 16 }: { logo?: any; symbol?: string; size?: number }) {
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

function buildSummaryLine(tx: any): string {
    const summary: TransferSummary | undefined = tx.transfer_summary;
    const imports: string[] = tx.contract_imports || [];
    const tags: string[] = tx.tags || [];
    const tagsLower = tags.map(t => t.toLowerCase());

    if (tagsLower.some(t => t.includes('account_created'))) return 'Created new account';
    if (tagsLower.some(t => t.includes('key_update'))) return 'Updated account key';

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

    if (imports.length > 0) {
        const contractNames = imports.slice(0, 3).map(c => formatTokenName(c)).filter(Boolean);
        const suffix = imports.length > 3 ? ` +${imports.length - 3} more` : '';
        return `Called ${contractNames.join(', ')}${suffix}`;
    }

    return '';
}

// --- Expanded Detail Panel ---

function ExpandedTransferDetails({ tx, address }: { tx: any; address: string }) {
    const summary: TransferSummary | undefined = tx.transfer_summary;
    const hasFT = summary?.ft && summary.ft.length > 0;
    const hasNFT = summary?.nft && summary.nft.length > 0;
    const isEVM = tx.is_evm || tx.evm_hash;

    return (
        <div className="px-4 pb-4 pt-1 ml-[88px] space-y-3">
            {/* EVM info */}
            {isEVM && tx.evm_hash && (
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500 uppercase tracking-wider text-[10px] w-20 flex-shrink-0">EVM Hash</span>
                    <Link to={`/transactions/${tx.evm_hash}` as any} className="font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
                        {formatShort(tx.evm_hash, 16, 12)}
                        <ExternalLink className="h-3 w-3" />
                    </Link>
                    {tx.evm_from && (
                        <>
                            <span className="text-zinc-400 mx-1">from</span>
                            <Link to={`/accounts/${tx.evm_from}` as any} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                {formatShort(tx.evm_from, 8, 6)}
                            </Link>
                        </>
                    )}
                    {tx.evm_to && (
                        <>
                            <span className="text-zinc-400 mx-1">&rarr;</span>
                            <Link to={`/accounts/${tx.evm_to}` as any} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                {formatShort(tx.evm_to, 8, 6)}
                            </Link>
                        </>
                    )}
                </div>
            )}

            {/* FT Transfer details */}
            {hasFT && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Token Transfers</div>
                    <div className="space-y-1.5">
                        {summary!.ft.map((f, i) => {
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
                                            <Link to={`/accounts/${f.counterparty}` as any} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                                {formatShort(f.counterparty)}
                                            </Link>
                                        </span>
                                    )}
                                    <span className="text-zinc-400 text-[10px] font-mono ml-auto">{f.token}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* NFT Transfer details */}
            {hasNFT && (
                <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">NFT Transfers</div>
                    <div className="space-y-1.5">
                        {summary!.nft.map((n, i) => {
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
                                            <Link to={`/accounts/${n.counterparty}` as any} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                                {formatShort(n.counterparty)}
                                            </Link>
                                        </span>
                                    )}
                                    <span className="text-zinc-400 text-[10px] font-mono ml-auto">{n.collection}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* General tx info */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-zinc-500">
                {tx.gas_used != null && <span>Gas: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(tx.gas_used).toLocaleString()}</span></span>}
                {tx.fee != null && tx.fee > 0 && <span>Fee: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(tx.fee).toFixed(8)}</span></span>}
                {tx.block_height && <span>Block: <Link to={`/blocks/${tx.block_height}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{tx.block_height}</Link></span>}
                {tx.proposer && <span>Proposer: <Link to={`/accounts/${normalizeAddress(tx.proposer)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.proposer)}</Link></span>}
                {tx.payer && tx.payer !== tx.proposer && <span>Payer: <Link to={`/accounts/${normalizeAddress(tx.payer)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.payer)}</Link></span>}
                {tx.contract_imports?.length > 0 && <span>Contracts: {tx.contract_imports.map((c: string, i: number) => (
                    <span key={c}>{i > 0 && ', '}<Link to={`/contracts/${c}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>{formatTokenName(c)}</Link></span>
                ))}</span>}
            </div>
        </div>
    );
}

// --- Activity Row ---

const activityTypeIcons: Record<string, React.ComponentType<any>> = {
    ft: ArrowRightLeft,
    nft: Repeat,
    deploy: FileCode,
    evm: Zap,
    contract: Box,
    account: UserPlus,
    key: Key,
    marketplace: ShoppingBag,
    scheduled: Clock,
    tx: Activity,
};

export function ActivityRow({ tx, address, expanded, onToggle }: { tx: any; address: string; expanded: boolean; onToggle: () => void }) {
    const activity = deriveActivityType(tx);
    const summaryLine = buildSummaryLine(tx);
    const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';
    const IconComp = activityTypeIcons[activity.type] || Activity;
    const hasDetails = tx.transfer_summary?.ft?.length > 0 || tx.transfer_summary?.nft?.length > 0 || tx.is_evm || tx.evm_hash || tx.gas_used;

    return (
        <div className={`border-b border-zinc-100 dark:border-white/5 transition-colors ${expanded ? 'bg-zinc-50/50 dark:bg-white/[0.02]' : ''}`}>
            <div
                className={`flex items-start gap-4 p-4 ${hasDetails ? 'cursor-pointer' : ''} hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group`}
                onClick={hasDetails ? onToggle : undefined}
            >
                {/* Expand chevron */}
                <div className="flex-shrink-0 pt-1 w-4">
                    {hasDetails && (
                        expanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                            : <ChevronRight className="h-3.5 w-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
                    )}
                </div>

                {/* Type badge */}
                <div className="flex-shrink-0 pt-0.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 border rounded-sm text-[9px] font-bold uppercase tracking-wider ${activity.bgColor} ${activity.color}`}>
                        <IconComp className="h-2.5 w-2.5" />
                        {activity.label}
                    </span>
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <Link
                            to={`/transactions/${tx.id}` as any}
                            className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-xs"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {formatShort(tx.id, 12, 8)}
                        </Link>
                        <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-400' : tx.status === 'EXPIRED' ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>
                            {tx.status}
                        </span>
                    </div>
                    {summaryLine && (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                            {(() => {
                                const s: TransferSummary | undefined = tx.transfer_summary;
                                const firstLogo = s?.ft?.[0]?.logo || s?.nft?.[0]?.logo;
                                if (firstLogo) return <TokenIcon logo={firstLogo} symbol={s?.ft?.[0]?.symbol || s?.nft?.[0]?.name} size={14} />;
                                return null;
                            })()}
                            <span className="truncate">{summaryLine}</span>
                        </div>
                    )}
                </div>

                {/* Time */}
                <div className="flex-shrink-0 text-right">
                    <span className="text-[10px] text-zinc-400">{timeStr}</span>
                </div>
            </div>

            {/* Expanded detail panel */}
            {expanded && hasDetails && (
                <ExpandedTransferDetails tx={tx} address={address} />
            )}
        </div>
    );
}

// --- Main Component ---

// Deduplicate transactions by id, keeping the first occurrence.
export function dedup(txs: any[]): any[] {
    const seen = new Set<string>();
    return txs.filter(tx => {
        if (!tx.id || seen.has(tx.id)) return false;
        seen.add(tx.id);
        return true;
    });
}

export function AccountActivityTab({ address, initialTransactions, initialNextCursor }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
    const didFetchRef = useRef(false);

    // Transactions state
    const [transactions, setTransactions] = useState<any[]>(() => dedup(initialTransactions));
    const [currentPage, setCurrentPage] = useState(1);
    const [txLoading, setTxLoading] = useState(false);
    const [txCursors, setTxCursors] = useState<Record<number, string>>(() => {
        const init: Record<number, string> = { 1: '' };
        if (initialNextCursor) init[2] = initialNextCursor;
        return init;
    });
    const [txHasNext, setTxHasNext] = useState(!!initialNextCursor);

    // FT transfers state (lazy-loaded)
    const [ftTransfers, setFtTransfers] = useState<any[]>([]);
    const [ftCursor, setFtCursor] = useState('');
    const [ftHasMore, setFtHasMore] = useState(false);
    const [ftLoading, setFtLoading] = useState(false);

    // NFT transfers state (lazy-loaded)
    const [nftTransfers, setNftTransfers] = useState<any[]>([]);
    const [nftCursor, setNftCursor] = useState('');
    const [nftHasMore, setNftHasMore] = useState(false);
    const [nftLoading, setNftLoading] = useState(false);

    // Scheduled transactions state (lazy-loaded)
    const [scheduledTxs, setScheduledTxs] = useState<any[]>([]);
    const [scheduledCursor, setScheduledCursor] = useState('');
    const [scheduledHasMore, setScheduledHasMore] = useState(false);
    const [scheduledLoading, setScheduledLoading] = useState(false);

    useEffect(() => {
        const dedupedTxs = dedup(initialTransactions);
        setTransactions(dedupedTxs);
        setCurrentPage(1);
        const init: Record<number, string> = { 1: '' };
        if (initialNextCursor) init[2] = initialNextCursor;
        setTxCursors(init);
        setTxHasNext(!!initialNextCursor);
        setExpandedTxId(null);
        setFtTransfers([]);
        setFtCursor('');
        setFtHasMore(false);
        setNftTransfers([]);
        setNftCursor('');
        setNftHasMore(false);
        setScheduledTxs([]);
        setScheduledCursor('');
        setScheduledHasMore(false);
        // Reset fetch guard — if loader provided data, mark as fetched; otherwise allow fallback
        didFetchRef.current = dedupedTxs.length > 0;
    }, [address, initialTransactions, initialNextCursor]);

    // --- Transactions ---
    const loadTransactions = useCallback(async (page: number) => {
        setTxLoading(true);
        setExpandedTxId(null);
        try {
            const offset = (page - 1) * 20;
            await ensureHeyApiConfigured();
            const txRes = await getFlowV1AccountByAddressTransaction({ path: { address: normalizedAddress }, query: { offset, limit: 20 } });
            const payload: any = txRes.data;
            const items = payload?.data ?? [];
            setTransactions(dedup(items.map((tx: any) => ({
                ...tx,
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
                blockHeight: tx.block_height,
            }))));
            if (items.length >= 20) {
                setTxCursors(prev => ({ ...prev, [page + 1]: String(offset + 20) }));
                setTxHasNext(true);
            } else {
                setTxHasNext(false);
            }
        } catch (err) {
            console.error('Failed to load transactions', err);
        } finally {
            setTxLoading(false);
        }
    }, [txCursors, normalizedAddress]);

    // Fallback: if loader didn't provide data (e.g., client-side nav failure), fetch page 1
    useEffect(() => {
        if (!didFetchRef.current && !txLoading) {
            didFetchRef.current = true;
            loadTransactions(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [normalizedAddress]);

    useEffect(() => {
        if (currentPage > 1) loadTransactions(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    // --- FT Transfers (lazy) ---
    const loadFtTransfers = async (cursorValue: string, append: boolean) => {
        setFtLoading(true);
        try {
            const offset = cursorValue ? parseInt(cursorValue, 10) : 0;
            await ensureHeyApiConfigured();
            const res = await getFlowV1AccountByAddressFtTransfer({ path: { address: normalizedAddress }, query: { offset, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.data ?? [];
            setFtTransfers(append ? prev => [...prev, ...items] : items);
            const nextOffset = items.length >= 20 ? String(offset + 20) : '';
            setFtCursor(nextOffset);
            setFtHasMore(!!nextOffset);
        } catch (err) {
            console.error('Failed to load FT transfers', err);
        } finally {
            setFtLoading(false);
        }
    };

    // --- NFT Transfers (lazy) ---
    const loadNftTransfers = async (cursorValue: string, append: boolean) => {
        setNftLoading(true);
        try {
            const offset = cursorValue ? parseInt(cursorValue, 10) : 0;
            await ensureHeyApiConfigured();
            const res = await getFlowV1NftTransfer({ query: { address: normalizedAddress, offset, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.data ?? [];
            setNftTransfers(append ? prev => [...prev, ...items] : items);
            const nextOffset = items.length >= 20 ? String(offset + 20) : '';
            setNftCursor(nextOffset);
            setNftHasMore(!!nextOffset);
        } catch (err) {
            console.error('Failed to load NFT transfers', err);
        } finally {
            setNftLoading(false);
        }
    };

    // --- Scheduled Transactions (lazy) ---
    const loadScheduledTransactions = async (cursorValue: string, append: boolean) => {
        setScheduledLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const url = `${baseUrl}/accounts/${normalizedAddress}/scheduled-transactions?cursor=${encodeURIComponent(cursorValue)}&limit=20`;
            const res = await fetch(url);
            const payload: any = await res.json();
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            const mapped = items.map((tx: any) => ({
                ...tx,
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
                blockHeight: tx.block_height,
            }));
            setScheduledTxs(append ? prev => dedup([...prev, ...mapped]) : dedup(mapped));
            const next = payload?.next_cursor ?? '';
            setScheduledCursor(next);
            setScheduledHasMore(!!next);
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setScheduledLoading(false);
        }
    };

    // Auto-load dedicated transfer lists when filter switches
    useEffect(() => {
        if (filterMode === 'ft' && ftTransfers.length === 0 && !ftLoading) loadFtTransfers('', false);
        if (filterMode === 'nft' && nftTransfers.length === 0 && !nftLoading) loadNftTransfers('', false);
        if (filterMode === 'scheduled' && scheduledTxs.length === 0 && !scheduledLoading) loadScheduledTransactions('', false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterMode, address]);

    // Filter the unified feed
    const filteredTransactions = useMemo(() => {
        if (filterMode === 'all') return transactions;
        return transactions.filter(tx => {
            const activity = deriveActivityType(tx);
            if (filterMode === 'ft') return activity.type === 'ft';
            if (filterMode === 'nft') return activity.type === 'nft';
            return true;
        });
    }, [transactions, filterMode]);

    const filters = [
        { id: 'all' as const, label: 'All Activity', icon: Activity },
        { id: 'ft' as const, label: 'FT Transfers', icon: ArrowRightLeft },
        { id: 'nft' as const, label: 'NFT Transfers', icon: Repeat },
        { id: 'scheduled' as const, label: 'Scheduled', icon: Clock },
    ];

    const isLoading = filterMode === 'all' ? txLoading : filterMode === 'ft' ? ftLoading : filterMode === 'nft' ? nftLoading : scheduledLoading;

    return (
        <div>
            {/* Filter toggles */}
            <div className="flex items-center gap-2 mb-4">
                {filters.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setFilterMode(id)}
                        className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm ${filterMode === id
                            ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                            : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                        }`}
                    >
                        <span className="flex items-center gap-2">
                            <Icon className={`h-3 w-3 ${filterMode === id ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                            {label}
                        </span>
                    </button>
                ))}
            </div>

            {/* Pagination */}
            {filterMode === 'all' && (
                <div className="flex items-center justify-end mb-3">
                    <div className="flex items-center gap-2">
                        <button disabled={currentPage <= 1 || txLoading} onClick={() => setCurrentPage(prev => prev - 1)} className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Prev</button>
                        <span className="text-[10px] text-zinc-500 tabular-nums min-w-[4rem] text-center">Page {currentPage}</span>
                        <button disabled={!txHasNext || txLoading} onClick={() => setCurrentPage(prev => prev + 1)} className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Next</button>
                    </div>
                </div>
            )}

            {/* === Unified Activity Feed === */}
            <div className="overflow-x-auto min-h-[200px] relative">
                {isLoading && (filterMode === 'all' ? true : (filterMode === 'ft' ? ftTransfers.length === 0 : filterMode === 'nft' ? nftTransfers.length === 0 : scheduledTxs.length === 0)) && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}

                {/* Dedicated FT transfer list */}
                {filterMode === 'ft' && ftTransfers.length > 0 && (
                    <div className="space-y-0">
                        {ftTransfers.map((tx: any, i: number) => {
                            const dir = tx.direction || (tx.from_address?.toLowerCase().includes(normalizedAddress.replace('0x', '')) ? 'withdraw' : 'deposit');
                            const isOut = dir === 'withdraw' || dir === 'out';
                            const tokenSymbol = tx.token?.symbol || tx.token?.name || formatTokenName(tx.token?.token || '');
                            const tokenLogo = tx.token?.logo;
                            const sender = tx.sender || tx.from_address;
                            const receiver = tx.receiver || tx.to_address;
                            const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';
                            return (
                                <div key={i} className="flex items-center gap-3 p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                    {/* Token icon */}
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center overflow-hidden">
                                        <TokenIcon logo={tokenLogo} symbol={tokenSymbol} size={28} />
                                        {!extractLogoUrl(tokenLogo) && <ArrowRightLeft className="h-3.5 w-3.5 text-emerald-500" />}
                                    </div>
                                    {/* Main content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                                {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                                {isOut ? 'Sent' : 'Received'}
                                            </span>
                                            <span className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                                {tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '\u2014'}
                                            </span>
                                            <span className="text-xs text-zinc-500 font-medium">{tokenSymbol}</span>
                                            {tx.token?.token && (
                                                <Link to={`/contracts/${tx.token.token}` as any} className="text-[10px] text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green font-mono ml-1">
                                                    {tx.token.token}
                                                </Link>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                                            {sender && (
                                                <span>From <Link to={`/accounts/${normalizeAddress(sender)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(sender)}</Link></span>
                                            )}
                                            {sender && receiver && <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>}
                                            {receiver && (
                                                <span>To <Link to={`/accounts/${normalizeAddress(receiver)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(receiver)}</Link></span>
                                            )}
                                            {tx.transaction_hash && (
                                                <>
                                                    <span className="text-zinc-300 dark:text-zinc-600 mx-0.5">|</span>
                                                    <Link to={`/transactions/${tx.transaction_hash}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.transaction_hash, 8, 6)}</Link>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {/* Right side */}
                                    <div className="flex-shrink-0 text-right">
                                        <div className="text-[10px] text-zinc-400">{timeStr}</div>
                                        {tx.block_height && <div className="text-[10px] text-zinc-400 font-mono">#{tx.block_height}</div>}
                                    </div>
                                </div>
                            );
                        })}
                        {ftHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadFtTransfers(ftCursor, true)} disabled={ftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{ftLoading ? 'Loading...' : 'Load More'}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Dedicated NFT transfer list */}
                {filterMode === 'nft' && nftTransfers.length > 0 && (
                    <div className="space-y-0">
                        {nftTransfers.map((tx: any, i: number) => {
                            const dir = tx.direction || (tx.from_address?.toLowerCase().includes(normalizedAddress.replace('0x', '')) ? 'withdraw' : 'deposit');
                            const isOut = dir === 'withdraw' || dir === 'out';
                            const collectionName = tx.collection?.name || formatTokenName(tx.nft_type || '');
                            const collectionImage = tx.collection?.image;
                            const sender = tx.sender || tx.from_address;
                            const receiver = tx.receiver || tx.to_address;
                            const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';
                            return (
                                <div key={i} className="flex items-center gap-3 p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                    {/* Collection icon */}
                                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center overflow-hidden">
                                        <TokenIcon logo={collectionImage} symbol={collectionName} size={36} />
                                        {!extractLogoUrl(collectionImage) && <Repeat className="h-4 w-4 text-amber-500" />}
                                    </div>
                                    {/* Main content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                                {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                                {isOut ? 'Sent' : 'Received'}
                                            </span>
                                            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{collectionName}</span>
                                            {tx.nft_id && <span className="text-xs text-zinc-500 font-mono">#{tx.nft_id}</span>}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                                            {sender && (
                                                <span>From <Link to={`/accounts/${normalizeAddress(sender)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(sender)}</Link></span>
                                            )}
                                            {sender && receiver && <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>}
                                            {receiver && (
                                                <span>To <Link to={`/accounts/${normalizeAddress(receiver)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(receiver)}</Link></span>
                                            )}
                                            {tx.nft_type && (
                                                <>
                                                    <span className="text-zinc-300 dark:text-zinc-600 mx-0.5">|</span>
                                                    <Link to={`/contracts/${tx.nft_type}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-[10px]">{tx.nft_type}</Link>
                                                </>
                                            )}
                                            {tx.transaction_hash && (
                                                <>
                                                    <span className="text-zinc-300 dark:text-zinc-600 mx-0.5">|</span>
                                                    <Link to={`/transactions/${tx.transaction_hash}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.transaction_hash, 8, 6)}</Link>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {/* Right side */}
                                    <div className="flex-shrink-0 text-right">
                                        <div className="text-[10px] text-zinc-400">{timeStr}</div>
                                        {tx.block_height && <div className="text-[10px] text-zinc-400 font-mono">#{tx.block_height}</div>}
                                    </div>
                                </div>
                            );
                        })}
                        {nftHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadNftTransfers(nftCursor, true)} disabled={nftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{nftLoading ? 'Loading...' : 'Load More'}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Scheduled transactions list */}
                {filterMode === 'scheduled' && scheduledTxs.length > 0 && (
                    <div className="space-y-0">
                        {scheduledTxs.map((tx) => (
                            <ActivityRow
                                key={tx.id}
                                tx={tx}
                                address={normalizedAddress}
                                expanded={expandedTxId === tx.id}
                                onToggle={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                            />
                        ))}
                        {scheduledHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadScheduledTransactions(scheduledCursor, true)} disabled={scheduledLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{scheduledLoading ? 'Loading...' : 'Load More'}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Empty states for dedicated views */}
                {filterMode === 'ft' && ftTransfers.length === 0 && !ftLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No FT transfers found</div>
                )}
                {filterMode === 'nft' && nftTransfers.length === 0 && !nftLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No NFT transfers found</div>
                )}
                {filterMode === 'scheduled' && scheduledTxs.length === 0 && !scheduledLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No scheduled transactions found</div>
                )}

                {/* Unified timeline (filterMode === 'all') */}
                {filterMode === 'all' && filteredTransactions.length > 0 && (
                    <div className="space-y-0">
                        {filteredTransactions.map((tx) => (
                            <ActivityRow
                                key={tx.id}
                                tx={tx}
                                address={normalizedAddress}
                                expanded={expandedTxId === tx.id}
                                onToggle={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                            />
                        ))}
                    </div>
                )}
                {filterMode === 'all' && filteredTransactions.length === 0 && !txLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No transactions found</div>
                )}
            </div>
        </div>
    );
}
