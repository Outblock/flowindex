import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { resolveApiBaseUrl } from '../../api';
import { buildMeta } from '../../lib/og/meta';
import { ArrowLeft, Activity, User, Box, Clock, CheckCircle, XCircle, Hash, ArrowRightLeft, ArrowRight, Coins, Image as ImageIcon, Zap, Database, AlertCircle, FileText, Layers, Braces, ExternalLink, Repeat, Globe, ChevronDown, Sparkles } from 'lucide-react';
import { openAIChat } from '../../components/chat/openAIChat';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../../contexts/ThemeContext';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import DecryptedText from '../../components/ui/DecryptedText';
import { deriveActivityType, TokenIcon, formatTokenName, buildSummaryLine, NFTTransferImage, fetchNFTFullDetail, useNFTLazyDetail } from '../../components/TransactionRow';
import { formatShort } from '../../components/account/accountUtils';
import AISummary from '../../components/tx/AISummary';
import TransferFlowDiagram from '../../components/tx/TransferFlowDiagram';
import { NotFoundPage } from '../../components/ui/NotFoundPage';
import { deriveEnrichments } from '../../lib/deriveFromEvents';
import { NFTDetailModal } from '../../components/NFTDetailModal';
import { UsdValue } from '../../components/UsdValue';
import { parseCadenceError } from '../../lib/parseCadenceError';

SyntaxHighlighter.registerLanguage('cadence', swift);

/** Decode a Flow EVM "direct call" raw_tx_payload (0xff-prefixed RLP).
 *  Returns decoded fields or null if not a direct call or decode fails.
 *  Format: 0xff || RLP([nonce, subType, from(20B), to(20B), data, value, gasLimit, ...])
 */
function decodeFlowDirectCallPayload(hexPayload: string): {
    nonce: number; subType: number; from: string; to: string;
    data: string; value: string; gasLimit: string;
} | null {
    try {
        let hex = hexPayload.replace(/^0x/, '').toLowerCase();
        if (!hex.startsWith('ff') || hex.length < 10) return null;
        hex = hex.slice(2); // strip 0xff prefix
        const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));

        let pos = 0;
        // Decode RLP list header
        if (bytes[pos] >= 0xf8) {
            const lenBytes = bytes[pos] - 0xf7;
            pos += 1 + lenBytes;
        } else if (bytes[pos] >= 0xc0) {
            pos += 1;
        } else {
            return null;
        }

        function readItem(): Uint8Array {
            if (pos >= bytes.length) return new Uint8Array(0);
            const b = bytes[pos];
            if (b <= 0x7f) { pos++; return new Uint8Array([b]); }
            if (b <= 0xb7) { const len = b - 0x80; pos++; const out = bytes.slice(pos, pos + len); pos += len; return out; }
            if (b <= 0xbf) { const lenLen = b - 0xb7; pos++; let len = 0; for (let i = 0; i < lenLen; i++) len = (len << 8) | bytes[pos + i]; pos += lenLen; const out = bytes.slice(pos, pos + len); pos += len; return out; }
            return new Uint8Array(0);
        }
        function bytesToHex(b: Uint8Array): string { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
        function bytesToBigInt(b: Uint8Array): string {
            if (b.length === 0) return '0';
            let n = BigInt(0);
            for (const byte of b) n = (n << BigInt(8)) | BigInt(byte);
            return n.toString();
        }

        const nonceBytes = readItem(); // field 1: nonce
        const subTypeBytes = readItem(); // field 2: subType
        const fromBytes = readItem(); // field 3: from (20 bytes)
        const toBytes = readItem(); // field 4: to (20 bytes)
        const dataBytes = readItem(); // field 5: data
        const valueBytes = readItem(); // field 6: value
        const gasLimitBytes = readItem(); // field 7: gasLimit

        const nonce = nonceBytes.length > 0 ? Number(bytesToBigInt(nonceBytes)) : 0;
        const subType = subTypeBytes.length > 0 ? subTypeBytes[0] : 0;
        const from = fromBytes.length === 20 ? '0x' + bytesToHex(fromBytes) : '';
        const toHex = bytesToHex(toBytes);
        const to = toBytes.length === 20 && !/^0{40}$/.test(toHex) ? '0x' + toHex : '';
        const data = dataBytes.length > 0 ? '0x' + bytesToHex(dataBytes) : '';

        // Convert value from attoFLOW (10^18) to FLOW
        const valueBig = bytesToBigInt(valueBytes);
        let valueFlow: string;
        if (valueBig === '0') {
            valueFlow = '0';
        } else {
            const str = valueBig.padStart(19, '0');
            const intPart = str.slice(0, str.length - 18) || '0';
            const fracPart = str.slice(str.length - 18).replace(/0+$/, '');
            valueFlow = fracPart ? `${intPart}.${fracPart}` : intPart;
        }

        const gasLimit = bytesToBigInt(gasLimitBytes);
        return { nonce, subType, from, to, data, value: valueFlow, gasLimit };
    } catch {
        return null;
    }
}

