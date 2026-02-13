import { Link } from '@tanstack/react-router';
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, FileCode, Zap, Box, UserPlus, Key, ShoppingBag, Clock, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { normalizeAddress, formatShort } from './account/accountUtils';
import { formatRelativeTime } from '../lib/time';

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

export function ExpandedTransferDetails({ tx, address }: { tx: any; address: string }) {
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
                    <Link to={`/tx/${tx.evm_hash}` as any} className="font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
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

export function ActivityRow({ tx, address = '', expanded, onToggle }: { tx: any; address?: string; expanded: boolean; onToggle: () => void }) {
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
                            to={`/tx/${tx.id}` as any}
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

// --- Dedup helper ---

export function dedup(txs: any[]): any[] {
    const seen = new Set<string>();
    return txs.filter(tx => {
        if (!tx.id || seen.has(tx.id)) return false;
        seen.add(tx.id);
        return true;
    });
}