/** Strip surrounding quotes and whitespace from URLs (backend sometimes stores `"https://..."`) */
function cleanUrl(url: string | undefined | null): string {
    if (!url) return '';
    return url.replace(/^["'\s]+|["'\s]+$/g, '');
}

/** NFT transfer row with lazy-loaded name + thumbnail */
function NFTSummaryRow({ nt, onClick, isAdmin, fmtAddr }: { nt: any; onClick?: () => void; isAdmin?: boolean; fmtAddr: (a: string) => string }) {
    const { thumbnailSrc, displayName, loading } = useNFTLazyDetail(nt);
    const name = displayName || nt.nft_name || `#${nt.token_id}`;
    const imgSize = 48;
    return (
        <div className={`flex items-center gap-3 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-sm p-2.5 ${onClick ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-black/40 transition-colors' : ''}`} onClick={onClick}>
            <div className="flex-shrink-0">
                {loading ? (
                    <div style={{ width: imgSize, height: imgSize }} className="rounded bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center animate-pulse">
                        <ImageIcon style={{ width: 14, height: 14 }} className="text-purple-500" />
                    </div>
                ) : thumbnailSrc ? (
                    <img src={thumbnailSrc} alt="" style={{ width: imgSize, height: imgSize }} className="rounded border border-zinc-200 dark:border-white/10 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                    <div style={{ width: imgSize, height: imgSize }} className="rounded bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center">
                        <ImageIcon style={{ width: 14, height: 14 }} className="text-purple-500" />
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-medium text-zinc-900 dark:text-white">{name}</span>
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded font-medium">
                        {nt.collection_name || nt.token?.split('.').pop() || 'NFT'}
                    </span>
                    {nt.nft_rarity && (
                        <span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">{nt.nft_rarity}</span>
                    )}
                    {isAdmin && nt.token && (
                        <Link to="/admin" search={{ tab: 'nft', q: nt.token } as any} className="text-[9px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 font-mono" onClick={(e) => e.stopPropagation()}>[admin]</Link>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5">
                    {nt.from_address && <span className="inline-flex items-center gap-1">From <span className="font-mono">{fmtAddr(nt.from_address)}</span></span>}
                    {nt.from_address && nt.to_address && <span className="text-zinc-300 dark:text-zinc-600">→</span>}
                    {nt.to_address && <span className="inline-flex items-center gap-1">To <span className="font-mono">{fmtAddr(nt.to_address)}</span></span>}
                </div>
            </div>
        </div>
    );
}

/** NFT transfer detail row (larger, in the Transfers tab) with lazy-loaded name + thumbnail */
function NFTDetailRow({ nt, onClick, isAdmin }: { nt: any; onClick?: () => void; isAdmin?: boolean }) {
    const { thumbnailSrc, displayName, loading } = useNFTLazyDetail(nt);
    const name = displayName || nt.nft_name || `#${nt.token_id}`;
    const imgSize = 64;
    return (
        <div className="flex items-center gap-4 p-4 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-black/50 transition-colors cursor-pointer" onClick={onClick}>
            <div className="flex-shrink-0">
                {loading ? (
                    <div style={{ width: imgSize, height: imgSize }} className="rounded-md bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center animate-pulse">
                        <ImageIcon style={{ width: 19, height: 19 }} className="text-purple-500" />
                    </div>
                ) : thumbnailSrc ? (
                    <img src={thumbnailSrc} alt="" style={{ width: imgSize, height: imgSize }} className="rounded-md border border-zinc-200 dark:border-white/10 object-cover shadow-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                    <div style={{ width: imgSize, height: imgSize }} className="rounded-md bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center">
                        <ImageIcon style={{ width: 19, height: 19 }} className="text-purple-500" />
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-medium text-zinc-900 dark:text-white">{name}</span>
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded font-medium">
                        {nt.collection_name || nt.token?.split('.').pop() || 'NFT'}
                    </span>
                    {nt.transfer_type === 'mint' && (
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Mint</span>
                    )}
                    {nt.transfer_type === 'burn' && (
                        <span className="text-[9px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Burn</span>
                    )}
                    {nt.nft_rarity && (
                        <span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">{nt.nft_rarity}</span>
                    )}
                    {nt.is_cross_vm && (
                        <span className="inline-flex items-center gap-1 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            <Globe className="w-2.5 h-2.5" /> Cross-VM
                        </span>
                    )}
                    {isAdmin && nt.token && (
                        <Link to="/admin" search={{ tab: 'nft', q: nt.token } as any} className="text-[9px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 font-mono" onClick={(e) => e.stopPropagation()}>[admin]</Link>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5">
                    {nt.from_address && (
                        <span className="inline-flex items-center gap-1">From <AddressLink address={nt.from_address} prefixLen={8} suffixLen={4} size={12} className="text-[10px]" />
                            {nt.from_coa_flow_address && <span className="text-purple-500 ml-1 inline-flex items-center gap-0.5">(COA → <AddressLink address={nt.from_coa_flow_address} prefixLen={8} suffixLen={4} size={12} className="text-[10px] text-purple-500" />)</span>}
                        </span>
                    )}
                    {nt.from_address && nt.to_address && <span className="text-zinc-300 dark:text-zinc-600">→</span>}
                    {nt.to_address && (
                        <span className="inline-flex items-center gap-1">To <AddressLink address={nt.to_address} prefixLen={8} suffixLen={4} size={12} className="text-[10px]" />
                            {nt.to_coa_flow_address && <span className="text-purple-500 ml-1 inline-flex items-center gap-0.5">(COA → <AddressLink address={nt.to_coa_flow_address} prefixLen={8} suffixLen={4} size={12} className="text-[10px] text-purple-500" />)</span>}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export const Route = createFileRoute('/txs/$txId')({
    component: TransactionDetail,
    validateSearch: (search: Record<string, unknown>) => ({
        tab: (search.tab as string) || undefined,
    }),
    loader: async ({ params }) => {
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/transaction/${encodeURIComponent(params.txId)}?lite=true`);
            if (res.ok) {
                const json = await res.json();
                const rawTx: any = json?.data?.[0] ?? json;
                const transformedTx = {
                    ...rawTx,
                    type: rawTx.type || (rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
                    payer: rawTx.payer_address || rawTx.payer || 'Unknown',
                    proposer: rawTx.proposer_address || rawTx.proposer || 'Unknown',
                    proposerKeyIndex: rawTx.proposer_key_index ?? -1,
                    proposerSequenceNumber: rawTx.proposer_sequence_number ?? -1,
                    blockHeight: rawTx.block_height,
                    gasLimit: rawTx.gas_limit,
                    gasUsed: rawTx.gas_used,
                    events: rawTx.events || [],
                    status: rawTx.status || 'UNKNOWN',
                    errorMessage: rawTx.error_message || rawTx.error,
                    arguments: rawTx.arguments
                };
                return { transaction: transformedTx, error: null as string | null };
            }
            // Backend's /flow/transaction/{id} already checks evm_tx_hashes
            // and evm_transactions tables for EVM hash → Cadence tx resolution.
            // If it returned 404, the EVM hash isn't indexed yet.
            if (res.status === 404) {
                return { transaction: null, error: 'Transaction not found' };
            }
            return { transaction: null, error: 'Failed to load transaction details' };
        } catch (e) {
            const message = (e as any)?.message;
            console.error('Failed to load transaction data', { message });
            return { transaction: null, error: 'Failed to load transaction details' };
        }
    },
    head: ({ params }) => {
        const id = params.txId;
        const shortId = id.length > 16 ? `${id.slice(0, 10)}...${id.slice(-8)}` : id;
        return {
            meta: buildMeta({
                title: `Tx ${shortId}`,
                description: `Flow transaction ${id}`,
                ogImagePath: `tx/${id}`,
            }),
        };
    },
})

function TokenBubble({ logo, symbol, size = 32 }: { logo?: string; symbol?: string; size?: number }) {
    if (logo) {
        return <img src={logo} alt={symbol || ''} style={{ width: size, height: size }} className="rounded-full border border-zinc-200 dark:border-white/10 flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
    }
    return (
        <div style={{ width: size, height: size }} className="rounded-full bg-zinc-100 dark:bg-white/10 border border-zinc-200 dark:border-white/10 flex items-center justify-center text-[10px] font-bold text-zinc-500 dark:text-zinc-400 flex-shrink-0 uppercase">
            {symbol?.slice(0, 2) || '?'}
        </div>
    );
}

function FlowRow({ from, to, amount, symbol, logo, badge, usdPrice, fromTag, toTag, formatAddr: _formatAddr }: {
    from?: string; to?: string; amount?: string | number; symbol?: string; logo?: string; badge?: React.ReactNode;
    usdPrice?: number; fromTag?: string; toTag?: string;
    formatAddr: (a: string) => string;
}) {
    const formattedAmount = amount != null ? Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—';
    return (
        <div className="flex items-center gap-0 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
            {/* FROM */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 min-w-0 flex-shrink-0">
                {from ? (
                    <>
                        <AddressLink address={from} prefixLen={8} suffixLen={4} size={14} className="text-[11px]" />
                        {fromTag && <span className="text-[8px] text-purple-400 uppercase">{fromTag}</span>}
                    </>
                ) : (
                    <span className="text-[11px] text-zinc-400 italic">Mint</span>
                )}
            </div>
            {/* ARROW + TOKEN */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-nothing-dark border-x border-zinc-200 dark:border-white/5 flex-1 justify-center">
                <ArrowRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                <TokenBubble logo={logo} symbol={symbol} size={24} />
                <span className="text-sm font-mono font-semibold text-zinc-900 dark:text-white whitespace-nowrap">{formattedAmount}</span>
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{symbol}</span>
                {badge}
                {formattedAmount !== '—' && usdPrice != null && usdPrice > 0 && (
                    <UsdValue amount={Number(amount)} price={usdPrice} className="text-[10px]" />
                )}
                <ArrowRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
            </div>
            {/* TO */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 min-w-0 flex-shrink-0">
                {to ? (
                    <>
                        <AddressLink address={to} prefixLen={8} suffixLen={4} size={14} className="text-[11px]" />
                        {toTag && <span className="text-[8px] text-purple-400 uppercase">{toTag}</span>}
                    </>
                ) : (
                    <span className="text-[11px] text-zinc-400 italic">Burn</span>
                )}
            </div>
        </div>
    );
}

function TransactionSummaryCard({ transaction, formatAddress: _formatAddress, onNftClick, isAdmin }: { transaction: any; formatAddress: (addr: string) => string; onNftClick?: (nt: any) => void; isAdmin?: boolean }) {
    const activity = deriveActivityType(transaction);
    const summaryLine = buildSummaryLine(transaction);
    const hasFT = transaction.ft_transfers?.length > 0;
    const hasDefi = transaction.defi_events?.length > 0;
    const hasEvm = transaction.is_evm && (transaction.evm_hash || transaction.evm_executions?.length > 0);
    const tags = (transaction.tags || []).map((t: string) => t.toLowerCase());
    const isDeploy = tags.some((t: string) => t.includes('deploy') || t.includes('contract_added') || t.includes('contract_updated'));
    const hasContractImports = transaction.contract_imports?.length > 0;

    const fmtAddr = (addr: string) => formatShort(addr, 8, 4);

    // NFT collection banner image (gradient overlay like tx list)
    const nftBannerUrl = transaction.nft_transfers?.length > 0
        ? cleanUrl(transaction.nft_transfers[0].collection_logo)
        : '';

    return (
        <div className="relative overflow-hidden border border-zinc-200 dark:border-white/10 p-6 mb-8 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
            {/* NFT collection banner gradient */}
            {nftBannerUrl && (
                <div
                    className="absolute right-0 top-0 bottom-0 w-60 pointer-events-none opacity-[0.12] dark:opacity-[0.08]"
                    style={{
                        backgroundImage: `url(${nftBannerUrl})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        maskImage: 'linear-gradient(to right, transparent, black)',
                        WebkitMaskImage: 'linear-gradient(to right, transparent, black)',
                    }}
                />
            )}
            {/* Header row: title + activity badge */}
            <div className="relative flex items-center justify-between mb-4 border-b border-zinc-200 dark:border-white/10 pb-3">
                <h2 className="text-sm uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                    Transaction Summary
                </h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-sm text-[10px] font-bold uppercase tracking-wider ${activity.bgColor} ${activity.color}`}>
                    {activity.label}
                </span>
            </div>

            {/* Summary line */}
            {summaryLine && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{summaryLine}</p>
            )}

            {/* Transfer flow diagram (auto-synthesized) */}
            <div className="mb-4">
                <TransferFlowDiagram detail={transaction} />
            </div>

            {/* FT transfer flow rows — aggregated by (from, to, token) */}
            {hasFT && (() => {
                // Build display rows: for cross-VM transfers with evm_to/from, split into
                // two rows (Cadence leg + EVM leg) so the full path is visible.
                type FlowRowData = { from: string; to: string; symbol: string; logo: string; total: number; count: number; usdPrice: number; fromTag?: string; toTag?: string; badge?: React.ReactNode };
                const displayRows: FlowRowData[] = [];
                const agg = new Map<string, FlowRowData>();
                for (const ft of transaction.ft_transfers) {
                    const sym = ft.token_symbol || ft.token?.split('.').pop() || '';
                    const amount = parseFloat(ft.amount) || 0;
                    const evmTo = ft.evm_to_address;
                    const evmFrom = ft.evm_from_address;
                    // Cross-VM with EVM destination: split into Cadence + EVM legs
                    if (evmTo || evmFrom) {
                        // Leg 1: Cadence transfer (from → COA)
                        displayRows.push({
                            from: ft.from_address, to: ft.to_address, symbol: sym, logo: ft.token_logo,
                            total: amount, count: 1, usdPrice: ft.approx_usd_price || 0,
                            toTag: evmTo ? 'COA' : undefined, fromTag: evmFrom ? 'COA' : undefined,
                        });
                        // Leg 2: EVM execution (COA → EVM dest)
                        if (evmTo) {
                            displayRows.push({
                                from: ft.to_address, to: evmTo, symbol: sym, logo: ft.token_logo,
                                total: amount, count: 1, usdPrice: ft.approx_usd_price || 0,
                                fromTag: 'COA', toTag: 'EVM',
                                badge: <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider"><Globe className="w-2.5 h-2.5" /> EVM</span>,
                            });
                        }
                        if (evmFrom) {
                            displayRows.push({
                                from: evmFrom, to: ft.from_address, symbol: sym, logo: ft.token_logo,
                                total: amount, count: 1, usdPrice: ft.approx_usd_price || 0,
                                fromTag: 'EVM', toTag: 'COA',
                                badge: <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider"><Globe className="w-2.5 h-2.5" /> EVM</span>,
                            });
                        }
                        continue;
                    }
                    // Normal transfer: aggregate
                    const key = `${ft.from_address}|${ft.to_address}|${sym}`;
                    const existing = agg.get(key);
                    if (existing) {
                        existing.total += amount;
                        existing.count += 1;
                        if (!existing.usdPrice && ft.approx_usd_price > 0) existing.usdPrice = ft.approx_usd_price;
                    } else {
                        agg.set(key, { from: ft.from_address, to: ft.to_address, symbol: sym, logo: ft.token_logo, total: amount, count: 1, usdPrice: ft.approx_usd_price || 0 });
                    }
                }
                const rows = [...displayRows, ...Array.from(agg.values())];
                return (
                    <div className="space-y-2 mb-4">
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Token Transfers</p>
                            <span className="text-[9px] text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{transaction.ft_transfers.length}</span>
                        </div>
                        {rows.slice(0, 10).map((r, idx) => (
                            <FlowRow
                                key={idx}
                                from={r.from}
                                to={r.to}
                                fromTag={r.fromTag}
                                toTag={r.toTag}
                                amount={r.total}
                                symbol={r.symbol}
                                logo={r.logo}
                                usdPrice={r.usdPrice}
                                formatAddr={fmtAddr}
                                badge={r.badge || (r.count > 1 ? (
                                    <span className="text-[9px] text-zinc-500 bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                        ×{r.count}
                                    </span>
                                ) : undefined)}
                            />
                        ))}
                        {rows.length > 10 && (
                            <p className="text-[10px] text-zinc-400 uppercase tracking-wider pl-1">+{rows.length - 10} more</p>
                        )}
                    </div>
                );
            })()}

            {/* NFT transfer summary rows */}
            {transaction.nft_transfers?.length > 0 && (
                <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest">NFT Transfers</p>
                        <span className="text-[9px] text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{transaction.nft_transfers.length}</span>
                    </div>
                    {transaction.nft_transfers.slice(0, 6).map((nt: any, idx: number) => (
                        <NFTSummaryRow key={idx} nt={nt} onClick={onNftClick ? () => onNftClick(nt) : undefined} isAdmin={isAdmin} fmtAddr={fmtAddr} />
                    ))}
                    {transaction.nft_transfers.length > 6 && (
                        <p className="text-[10px] text-zinc-400 uppercase tracking-wider pl-1">+{transaction.nft_transfers.length - 6} more</p>
                    )}
                </div>
            )}

            {/* DeFi swap summary */}
            {hasDefi && (
                <div className="space-y-2 mb-4">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Swaps</p>
                    {transaction.defi_events.slice(0, 3).map((swap: any, idx: number) => {
                        const a0In = parseFloat(swap.asset0_in) || 0;
                        const a1In = parseFloat(swap.asset1_in) || 0;
                        const a0Out = parseFloat(swap.asset0_out) || 0;
                        const a1Out = parseFloat(swap.asset1_out) || 0;
                        const fromToken = a0In > 0
                            ? { symbol: swap.asset0_symbol || swap.asset0_id?.split('.').pop() || '?', logo: swap.asset0_logo, amount: a0In }
                            : { symbol: swap.asset1_symbol || swap.asset1_id?.split('.').pop() || '?', logo: swap.asset1_logo, amount: a1In };
                        const toToken = a1Out > 0
                            ? { symbol: swap.asset1_symbol || swap.asset1_id?.split('.').pop() || '?', logo: swap.asset1_logo, amount: a1Out }
                            : { symbol: swap.asset0_symbol || swap.asset0_id?.split('.').pop() || '?', logo: swap.asset0_logo, amount: a0Out };

                        return (
                            <div key={idx} className="flex items-center gap-0 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                {/* FROM token */}
                                <div className="flex items-center gap-2 px-3 py-2.5">
                                    <TokenBubble logo={fromToken.logo} symbol={fromToken.symbol} size={24} />
                                    <span className="text-sm font-mono font-semibold text-zinc-900 dark:text-white">{fromToken.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                    <span className="text-[10px] text-zinc-500 font-bold uppercase">{fromToken.symbol}</span>
                                </div>
                                {/* Arrow */}
                                <div className="flex items-center px-3 bg-white dark:bg-nothing-dark border-x border-zinc-200 dark:border-white/5 py-2.5 self-stretch">
                                    <ArrowRightLeft className="w-4 h-4 text-nothing-green-dark dark:text-nothing-green" />
                                </div>
                                {/* TO token */}
                                <div className="flex items-center gap-2 px-3 py-2.5">
                                    <TokenBubble logo={toToken.logo} symbol={toToken.symbol} size={24} />
                                    <span className="text-sm font-mono font-semibold text-zinc-900 dark:text-white">{toToken.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                    <span className="text-[10px] text-zinc-500 font-bold uppercase">{toToken.symbol}</span>
                                </div>
                                {/* DEX badge */}
                                {swap.dex && (
                                    <span className="text-[9px] text-zinc-400 uppercase tracking-wider bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded ml-auto mr-3">{swap.dex}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* EVM hash links — show all EVM tx hashes from executions (or legacy field) */}
            {hasEvm && (() => {
                const hashes: string[] = [];
                if (transaction.evm_executions?.length > 0) {
                    for (const exec of transaction.evm_executions) {
                        if (exec.hash) hashes.push(exec.hash);
                    }
                } else if (transaction.evm_hash) {
                    hashes.push(transaction.evm_hash);
                }
                return hashes.length > 0 ? (
                    <div className="space-y-1.5 mb-4">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">EVM Hash{hashes.length > 1 ? 'es' : ''}</span>
                        {hashes.map((hash, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 p-3 rounded-sm">
                                <code className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all">0x{hash.replace(/^0x/, '')}</code>
                                <a href={`https://evm.flowindex.io/tx/0x${hash.replace(/^0x/, '')}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-blue-500 transition-colors flex-shrink-0">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center gap-2 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 p-3 rounded-sm mb-4">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">EVM Hash</span>
                        <span className="text-xs text-zinc-400 italic">Pending</span>
                    </div>
                );
            })()}

            {/* Deploy info */}
            {isDeploy && !hasFT && !hasDefi && !hasContractImports && (
                <div className="flex items-center gap-2 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 p-3 rounded-sm mb-4">
                    <Layers className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">Contract deployment</span>
                </div>
            )}

            {/* Contract imports */}
            {hasContractImports && (
                <div className="mb-4">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1.5">Contracts</p>
                    <div className="flex flex-wrap gap-1.5">
                        {transaction.contract_imports.map((c: string) => (
                            <Link
                                key={c}
                                to={`/contracts/${c}` as any}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-nothing-green-dark dark:text-nothing-green hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                            >
                                <Braces className="w-3 h-3 text-zinc-400" />
                                {formatTokenName(c)}
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* AI Summary */}
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/10">
                <AISummary transaction={transaction} />
            </div>
        </div>
    );
}

function TransactionDetail() {
    const { txId } = Route.useParams();
    const { tab: urlTab } = Route.useSearch();
    const navigate = useNavigate();
    const { transaction, error: loaderError } = Route.useLoaderData();
    const error = transaction ? null : (loaderError || 'Transaction not found');

    // Derive enrichments locally from events + script (no backend call needed)
    const enrichments = useMemo(() => {
        if (!transaction?.events?.length) return null;
        return deriveEnrichments(transaction.events, transaction.script);
    }, [transaction?.events, transaction?.script]);

    // Client-side full fetch to get enriched data (ft_transfers with USD, nft_transfers, defi_events)
    const [apiEnrichment, setApiEnrichment] = useState<any>(null);
    const fullFetchDone = useRef(false);
    useEffect(() => {
        if (!transaction?.id || fullFetchDone.current) return;
        fullFetchDone.current = true;
        resolveApiBaseUrl().then(base =>
            fetch(`${base}/flow/transaction/${encodeURIComponent(transaction.id)}`)
                .then(r => r.ok ? r.json() : null)
                .then(json => {
                    const tx = json?.data?.[0];
                    if (tx) setApiEnrichment(tx);
                })
        ).catch(() => {});
    }, [transaction?.id]);

    // Merge derived enrichments + API enrichment into the transaction object
    // Priority: apiEnrichment (has USD values) > derived enrichments > SSR loader data
    const fullTx = useMemo(() => {
        if (!enrichments && !apiEnrichment) return transaction;

        // Enrich derived NFT transfers with API metadata
        let mergedNfts = enrichments?.nft_transfers || [];
        const apiNfts = apiEnrichment?.nft_transfers || transaction?.nft_transfers || [];
        if (mergedNfts.length > 0 && apiNfts.length > 0) {
            const apiByKey = new Map<string, any>();
            for (const nt of apiNfts) {
                apiByKey.set(`${nt.token}:${nt.token_id}`, nt);
            }
            mergedNfts = mergedNfts.map((nt: any) => {
                const api = apiByKey.get(`${nt.token}:${nt.token_id}`);
                if (!api) return nt;
                return {
                    ...nt,
                    collection_name: nt.collection_name || api.collection_name,
                    collection_logo: nt.collection_logo || api.collection_logo,
                    nft_thumbnail: nt.nft_thumbnail || api.nft_thumbnail,
                    nft_name: nt.nft_name || api.nft_name,
                    nft_rarity: nt.nft_rarity || api.nft_rarity,
                    is_cross_vm: nt.is_cross_vm ?? api.is_cross_vm,
                    from_coa_flow_address: nt.from_coa_flow_address || api.from_coa_flow_address,
                    to_coa_flow_address: nt.to_coa_flow_address || api.to_coa_flow_address,
                };
            });
        }

        // For ft_transfers: prefer API enrichment (has usd_value), fall back to derived, then SSR.
        // Merge transfer_type + evm_to/from_address from derived enrichments into API data.
        const derivedFt = enrichments?.ft_transfers;
        let ftTransfers = apiEnrichment?.ft_transfers?.length > 0
            ? apiEnrichment.ft_transfers
            : ((derivedFt && derivedFt.length > 0) ? derivedFt : transaction?.ft_transfers);
        if (ftTransfers && enrichments?.ft_transfers && enrichments.ft_transfers.length > 0 && ftTransfers !== enrichments.ft_transfers) {
            // API data lacks transfer_type and evm addresses — merge from derived enrichments
            const derivedByKey = new Map<string, any>();
            for (const ft of enrichments!.ft_transfers) {
                derivedByKey.set(`${ft.token}:${ft.event_index}`, ft);
            }
            ftTransfers = ftTransfers.map((ft: any) => {
                const derived = derivedByKey.get(`${ft.token}:${ft.event_index}`);
                if (!derived) return ft;
                return {
                    ...ft,
                    transfer_type: ft.transfer_type || derived.transfer_type,
                    evm_to_address: ft.evm_to_address || derived.evm_to_address,
                    evm_from_address: ft.evm_from_address || derived.evm_from_address,
                };
            });
        }

        // Merge evm_executions: API data has extra fields (gas_price etc.) but may have
        // null from/to for old records. Derived data now decodes 0xff payloads properly.
        // Use API as base, fill in from/to from derived when missing.
        let evmExecs = (apiEnrichment?.evm_executions?.length > 0 ? apiEnrichment.evm_executions : enrichments?.evm_executions) || transaction?.evm_executions || [];
        const derivedEvmExecs = enrichments?.evm_executions;
        if (apiEnrichment?.evm_executions?.length > 0 && derivedEvmExecs && derivedEvmExecs.length > 0) {
            const derivedByIdx = new Map<number, any>();
            for (const e of derivedEvmExecs) derivedByIdx.set(e.event_index, e);
            evmExecs = apiEnrichment.evm_executions.map((e: any) => {
                const d = derivedByIdx.get(e.event_index);
                if (!d) return e;
                return {
                    ...e,
                    from: e.from || d.from,
                    to: e.to || d.to,
                    value: (e.value && e.value !== '0') ? e.value : d.value,
                };
            });
        }

        // Enrich cross-VM FT transfers with actual EVM destination from decoded EVM executions.
        // When FLOW goes to a COA (bridge), the EVM execution reveals the real EVM recipient.
        if (evmExecs.length > 0 && ftTransfers?.length > 0) {
            const isCOA = (addr: string) => {
                const hex = addr?.replace(/^0x/, '').toLowerCase() || '';
                return hex.length > 16 && /^0{10,}/.test(hex);
            };
            ftTransfers = ftTransfers.map((ft: any) => {
                if (!ft.token?.includes?.('FlowToken')) return ft;
                const toHex = ft.to_address?.replace(/^0x/, '').toLowerCase() || '';
                const fromHex = ft.from_address?.replace(/^0x/, '').toLowerCase() || '';
                let evmTo = ft.evm_to_address;
                let evmFrom = ft.evm_from_address;
                if (!evmTo && isCOA(ft.to_address)) {
                    // Find EVM execution where COA sends value to the actual recipient
                    const exec = evmExecs.find((e: any) =>
                        e.from?.replace(/^0x/, '').toLowerCase() === toHex &&
                        e.to && parseFloat(e.value) > 0
                    );
                    if (exec) evmTo = exec.to;
                }
                if (!evmFrom && isCOA(ft.from_address)) {
                    const exec = evmExecs.find((e: any) =>
                        e.to?.replace(/^0x/, '').toLowerCase() === fromHex &&
                        e.from && parseFloat(e.value) > 0
                    );
                    if (exec) evmFrom = exec.from;
                }
                if (evmTo || evmFrom) {
                    return { ...ft, evm_to_address: evmTo || ft.evm_to_address, evm_from_address: evmFrom || ft.evm_from_address };
                }
                return ft;
            });
        }

        return {
            ...transaction,
            ft_transfers: ftTransfers,
            nft_transfers: mergedNfts.length > 0 ? mergedNfts : apiNfts,
            defi_events: apiEnrichment?.defi_events?.length > 0 ? apiEnrichment.defi_events : transaction?.defi_events,
            evm_executions: evmExecs,
            contract_imports: (enrichments?.contract_imports && enrichments.contract_imports.length > 0 ? enrichments.contract_imports : apiEnrichment?.contract_imports) || transaction?.contract_imports,
            fee: enrichments?.fee || apiEnrichment?.fee || transaction?.fee,
            fee_usd: apiEnrichment?.fee_usd || transaction?.fee_usd,
        };
    }, [enrichments, apiEnrichment, transaction]);

    const hasTransfers = fullTx?.ft_transfers?.length > 0 || fullTx?.nft_transfers?.length > 0 || fullTx?.defi_events?.length > 0;
    const showTransfersTab = hasTransfers;
    const validTabs = ['transfers', 'script', 'events', 'evm'];
    const defaultTab = hasTransfers ? 'transfers' : (fullTx?.script ? 'script' : 'events');
    const [activeTab, setActiveTab] = useState(() =>
        urlTab && validTabs.includes(urlTab) ? urlTab : defaultTab
    );
    const nowTick = useTimeTicker(20000);
    const { theme } = useTheme();
    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

    // Parse error for structured display + script highlighting
    const parsedError = useMemo(() => {
        const errMsg = transaction?.errorMessage || transaction?.error_message || transaction?.error;
        if (!errMsg) return null;
        return parseCadenceError(errMsg);
    }, [transaction?.errorMessage, transaction?.error_message, transaction?.error]);

    const errorLines = useMemo(() => {
        const set = new Set<number>();
        if (parsedError?.scriptErrorLine) {
            set.add(parsedError.scriptErrorLine);
        }
        return set;
    }, [parsedError]);

    const [expandedPayloads, setExpandedPayloads] = useState<Record<number, boolean>>({});
    const [selectedNft, setSelectedNft] = useState<any | null>(null);
    const [selectedNftCollection, setSelectedNftCollection] = useState<{ id: string; name: string }>({ id: '', name: '' });
    const isAdmin = typeof window !== 'undefined' && !!localStorage.getItem('flowindex_admin_token');

    // Click handler for NFT transfer cards — fetch full detail then open modal
    const handleNftClick = useCallback((nt: any) => {
        const token = nt.token || '';
        const tokenId = String(nt.token_id ?? '');
        const owner = nt.transfer_type === 'burn' ? nt.from_address : nt.to_address;
        const collectionName = nt.collection_name || token.split('.').pop() || 'NFT';
        setSelectedNftCollection({ id: token, name: collectionName });

        // If we already have cadence detail cached, use it directly
        fetchNFTFullDetail(token, tokenId, owner || '').then(detail => {
            if (detail) {
                // Cadence detail has: tokenId, name, thumbnail, rarity, serial, editions, traits, medias, externalURL
                // NFTDetailContent expects { display: { name, thumbnail }, tokenId, ... }
                const modalNft = detail.display?.name
                    ? detail  // Already in cadence format
                    : {
                        tokenId: detail.tokenId || tokenId,
                        display: {
                            name: detail.name || nt.nft_name || `#${tokenId}`,
                            description: detail.description || '',
                            thumbnail: detail.thumbnail || nt.nft_thumbnail || '',
                        },
                        ...(detail.serial != null && { serial: { number: detail.serial } }),
                        ...(detail.editions && { editions: detail.editions }),
                        ...(detail.rarity && { rarity: typeof detail.rarity === 'string' ? { description: detail.rarity } : detail.rarity }),
                        ...(detail.traits && { traits: detail.traits }),
                        ...(detail.medias && { medias: detail.medias }),
                        ...(detail.externalURL && { externalURL: typeof detail.externalURL === 'string' ? { url: detail.externalURL } : detail.externalURL }),
                    };
                setSelectedNft(modalNft);
            } else {
                // Fallback: show what we have from the transfer data
                setSelectedNft({
                    tokenId: tokenId,
                    display: {
                        name: nt.nft_name || `#${tokenId}`,
                        description: '',
                        thumbnail: nt.nft_thumbnail || nt.collection_logo || '',
                    },
                });
            }
        });
    }, []);

    // Sync tab to URL
    const switchTab = (tab: string) => {
        setActiveTab(tab);
        navigate({
            search: ((prev: any) => ({ ...prev, tab: tab === defaultTab ? undefined : tab })) as any,
            replace: true,
        });
    };


    // Convert byte arrays (arrays of numeric strings) to "0x..." hex strings for display
    const formatEventPayload = (data: any): any => {
        if (data == null) return data;
        if (Array.isArray(data)) {
            // Check if this looks like a byte array: all elements are numeric strings 0-255
            if (data.length > 0 && data.every((v: any) => typeof v === 'string' && /^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 255)) {
                const hex = data.map((v: string) => Number(v).toString(16).padStart(2, '0')).join('');
                return `0x${hex}`;
            }
            return data.map(formatEventPayload);
        }
        if (typeof data === 'object') {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(data)) {
                out[k] = formatEventPayload(v);
            }
            return out;
        }
        return data;
    };

    // Simple JSON syntax highlighter — colorizes keys, strings, numbers, booleans, and null
    const highlightJSON = (json: string): string => {
        const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return escaped.replace(
            /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|((?:-?\d+\.?\d*(?:[eE][+-]?\d+)?)(?=[,\s\]}]))|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
            (match, key, str, num, bool, nul) => {
                if (key) return `<span class="text-purple-600 dark:text-purple-400">${key}</span>:`;
                if (str) return `<span class="text-emerald-600 dark:text-emerald-400">${str}</span>`;
                if (num) return `<span class="text-amber-600 dark:text-amber-400">${num}</span>`;
                if (bool) return `<span class="text-blue-600 dark:text-blue-400">${bool}</span>`;
                if (nul) return `<span class="text-zinc-400 dark:text-zinc-600">${nul}</span>`;
                return match;
            }
        );
    };

    const formatAddress = (addr: any) => {
        if (!addr || addr === '0000000000000000') return '';
        let formatted = addr.toLowerCase();
        if (!formatted.startsWith('0x')) {
            formatted = '0x' + formatted;
        }
        return formatted;
    };

    if (error || !transaction) {
        return (
            <NotFoundPage
                icon={Hash}
                title="Transaction Not Found"
                identifier={txId}
                description="This transaction hasn't been indexed yet or doesn't exist."
                hint="Our indexer is continuously processing blocks. If this is a recent transaction, please check back in a few minutes."
            />
        );
    }

    const txTimeSource = transaction.timestamp || transaction.created_at || transaction.block_timestamp;
    const txTimeAbsolute = formatAbsoluteTime(txTimeSource);
    const txTimeRelative = formatRelativeTime(txTimeSource, nowTick);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                {/* Back Button */}
                <button onClick={() => window.history.back()} className="inline-flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-8 group">
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Back</span>
                </button>

                {/* Consolidated Header Card */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-8 relative overflow-hidden bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        {transaction.is_evm ? <Box className="h-32 w-32" /> : <Hash className="h-32 w-32" />}
                    </div>

                    <div className="relative z-10">
                        {/* Badges */}
                        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
                            {(() => {
                                const activity = deriveActivityType(transaction);
                                return (
                                    <span className={`text-xs uppercase tracking-[0.2em] border px-2 py-1 rounded-sm w-fit font-bold ${activity.bgColor} ${activity.color}`}>
                                        {activity.label}
                                    </span>
                                );
                            })()}
                            <span className={`text-xs uppercase tracking-[0.2em] border px-2 py-1 rounded-sm w-fit ${transaction.status === 'SEALED'
                                ? 'text-zinc-500 dark:text-white border-zinc-300 dark:border-white/30'
                                : 'text-yellow-600 dark:text-yellow-500 border-yellow-500/30'
                                }`}>
                                {transaction.status}
                            </span>
                            {transaction.is_evm && (
                                <span className="text-blue-600 dark:text-blue-400 text-xs uppercase tracking-[0.2em] border border-blue-400/30 px-2 py-1 rounded-sm w-fit">
                                    EVM
                                </span>
                            )}
                        </div>

                        {/* TX ID with DecryptedText */}
                        <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white mb-1 break-all flex items-center gap-1 group">
                            <DecryptedText
                                text={(transaction.is_evm && transaction.evm_hash) ? transaction.evm_hash : transaction.id}
                                animateOn="view"
                                sequential
                                revealDirection="start"
                                speed={60}
                                maxIterations={30}
                                characters="█▓▒░╳╱╲◆◇●○■□▪▫#@$%&*!?~^"
                                startEncrypted
                                className="font-mono"
                            />
                            <CopyButton
                                content={(transaction.is_evm && transaction.evm_hash) ? transaction.evm_hash : transaction.id}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            />
                        </h1>
                        <p className="text-zinc-500 text-xs uppercase tracking-widest">
                            {(transaction.is_evm && transaction.evm_hash) ? 'EVM Hash' : 'Transaction ID'}
                        </p>

                        {/* Divider */}
                        <div className="border-t border-zinc-200 dark:border-white/10 mt-6 pt-6">
                            {/* Row 1: Timestamp, Block, Computation */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Timestamp</p>
                                    <span className="text-sm text-zinc-600 dark:text-zinc-300">{txTimeAbsolute || 'N/A'}</span>
                                    {txTimeRelative && (
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                                            {txTimeRelative}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Block Height</p>
                                    <Link
                                        to={`/blocks/${transaction.blockHeight}` as any}
                                        className="text-sm text-zinc-900 dark:text-white hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors font-mono"
                                    >
                                        {transaction.blockHeight?.toLocaleString()}
                                    </Link>
                                </div>
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Computation</p>
                                    <span className="text-sm text-zinc-600 dark:text-zinc-300 font-mono">{transaction.computation_usage?.toLocaleString() || 0}</span>
                                </div>
                            </div>

                            {/* Row 1.5: Fee */}
                            {(fullTx?.fee > 0 || transaction?.fee > 0) && (
                                <div className="mb-5">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Execution Fee</p>
                                    <span className="text-sm text-zinc-600 dark:text-zinc-300 font-mono">
                                        {Number(fullTx?.fee || transaction?.fee).toLocaleString(undefined, { maximumFractionDigits: 8 })} FLOW
                                    </span>
                                    {(fullTx?.fee_usd > 0 || transaction?.fee_usd > 0) && (
                                        <UsdValue value={fullTx?.fee_usd || transaction?.fee_usd} className="ml-2 text-xs" />
                                    )}
                                </div>
                            )}

                            {/* Row 2: Payer, Proposer, Authorizers */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {/* Payer */}
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Payer</p>
                                    <div className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-2.5 flex items-center justify-between hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors rounded-sm">
                                        <div className="flex items-center gap-1 min-w-0">
                                            <AddressLink address={formatAddress(transaction.payer)} prefixLen={20} suffixLen={0} className="text-xs" />
                                            <CopyButton
                                                content={formatAddress(transaction.payer)}
                                                variant="ghost"
                                                size="xs"
                                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Proposer */}
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">
                                        Proposer
                                        {(transaction.proposerSequenceNumber > 0 || transaction.proposerKeyIndex > 0) && (
                                            <span className="text-zinc-400 ml-2 font-mono normal-case">
                                                seq:{transaction.proposerSequenceNumber} key:{transaction.proposerKeyIndex}
                                            </span>
                                        )}
                                    </p>
                                    <div className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-2.5 flex items-center hover:border-zinc-300 dark:hover:border-white/20 transition-colors rounded-sm">
                                        <div className="flex items-center gap-1 min-w-0">
                                            <AddressLink address={formatAddress(transaction.proposer)} prefixLen={20} suffixLen={0} className="text-xs" />
                                            <CopyButton
                                                content={formatAddress(transaction.proposer)}
                                                variant="ghost"
                                                size="xs"
                                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Authorizers */}
                                <div className="group">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Authorizers</p>
                                        {transaction.authorizers?.length > 0 && (
                                            <span className="bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-white text-[9px] px-1.5 py-0.5 rounded-full">{transaction.authorizers.length}</span>
                                        )}
                                    </div>
                                    {transaction.authorizers && transaction.authorizers.length > 0 ? (
                                        <div className="flex flex-col gap-1.5">
                                            {transaction.authorizers.map((auth: any, idx: number) => (
                                                <div key={`${auth}-${idx}`} className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-2.5 hover:border-zinc-300 dark:hover:border-white/20 transition-colors rounded-sm flex items-center gap-1 group">
                                                    <AddressLink address={formatAddress(auth)} prefixLen={20} suffixLen={0} className="text-xs" />
                                                    <CopyButton
                                                        content={formatAddress(auth)}
                                                        variant="ghost"
                                                        size="xs"
                                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-2.5 rounded-sm">
                                            <span className="text-xs text-zinc-400">None</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error Message Section */}
                {(transaction.errorMessage || transaction.error_message || transaction.error) && (() => {
                    const errMsg = transaction.errorMessage || transaction.error_message || transaction.error;
                    const parsed = parseCadenceError(errMsg);
                    return (
                        <div className="border border-red-500/30 bg-red-50 dark:bg-red-900/10 p-6 mb-8 rounded-sm">
                            <div className="flex items-start gap-4">
                                <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <h3 className="text-red-500 text-sm font-bold uppercase tracking-widest">Execution Error</h3>
                                        <button
                                            onClick={() => openAIChat(
                                                `Analyze this failed Flow transaction. Explain what went wrong, why it happened, and how to fix it.\n\n> **Transaction:** \`${transaction.id || transaction.tx_hash}\`\n\n> **Error:**\n> \`\`\`\n> ${errMsg.replace(/\n/g, '\n> ')}\n> \`\`\``
                                            )}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-widest font-bold bg-nothing-green text-black hover:bg-nothing-green/85 shadow-sm shadow-nothing-green/25 transition-colors shrink-0"
                                        >
                                            <Sparkles size={10} />
                                            Analyze with AI
                                        </button>
                                    </div>

                                    {parsed.errorCode && (
                                        <div className="mb-2">
                                            <span className="text-[10px] uppercase tracking-widest text-red-400 font-bold">Error Code: {parsed.errorCode}</span>
                                        </div>
                                    )}

                                    {parsed.summary && (
                                        <p className="text-red-600 dark:text-red-300 text-sm font-mono leading-relaxed mb-4">
                                            {parsed.summary}
                                        </p>
                                    )}

                                    {parsed.codeSnippet && parsed.codeSnippet.length > 0 && (
                                        <div className="bg-zinc-900 border border-zinc-700 rounded-sm overflow-hidden mb-4">
                                            <div className="px-3 py-1.5 border-b border-zinc-700 flex items-center gap-2">
                                                <Braces className="h-3 w-3 text-zinc-500" />
                                                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Error Context</span>
                                            </div>
                                            <div className="p-3 font-mono text-[11px] leading-relaxed overflow-x-auto">
                                                {parsed.codeSnippet.map((line, i) => (
                                                    <div
                                                        key={i}
                                                        className={`flex ${line.isError ? 'bg-red-500/15 border-l-2 border-red-500 -ml-3 pl-[10px]' : ''}`}
                                                    >
                                                        <span className="text-zinc-600 select-none w-10 text-right pr-3 flex-shrink-0">{line.lineNum}</span>
                                                        <span className={line.isError ? 'text-red-300' : 'text-zinc-300'}>{line.code}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {parsed.callStack.length > 0 && (
                                        <div className="mb-3">
                                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 font-bold block mb-1.5">Call Stack</span>
                                            <div className="space-y-0.5">
                                                {parsed.callStack.map((entry, i) => (
                                                    <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
                                                        <span className="text-zinc-400 dark:text-zinc-600">→</span>
                                                        <span>{entry.location}:{entry.line}:{entry.col}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Collapsed raw error for power users */}
                                    <details className="group">
                                        <summary className="text-[10px] uppercase tracking-widest text-zinc-400 cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                                            Raw Error
                                        </summary>
                                        <p className="text-red-600/70 dark:text-red-300/50 text-[10px] font-mono break-all leading-relaxed mt-2 max-h-48 overflow-y-auto">
                                            {errMsg}
                                        </p>
                                    </details>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Transaction Summary Card */}
                <TransactionSummaryCard transaction={fullTx} formatAddress={formatAddress} onNftClick={handleNftClick} isAdmin={isAdmin} />

                {/* Tabs Section */}
                <div className="mt-12">
                    <div className="flex border-b border-zinc-200 dark:border-white/10 mb-0 overflow-x-auto">
                        {showTransfersTab && (
                            <button
                                onClick={() => switchTab('transfers')}
                                className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'transfers'
                                    ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                    }`}
                            >
                                <span className="flex items-center gap-2">
                                    <ArrowRightLeft className={`h-4 w-4 ${activeTab === 'transfers' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                    Transfers
                                </span>
                            </button>
                        )}
                        <button
                            onClick={() => switchTab('script')}
                            className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'script'
                                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Zap className={`h-4 w-4 ${activeTab === 'script' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                Script & Args
                            </span>
                        </button>
                        <button
                            onClick={() => switchTab('events')}
                            className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'events'
                                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Database className={`h-4 w-4 ${activeTab === 'events' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                Key Events ({transaction.events ? transaction.events.length : 0})
                            </span>
                        </button>
                        {fullTx.is_evm && fullTx.evm_executions?.length > 0 && (
                            <button
                                onClick={() => switchTab('evm')}
                                className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'evm'
                                    ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                    }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Layers className={`h-4 w-4 ${activeTab === 'evm' ? 'text-blue-600 dark:text-blue-400' : ''}`} />
                                    EVM Execution Details
                                </span>
                            </button>
                        )}
                    </div>

                    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 border-t-0 p-6 min-h-[300px] shadow-sm dark:shadow-none">
                        {activeTab === 'transfers' && (
                            <div className="space-y-6">
                                {/* DeFi Swap Events */}
                                {fullTx.defi_events?.length > 0 && (
                                    <div>
                                        <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Repeat className="h-4 w-4" /> Swap
                                        </h3>
                                        <div className="space-y-3">
                                            {fullTx.defi_events.map((swap: any, idx: number) => {
                                                const a0In = parseFloat(swap.asset0_in) || 0;
                                                const a1In = parseFloat(swap.asset1_in) || 0;
                                                const a0Out = parseFloat(swap.asset0_out) || 0;
                                                const a1Out = parseFloat(swap.asset1_out) || 0;

                                                const fromToken = a0In > 0 ? {
                                                    symbol: swap.asset0_symbol || swap.asset0_id?.split('.').pop() || '?',
                                                    name: swap.asset0_name, logo: swap.asset0_logo, amount: a0In, id: swap.asset0_id,
                                                } : {
                                                    symbol: swap.asset1_symbol || swap.asset1_id?.split('.').pop() || '?',
                                                    name: swap.asset1_name, logo: swap.asset1_logo, amount: a1In, id: swap.asset1_id,
                                                };
                                                const toToken = a1Out > 0 ? {
                                                    symbol: swap.asset1_symbol || swap.asset1_id?.split('.').pop() || '?',
                                                    name: swap.asset1_name, logo: swap.asset1_logo, amount: a1Out, id: swap.asset1_id,
                                                } : {
                                                    symbol: swap.asset0_symbol || swap.asset0_id?.split('.').pop() || '?',
                                                    name: swap.asset0_name, logo: swap.asset0_logo, amount: a0Out, id: swap.asset0_id,
                                                };

                                                return (
                                                    <div key={idx} className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-4 rounded-sm">
                                                        <div className="flex items-center gap-2 mb-3">
                                                            <span className="text-[10px] text-zinc-500 uppercase tracking-widest bg-zinc-200 dark:bg-white/10 px-2 py-0.5 rounded">
                                                                {swap.dex || 'DEX'}
                                                            </span>
                                                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                                                                {swap.event_type}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                {fromToken.logo ? (
                                                                    <img src={fromToken.logo} alt="" className="w-8 h-8 rounded-full border border-zinc-200 dark:border-white/10" />
                                                                ) : (
                                                                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                                                                        {fromToken.symbol?.slice(0, 2)}
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <div className="text-sm font-mono font-medium text-zinc-900 dark:text-white truncate">
                                                                        {fromToken.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                                                    </div>
                                                                    <div className="text-[10px] text-zinc-500 uppercase">{fromToken.symbol}</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-nothing-green/10 dark:bg-nothing-green/20 flex items-center justify-center">
                                                                <ArrowRight className="w-4 h-4 text-nothing-green-dark dark:text-nothing-green" />
                                                            </div>
                                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                {toToken.logo ? (
                                                                    <img src={toToken.logo} alt="" className="w-8 h-8 rounded-full border border-zinc-200 dark:border-white/10" />
                                                                ) : (
                                                                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                                                                        {toToken.symbol?.slice(0, 2)}
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <div className="text-sm font-mono font-medium text-zinc-900 dark:text-white truncate">
                                                                        {toToken.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                                                    </div>
                                                                    <div className="text-[10px] text-zinc-500 uppercase">{toToken.symbol}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {swap.pair_id && (
                                                            <div className="mt-2 text-[10px] text-zinc-400 font-mono">
                                                                Route: {swap.pair_id}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* FT Token Transfers — split cross-VM into two rows */}
                                {fullTx.ft_transfers?.length > 0 && (() => {
                                    // Expand cross-VM transfers into separate Cadence + EVM legs
                                    const ftRows: { from: string; to: string; amount: string; symbol: string; logo: string; usdValue: number; transferType?: string; badge?: React.ReactNode }[] = [];
                                    for (const ft of fullTx.ft_transfers) {
                                        const sym = ft.token_symbol || ft.token?.split('.').pop() || '';
                                        const amount = ft.amount;
                                        const evmTo = ft.evm_to_address;
                                        const evmFrom = ft.evm_from_address;

                                        if (evmTo || evmFrom) {
                                            // Leg 1: Cadence side
                                            ftRows.push({
                                                from: ft.from_address, to: ft.to_address,
                                                amount, symbol: sym, logo: ft.token_logo,
                                                usdValue: ft.usd_value || 0, transferType: ft.transfer_type,
                                                badge: <span className="inline-flex items-center gap-1 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider"><Globe className="w-2.5 h-2.5" />Cadence</span>,
                                            });
                                            // Leg 2: EVM side
                                            if (evmTo) {
                                                ftRows.push({
                                                    from: ft.to_address, to: evmTo,
                                                    amount, symbol: sym, logo: ft.token_logo,
                                                    usdValue: ft.usd_value || 0,
                                                    badge: <span className="inline-flex items-center gap-1 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider"><Globe className="w-2.5 h-2.5" />EVM</span>,
                                                });
                                            }
                                            if (evmFrom) {
                                                ftRows.push({
                                                    from: evmFrom, to: ft.from_address,
                                                    amount, symbol: sym, logo: ft.token_logo,
                                                    usdValue: ft.usd_value || 0,
                                                    badge: <span className="inline-flex items-center gap-1 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider"><Globe className="w-2.5 h-2.5" />EVM</span>,
                                                });
                                            }
                                            continue;
                                        }
                                        // Normal transfer
                                        ftRows.push({
                                            from: ft.from_address, to: ft.to_address,
                                            amount, symbol: sym, logo: ft.token_logo,
                                            usdValue: ft.usd_value || 0, transferType: ft.transfer_type,
                                        });
                                    }

                                    return (
                                    <div>
                                        <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Coins className="h-4 w-4" /> Token Transfers ({ftRows.length})
                                        </h3>
                                        <div className="divide-y divide-zinc-100 dark:divide-white/5 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                            {ftRows.map((row, idx) => (
                                                <div key={idx} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-black/50 transition-colors">
                                                    <div className="flex-shrink-0">
                                                        {row.logo ? (
                                                            <img src={row.logo} alt="" className="w-7 h-7 rounded-full border border-zinc-200 dark:border-white/10" />
                                                        ) : (
                                                            <div className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center">
                                                                <Coins className="w-3.5 h-3.5 text-emerald-500" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-xs font-mono font-medium text-zinc-900 dark:text-white">
                                                                {row.amount != null ? Number(row.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                                            </span>
                                                            <span className="text-[10px] text-zinc-500 font-medium uppercase">{row.symbol}</span>
                                                            {row.usdValue > 0 && <UsdValue value={row.usdValue} className="text-[10px]" />}
                                                            {row.transferType === 'mint' && (
                                                                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Mint</span>
                                                            )}
                                                            {row.transferType === 'burn' && (
                                                                <span className="text-[9px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Burn</span>
                                                            )}
                                                            {row.badge}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5 flex-wrap">
                                                            {row.from && (
                                                                <span className="inline-flex items-center gap-1">
                                                                    From <AddressLink address={row.from} prefixLen={8} suffixLen={4} size={12} className="text-[10px]" />
                                                                </span>
                                                            )}
                                                            {row.from && row.to && <span className="text-zinc-300 dark:text-zinc-600">→</span>}
                                                            {row.to && (
                                                                <span className="inline-flex items-center gap-1">
                                                                    To <AddressLink address={row.to} prefixLen={8} suffixLen={4} size={12} className="text-[10px]" />
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    );
                                })()}

                                {/* NFT Transfers */}
                                {fullTx.nft_transfers?.length > 0 && (
                                    <div>
                                        <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <ImageIcon className="h-4 w-4" /> NFT Transfers ({fullTx.nft_transfers.length})
                                        </h3>
                                        <div className="divide-y divide-zinc-100 dark:divide-white/5 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                            {fullTx.nft_transfers.map((nt: any, idx: number) => (
                                                <NFTDetailRow key={idx} nt={nt} onClick={() => handleNftClick(nt)} isAdmin={isAdmin} />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!hasTransfers && (
                                    <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                                        <ArrowRightLeft className="h-8 w-8 mb-2 opacity-20" />
                                        <p className="text-xs uppercase tracking-widest">No Token Transfers</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'script' && (
                            <div className="space-y-8">
                                {/* Arguments */}
                                <div className="font-mono">
                                    <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <FileText className="h-4 w-4" /> Script Arguments
                                    </h3>
                                    {transaction.arguments ? (
                                        <div className="bg-zinc-50 dark:bg-black/50 border border-zinc-200 dark:border-white/5 p-4 rounded-sm">
                                            {(() => {
                                                // Detect Flow (0x + 16 hex) or EVM (0x + 40 hex) addresses in values
                                                const ADDRESS_RE = /^0x[a-fA-F0-9]{16}$|^0x[a-fA-F0-9]{40}$/;

                                                const renderArgValue = (decoded: any): React.ReactNode => {
                                                    if (typeof decoded === 'string' && ADDRESS_RE.test(decoded)) {
                                                        return <AddressLink address={decoded.replace(/^0x/, '')} prefixLen={20} suffixLen={0} className="text-xs" />;
                                                    }
                                                    if (Array.isArray(decoded)) {
                                                        const hasAddr = decoded.some((v: any) => typeof v === 'string' && ADDRESS_RE.test(v));
                                                        if (hasAddr) {
                                                            return (
                                                                <div className="space-y-1">
                                                                    {'['}
                                                                    {decoded.map((v: any, i: number) => (
                                                                        <div key={i} className="pl-4">
                                                                            {typeof v === 'string' && ADDRESS_RE.test(v)
                                                                                ? <AddressLink address={v.replace(/^0x/, '')} prefixLen={20} suffixLen={0} className="text-xs" />
                                                                                : JSON.stringify(v)}
                                                                            {i < decoded.length - 1 ? ',' : ''}
                                                                        </div>
                                                                    ))}
                                                                    {']'}
                                                                </div>
                                                            );
                                                        }
                                                    }
                                                    if (typeof decoded === 'object' && decoded !== null) {
                                                        return <pre className="whitespace-pre-wrap">{JSON.stringify(decoded, null, 2)}</pre>;
                                                    }
                                                    return String(decoded);
                                                };

                                                const decodeCadenceValue = (val: any): any => {
                                                    if (!val || typeof val !== 'object') return val;

                                                    if (val.value !== undefined) {
                                                        if (val.type === 'Optional') {
                                                            return val.value ? decodeCadenceValue(val.value) : null;
                                                        }
                                                        if (val.type === 'Array') {
                                                            return val.value.map(decodeCadenceValue);
                                                        }
                                                        if (val.type === 'Dictionary') {
                                                            const dict: Record<string, any> = {};
                                                            val.value.forEach((item: any) => {
                                                                const k = decodeCadenceValue(item.key);
                                                                const v = decodeCadenceValue(item.value);
                                                                dict[String(k)] = v;
                                                            });
                                                            return dict;
                                                        }
                                                        if (val.type === 'Struct' || val.type === 'Resource' || val.type === 'Event') {
                                                            const obj: Record<string, any> = {};
                                                            if (val.value && val.value.fields) {
                                                                val.value.fields.forEach((f: any) => {
                                                                    obj[f.name] = decodeCadenceValue(f.value);
                                                                });
                                                                return obj;
                                                            }
                                                        }
                                                        if (val.type === 'Path') {
                                                            return `${val.value.domain}/${val.value.identifier}`;
                                                        }
                                                        if (val.type === 'Type') {
                                                            return val.value.staticType;
                                                        }
                                                        return val.value;
                                                    }
                                                    return val;
                                                };

                                                // Extract Cadence type string (handles nested: [String], {String: UInt64}, etc.)
                                                const getCadenceType = (val: any): string => {
                                                    if (!val || typeof val !== 'object') return typeof val;
                                                    if (val.type === 'Optional') return `${getCadenceType(val.value)}?`;
                                                    if (val.type === 'Array') return `[${val.value?.length > 0 ? getCadenceType(val.value[0]) : 'Any'}]`;
                                                    if (val.type === 'Dictionary') {
                                                        const first = val.value?.[0];
                                                        return first ? `{${getCadenceType(first.key)}: ${getCadenceType(first.value)}}` : '{Any: Any}';
                                                    }
                                                    return val.type || typeof val;
                                                };

                                                // Parse parameter names from script's transaction(...) signature
                                                const parseParamNames = (script: string): { name: string; type: string }[] => {
                                                    if (!script) return [];
                                                    // Match transaction(...) or prepare(...) — handle multiline
                                                    const match = script.match(/(?:transaction|prepare)\s*\(([^)]*)\)/s);
                                                    if (!match) return [];
                                                    const paramsStr = match[1].trim();
                                                    if (!paramsStr) return [];
                                                    return paramsStr.split(',').map(p => {
                                                        const trimmed = p.trim();
                                                        const parts = trimmed.split(':').map(s => s.trim());
                                                        return { name: parts[0] || '', type: parts[1] || '' };
                                                    });
                                                };

                                                try {
                                                    let args = transaction.arguments;
                                                    if (typeof args === 'string') {
                                                        try {
                                                            args = JSON.parse(args);
                                                        } catch {
                                                            return <div className="text-zinc-500 dark:text-zinc-400 text-xs">{args}</div>;
                                                        }
                                                    }

                                                    if (!Array.isArray(args)) {
                                                        return <pre className="text-[10px] text-nothing-green-dark dark:text-nothing-green whitespace-pre-wrap">{JSON.stringify(args, null, 2)}</pre>;
                                                    }

                                                    const paramNames = parseParamNames(transaction.script);

                                                    return (
                                                        <div className="space-y-3">
                                                            {args.map((rawArg: any, idx: number) => {
                                                                const decoded = decodeCadenceValue(rawArg);
                                                                const cadenceType = getCadenceType(rawArg);
                                                                const param = paramNames[idx];
                                                                const paramName = param?.name || `arg${idx}`;
                                                                const paramType = param?.type || cadenceType;

                                                                return (
                                                                    <div key={idx} className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                                                        {/* Header: name + type */}
                                                                        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-white/5 border-b border-zinc-200 dark:border-white/5">
                                                                            <span className="text-[10px] text-zinc-400 font-mono tabular-nums">{idx}</span>
                                                                            <span className="text-[11px] text-zinc-800 dark:text-zinc-200 font-medium font-mono">{paramName}</span>
                                                                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded">{paramType}</span>
                                                                        </div>
                                                                        {/* Value */}
                                                                        <div className="px-3 py-2.5 text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all leading-relaxed">
                                                                            {renderArgValue(decoded)}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    );

                                                } catch {
                                                    return <div className="text-zinc-500 text-xs">Failed to parse arguments: {String(transaction.arguments)}</div>;
                                                }
                                            })()}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-zinc-600 italic px-2">No arguments provided</div>
                                    )}
                                </div>

                                {/* Script */}
                                <div className="font-mono">
                                    <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <Braces className="h-4 w-4" /> Cadence Script
                                    </h3>
                                    {transaction.script ? (
                                        <div className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden text-[10px]">
                                            <SyntaxHighlighter
                                                language="swift"
                                                style={syntaxTheme}
                                                customStyle={{
                                                    margin: 0,
                                                    padding: '1.5rem',
                                                    fontSize: '11px',
                                                    lineHeight: '1.6',
                                                }}
                                                showLineNumbers={true}
                                                wrapLines={true}
                                                lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none" }}
                                                lineProps={(lineNumber: number) => {
                                                    if (errorLines.has(lineNumber)) {
                                                        return {
                                                            style: {
                                                                backgroundColor: 'rgba(239,68,68,0.15)',
                                                                borderLeft: '3px solid #ef4444',
                                                                marginLeft: '-3px',
                                                                display: 'block',
                                                            },
                                                            title: parsedError?.summary || 'Error on this line',
                                                        };
                                                    }
                                                    return { style: { display: 'block' } };
                                                }}
                                            >
                                                {transaction.script}
                                            </SyntaxHighlighter>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-24 text-zinc-600 border border-zinc-200 dark:border-white/5 border-dashed rounded-sm">
                                            <p className="text-xs uppercase tracking-widest">No Script Content Available</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'events' && (
                            <div className="space-y-6">
                                {transaction.events && transaction.events.length > 0 ? (
                                    transaction.events.map((event: any, idx: number) => (
                                        <div key={idx} className="relative pl-6 border-l border-zinc-200 dark:border-white/5 hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-all group/event">
                                            <div className="absolute left-0 top-0 -translate-x-1/2 w-2 h-2 bg-nothing-green-dark/20 dark:bg-nothing-green/20 border border-nothing-green-dark/40 dark:border-nothing-green/40 rounded-full group-hover/event:bg-nothing-green-dark dark:group-hover/event:bg-nothing-green group-hover/event:scale-125 transition-all"></div>

                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
                                                <div className="flex flex-col">
                                                    <p className="text-xs font-bold text-nothing-green-dark dark:text-nothing-green mb-1 tracking-wider">
                                                        {event.event_name || event.type?.split('.').pop() || 'Unknown'}
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        {formatAddress(event.contract_address) && event.contract_name ? (
                                                            <Link to={`/contracts/A.${formatAddress(event.contract_address).replace(/^0x/, '')}.${event.contract_name}` as any} className="text-[10px] font-mono text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors">
                                                                A.{formatAddress(event.contract_address).replace(/^0x/, '')}.{event.contract_name}
                                                            </Link>
                                                        ) : formatAddress(event.contract_address) ? (
                                                            <AddressLink address={formatAddress(event.contract_address)} size={12} className="text-[10px]" />
                                                        ) : (
                                                            <span className="text-[10px] text-zinc-500 font-mono">{event.contract_name ? `flow.${event.contract_name}` : 'System'}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className="text-[10px] text-zinc-600 dark:text-zinc-700 font-mono bg-zinc-100 dark:bg-white/5 px-2 py-0.5 rounded uppercase">
                                                    Index #{event.event_index}
                                                </span>
                                            </div>

                                            <div className="bg-zinc-50 dark:bg-black/40 rounded-sm border border-zinc-200 dark:border-white/5 p-4 group-hover/event:bg-zinc-100 dark:group-hover/event:bg-black/60 transition-colors max-h-[400px] overflow-y-auto">
                                                <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: highlightJSON(JSON.stringify(formatEventPayload(event.values || event.payload || event.data), null, 2)) }} />
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                                        <Database className="h-8 w-8 mb-2 opacity-20" />
                                        <p className="text-xs uppercase tracking-widest">No Events Emitted</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'evm' && fullTx.is_evm && (
                            <div className="space-y-6">
                                {fullTx.evm_executions && fullTx.evm_executions.length > 0 ? (
                                    fullTx.evm_executions.map((exec: any, idx: number) => (
                                        <div key={idx} className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                                            <div className="bg-zinc-50 dark:bg-black/40 px-4 py-3 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between">
                                                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                                                    EVM Execution {fullTx.evm_executions.length > 1 ? `#${idx + 1}` : ''}
                                                </span>
                                                <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm border ${
                                                    exec.status === 'SEALED' || exec.status === 'SUCCESS'
                                                        ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10'
                                                        : 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10'
                                                }`}>
                                                    {exec.status || 'UNKNOWN'}
                                                </span>
                                            </div>
                                            <div className="p-4 space-y-4">
                                                {/* EVM Hash */}
                                                <div>
                                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">EVM Hash</p>
                                                    <div className="flex items-center gap-2">
                                                        <code className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all">
                                                            0x{exec.hash?.replace(/^0x/i, '')}
                                                        </code>
                                                        <a
                                                            href={`https://evm.flowindex.io/tx/0x${exec.hash?.replace(/^0x/i, '')}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-zinc-400 hover:text-blue-500 transition-colors flex-shrink-0"
                                                            title="View on FlowScan EVM"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                    </div>
                                                </div>

                                                {/* From / To */}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div>
                                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">From</p>
                                                        <div className="flex items-center gap-2">
                                                            <code className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">
                                                                {exec.from ? `0x${exec.from.replace(/^0x/i, '')}` : 'N/A'}
                                                            </code>
                                                            {exec.from && (
                                                                <a
                                                                    href={`https://evm.flowindex.io/address/0x${exec.from?.replace(/^0x/i, '')}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-zinc-400 hover:text-blue-500 transition-colors flex-shrink-0"
                                                                >
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">To</p>
                                                        <div className="flex items-center gap-2">
                                                            <code className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">
                                                                {exec.to ? `0x${exec.to.replace(/^0x/i, '')}` : 'Contract Creation'}
                                                            </code>
                                                            {exec.to && (
                                                                <a
                                                                    href={`https://evm.flowindex.io/address/0x${exec.to?.replace(/^0x/i, '')}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-zinc-400 hover:text-blue-500 transition-colors flex-shrink-0"
                                                                >
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Value / Gas / Nonce / Type */}
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <div className="bg-zinc-50 dark:bg-black/30 p-3 border border-zinc-200 dark:border-white/5 rounded-sm">
                                                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Value</p>
                                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">
                                                            {exec.value && exec.value !== '0' ? `${(Number(exec.value) / 1e18).toFixed(6)}` : '0'} FLOW
                                                        </p>
                                                    </div>
                                                    <div className="bg-zinc-50 dark:bg-black/30 p-3 border border-zinc-200 dark:border-white/5 rounded-sm">
                                                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Gas Used / Limit</p>
                                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">
                                                            {Number(exec.gas_used).toLocaleString()} / {Number(exec.gas_limit).toLocaleString()}
                                                        </p>
                                                    </div>
                                                    <div className="bg-zinc-50 dark:bg-black/30 p-3 border border-zinc-200 dark:border-white/5 rounded-sm">
                                                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Gas Price</p>
                                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">
                                                            {exec.gas_price || '0'}
                                                        </p>
                                                    </div>
                                                    <div className="bg-zinc-50 dark:bg-black/30 p-3 border border-zinc-200 dark:border-white/5 rounded-sm">
                                                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Nonce</p>
                                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">
                                                            {exec.nonce}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Type + Position */}
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <div className="bg-zinc-50 dark:bg-black/30 p-3 border border-zinc-200 dark:border-white/5 rounded-sm">
                                                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Tx Type</p>
                                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">
                                                            {exec.type === 0 ? 'Legacy (0)' : exec.type === 2 ? 'EIP-1559 (2)' : `Type ${exec.type}`}
                                                        </p>
                                                    </div>
                                                    <div className="bg-zinc-50 dark:bg-black/30 p-3 border border-zinc-200 dark:border-white/5 rounded-sm">
                                                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Position</p>
                                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">
                                                            {exec.position}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Decoded EVM Payload + Raw TX Payload tabs */}
                                                {(() => {
                                                    // Build decoded EVM payload from execution data
                                                    const decodedPayload: Record<string, any> = {
                                                        hash: exec.hash ? `0x${exec.hash.replace(/^0x/, '')}` : null,
                                                        type: exec.type,
                                                        from: exec.from ? `0x${exec.from.replace(/^0x/, '')}` : null,
                                                        to: exec.to ? `0x${exec.to.replace(/^0x/, '')}` : null,
                                                        value: exec.value || '0',
                                                        nonce: exec.nonce,
                                                        gas_limit: exec.gas_limit,
                                                        gas_used: exec.gas_used,
                                                        gas_price: exec.gas_price || '0',
                                                        status: exec.status,
                                                        position: exec.position,
                                                        event_index: exec.event_index,
                                                        block_number: exec.block_number,
                                                        timestamp: exec.timestamp,
                                                    };
                                                    // Also include raw EVM-specific fields from matched event payload if present
                                                    const matchedEvent = transaction.events?.find(
                                                        (e: any) => e.event_index === exec.event_index
                                                    );
                                                    const eventPayload = matchedEvent?.values || matchedEvent?.payload || matchedEvent?.data;
                                                    let rawTxPayloadHex: string | null = null;
                                                    if (eventPayload) {
                                                        const formatted = formatEventPayload(eventPayload);
                                                        if (formatted.payload) {
                                                            rawTxPayloadHex = formatted.payload;
                                                            decodedPayload.raw_tx_payload = formatted.payload;
                                                        }
                                                        if (formatted.logs) decodedPayload.logs = formatted.logs;
                                                        if (formatted.returnedData) decodedPayload.returned_data = formatted.returnedData;
                                                        if (formatted.errorMessage) decodedPayload.error_message = formatted.errorMessage;
                                                        if (formatted.errorCode && formatted.errorCode !== '0') decodedPayload.error_code = formatted.errorCode;
                                                        if (formatted.contractAddress) decodedPayload.contract_address = formatted.contractAddress;
                                                    }
                                                    // Try to decode the raw_tx_payload (Flow direct call 0xff format)
                                                    const decodedRawTx = rawTxPayloadHex ? decodeFlowDirectCallPayload(rawTxPayloadHex) : null;

                                                    const isExpanded = expandedPayloads[idx] ?? false;
                                                    const payloadTabKey = `evm_payload_tab_${idx}`;
                                                    const activePayloadTab = (expandedPayloads as any)[payloadTabKey] || (decodedRawTx ? 'raw' : 'evm');
                                                    return (
                                                        <div className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                                            <button
                                                                onClick={() => setExpandedPayloads(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                                                className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-black/50 transition-colors text-left"
                                                            >
                                                                <span className="text-[10px] text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                                                    <Database className="h-3 w-3" />
                                                                    Decoded Payload
                                                                </span>
                                                                <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                            </button>
                                                            <div
                                                                className="grid transition-[grid-template-rows] duration-200 ease-out"
                                                                style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                                                            >
                                                                <div className="overflow-hidden">
                                                                    {/* Sub-tabs: Raw TX Payload (default) | EVM Payload */}
                                                                    {decodedRawTx && (
                                                                        <div className="flex border-b border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-black/30">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setExpandedPayloads(prev => ({ ...prev, [payloadTabKey]: 'raw' })); }}
                                                                                className={`px-4 py-2 text-[10px] uppercase tracking-widest transition-colors ${activePayloadTab === 'raw' ? 'text-zinc-900 dark:text-white border-b-2 border-zinc-900 dark:border-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                                                            >
                                                                                Raw TX Payload
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setExpandedPayloads(prev => ({ ...prev, [payloadTabKey]: 'evm' })); }}
                                                                                className={`px-4 py-2 text-[10px] uppercase tracking-widest transition-colors ${activePayloadTab === 'evm' ? 'text-zinc-900 dark:text-white border-b-2 border-zinc-900 dark:border-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                                                            >
                                                                                EVM Payload
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                    <div className="p-4 bg-zinc-50 dark:bg-black/40 border-t border-zinc-200 dark:border-white/5 max-h-[400px] overflow-y-auto">
                                                                        {activePayloadTab === 'raw' && decodedRawTx ? (
                                                                            <pre className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-all">
                                                                                {JSON.stringify({
                                                                                    type: 'Flow Direct Call (0xff)',
                                                                                    nonce: decodedRawTx.nonce,
                                                                                    sub_type: decodedRawTx.subType,
                                                                                    from: decodedRawTx.from || null,
                                                                                    to: decodedRawTx.to || 'Contract Creation',
                                                                                    data: decodedRawTx.data || null,
                                                                                    value: `${decodedRawTx.value} FLOW`,
                                                                                    gas_limit: decodedRawTx.gasLimit,
                                                                                    raw: rawTxPayloadHex,
                                                                                }, null, 2)}
                                                                            </pre>
                                                                        ) : (
                                                                            <pre className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-all">
                                                                                {JSON.stringify(decodedPayload, null, 2)}
                                                                            </pre>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    /* Fallback to legacy fields when evm_executions not available */
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                            <p className="text-[10px] text-zinc-500 uppercase">EVM Hash</p>
                                            <div className="flex items-center gap-2">
                                                <p className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all">{fullTx.evm_hash}</p>
                                                {fullTx.evm_hash && (
                                                    <a href={`https://evm.flowindex.io/tx/${fullTx.evm_hash}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-blue-500 flex-shrink-0">
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                            <p className="text-[10px] text-zinc-500 uppercase">Value</p>
                                            <p className="text-xs text-zinc-700 dark:text-white font-mono">{fullTx.evm_value ? `${parseInt(fullTx.evm_value, 16) / 1e18}` : '0'} FLOW</p>
                                        </div>
                                        <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                            <p className="text-[10px] text-zinc-500 uppercase">From</p>
                                            <p className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">{fullTx.evm_from || 'N/A'}</p>
                                        </div>
                                        <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                            <p className="text-[10px] text-zinc-500 uppercase">To</p>
                                            <p className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">{fullTx.evm_to || 'Contract Creation'}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* NFT Detail Modal */}
            {selectedNft && (
                <NFTDetailModal
                    nft={selectedNft}
                    collectionId={selectedNftCollection.id}
                    collectionName={selectedNftCollection.name}
                    onClose={() => setSelectedNft(null)}
                />
            )}
        </div>
    );
}
