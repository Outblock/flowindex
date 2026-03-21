import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AddressLink, avatarVariant, colorsFromAddress } from '../../components/AddressLink';
import Avatar from 'boring-avatars';
import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { resolveApiBaseUrl } from '../../api';
import { buildMeta } from '../../lib/og/meta';
import { ArrowLeft, Activity, User, Box, Clock, CheckCircle, XCircle, Hash, ArrowRightLeft, ArrowRight, Coins, Image as ImageIcon, Zap, Database, AlertCircle, FileText, Layers, Braces, ExternalLink, Repeat, Globe, ChevronDown, Sparkles, Play, WrapText, Loader2 } from 'lucide-react';
import { openAIChat } from '../../components/chat/openAIChat';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import DecryptedText from '../../components/ui/DecryptedText';
import { deriveAllActivityBadges, TokenIcon, formatTokenName, buildSummaryLine, NFTTransferImage, fetchNFTFullDetail, useNFTLazyDetail } from '../../components/TransactionRow';
import { formatShort } from '../../components/account/accountUtils';
import AISummary from '../../components/tx/AISummary';
import TransferFlowDiagram from '../../components/tx/TransferFlowDiagram';
import TxResolvedAddress from '../../components/tx/TxResolvedAddress';
import { NotFoundPage } from '../../components/ui/NotFoundPage';
import { deriveEnrichments, decodeEVMCallData } from '../../lib/deriveFromEvents';
import { buildTxDetailAssetView, type TxDetailDisplayTransferRow } from '../../lib/txAssetFlow';
import { buildTxAddressBook, type TxAddressBook } from '../../lib/txAddressBook';
import { NFTDetailModal } from '../../components/NFTDetailModal';
import { UsdValue } from '../../components/UsdValue';
import { parseCadenceError } from '../../lib/parseCadenceError';
import { sha256Hex, normalizedScriptHash } from '../../lib/normalizeScript';
import { EVMTxDetail } from '@/components/evm/EVMTxDetail';
import { getEVMTransaction } from '@/api/evm';
import type { BSTransaction } from '@/types/blockscout';

SyntaxHighlighter.registerLanguage('cadence', swift);
SyntaxHighlighter.registerLanguage('json', json);

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

function stringifyDecodedValue(value: any): string {
    if (value == null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function isEvmAddressLike(value: unknown): value is string {
    return typeof value === 'string' && /^0x[a-f0-9]{40}$/i.test(value);
}

function EVMMetaBadges({ meta }: { meta?: any }) {
    if (!meta) return null;
    return (
        <div className="mt-1.5 flex flex-wrap gap-1">
            {meta.proxy_type && (
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-purple-200 dark:border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10">
                    Proxy
                </span>
            )}
            {Array.isArray(meta.tags) && meta.tags.slice(0, 2).map((tag: string) => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-sm border border-zinc-200 dark:border-white/10 text-zinc-500 bg-zinc-50 dark:bg-black/20">
                    {tag}
                </span>
            ))}
        </div>
    );
}

function evmAddressHref(address?: string): string {
    if (!address) return 'https://evm.flowindex.io';
    return `https://evm.flowindex.io/address/0x${address.replace(/^0x/i, '')}`;
}

function EVMEntityLink({ address, meta, fallbackLabel }: { address?: string; meta?: any; fallbackLabel?: string }) {
    const label = String(meta?.label || meta?.contract_name || '').trim();
    const href = evmAddressHref(address);
    const verified = Boolean(meta?.verified);
    const kind = meta?.kind as string | undefined; // "coa" | "eoa" | "contract" | "token"
    const flowAddr = meta?.flow_address as string | undefined;

    // Badge for COA/EOA (not for contracts/tokens which have their own labels)
    const kindBadge = kind === 'coa' ? (
        <span className="text-[9px] font-bold uppercase px-1 py-px rounded-sm leading-none bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">COA</span>
    ) : kind === 'eoa' ? (
        <span className="text-[9px] font-bold uppercase px-1 py-px rounded-sm leading-none bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">EOA</span>
    ) : null;

    // Has a named label (contract name, token name, etc.)
    if (label) {
        return (
            <div className="flex items-center gap-1.5 min-w-0">
                {address && (
                    <Avatar
                        size={16}
                        name={`0x${address.replace(/^0x/i, '')}`}
                        variant={avatarVariant(`0x${address.replace(/^0x/i, '')}`)}
                        colors={colorsFromAddress(`0x${address.replace(/^0x/i, '')}`)}
                    />
                )}
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium truncate"
                    title={label}
                >
                    {label}
                </a>
                {verified && <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />}
                <ExternalLink className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                {kindBadge}
            </div>
        );
    }

    // Has address but no label — show the address with avatar + COA/EOA badge
    if (address) {
        const normalized = `0x${address.replace(/^0x/i, '')}`;
        return (
            <div className="flex items-center gap-1.5 min-w-0">
                <Avatar
                    size={16}
                    name={normalized}
                    variant={avatarVariant(normalized)}
                    colors={colorsFromAddress(normalized)}
                />
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
                >
                    {normalized.slice(0, 10)}…{normalized.slice(-8)}
                </a>
                <ExternalLink className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                {kindBadge}
                {flowAddr && (
                    <span className="text-[10px] text-purple-500 inline-flex items-center gap-0.5">
                        → <AddressLink address={flowAddr} prefixLen={8} suffixLen={4} size={12} className="text-[10px] text-purple-500" />
                    </span>
                )}
            </div>
        );
    }

    // No address at all — show fallback
    return (
        <div className="flex items-center gap-2">
            <code className="text-xs text-zinc-700 dark:text-zinc-300 font-mono">
                {fallbackLabel || '—'}
            </code>
        </div>
    );
}

function getEVMExecutionHeaderLink(exec: any, events?: any[]): { href: string; label: string; verified: boolean } | null {
    const label = getEvmExecutionDisplayLabel(exec, events);
    if (!label) return null;
    return {
        href: exec?.to ? evmAddressHref(exec.to) : `https://evm.flowindex.io/tx/0x${String(exec?.hash || '').replace(/^0x/i, '')}`,
        label,
        verified: Boolean(exec?.to_meta?.verified),
    };
}

type EvmExecutionTag = {
    label: string;
    className: string;
    mono?: boolean;
};

function formatEventPayloadValue(data: any): any {
    if (data == null) return data;
    if (Array.isArray(data)) {
        if (data.length > 0 && data.every((v: any) => typeof v === 'string' && /^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 255)) {
            const hex = data.map((v: string) => Number(v).toString(16).padStart(2, '0')).join('');
            return `0x${hex}`;
        }
        return data.map(formatEventPayloadValue);
    }
    if (typeof data === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
            out[k] = formatEventPayloadValue(v);
        }
        return out;
    }
    return data;
}

function getExecutionCallData(exec: any, events?: any[]): string {
    if (exec?.data) return exec.data;
    const matchedEvt = events?.find((event: any) => event.event_index === exec?.event_index);
    const evtPayload = matchedEvt?.values || matchedEvt?.payload || matchedEvt?.data;
    if (!evtPayload) return '';
    const formatted = formatEventPayloadValue(evtPayload);
    if (!formatted?.payload) return '';
    return decodeFlowDirectCallPayload(formatted.payload)?.data || '';
}

function inferEvmMethodLabel(exec: any, events?: any[]): string {
    const method = String(exec?.decoded_call?.method || '').trim();
    if (method) return `${method}()`;

    const signature = String(exec?.decoded_call?.signature || '').trim();
    const signatureMatch = signature.match(/^([A-Za-z0-9_]+)\s*\(/);
    if (signatureMatch?.[1]) return `${signatureMatch[1]}()`;

    const callData = getExecutionCallData(exec, events);
    if (!callData) return '';

    const decoded = decodeEVMCallData(callData);
    switch (decoded.callType) {
        case 'erc20_transfer':
            return 'transfer()';
        case 'erc20_transferFrom':
            return 'transferFrom()';
        case 'erc721_safeTransferFrom':
            return 'safeTransferFrom()';
        case 'erc1155_safeTransferFrom':
            return 'safeTransferFrom()';
        case 'erc1155_safeBatchTransferFrom':
            return 'safeBatchTransferFrom()';
        default:
            return '';
    }
}

function getEvmExecutionDisplayLabel(exec: any, events?: any[]): string {
    const contract = String(
        exec?.to_meta?.label ||
        exec?.decoded_call?.implementation_name ||
        exec?.decoded_call?.contract_name ||
        exec?.to_meta?.contract_name ||
        ''
    ).trim();
    const methodLabel = inferEvmMethodLabel(exec, events);
    if (contract && methodLabel) return `${contract}.${methodLabel}`;
    if (contract) return contract;
    return methodLabel;
}

function getEvmStandardTag(callType: string, value?: string | number): EvmExecutionTag | null {
    const standard = (() => {
        if (callType.startsWith('erc20')) return 'ERC-20';
        if (callType.startsWith('erc721')) return 'ERC-721';
        if (callType.startsWith('erc1155')) return 'ERC-1155';
        const numericValue = typeof value === 'number' ? value : Number(value || 0);
        if (numericValue > 0) return 'Native';
        return '';
    })();

    if (!standard) return null;

    const className = standard === 'ERC-20'
        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
        : standard === 'ERC-721'
            ? 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30'
            : standard === 'ERC-1155'
                ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                : 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30';

    return { label: standard, className };
}

function getEvmExecutionLabelTag(exec: any, events?: any[]): EvmExecutionTag | null {
    const label = getEvmExecutionDisplayLabel(exec, events);

    if (!label) return null;

    return {
        label,
        className: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',
        mono: label.includes('()'),
    };
}

function getEvmExecutionTags(exec: any, events?: any[]): EvmExecutionTag[] {
    const tags: EvmExecutionTag[] = [];
    const labelTag = getEvmExecutionLabelTag(exec, events);
    if (labelTag) tags.push(labelTag);

    const callData = getExecutionCallData(exec, events);
    const decoded = callData ? decodeEVMCallData(callData) : { callType: 'unknown' };
    const standardTag = getEvmStandardTag(decoded.callType || 'unknown', exec?.value);
    if (standardTag) tags.push(standardTag);

    return tags;
}

function JsonPayloadBlock({ value, isDark }: { value: unknown; isDark: boolean }) {
    return (
        <SyntaxHighlighter
            language="json"
            style={isDark ? vscDarkPlus : oneLight}
            customStyle={{
                margin: 0,
                padding: '0.875rem 1rem',
                fontSize: '11px',
                lineHeight: '1.7',
                borderRadius: '0',
                background: 'transparent',
            }}
            wrapLongLines
        >
            {JSON.stringify(value, null, 2)}
        </SyntaxHighlighter>
    );
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
                    {nt.transfer_type === 'stake' && (
                        <span className="text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Stake</span>
                    )}
                    {nt.transfer_type === 'unstake' && (
                        <span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Unstake</span>
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

/** Simple Cadence code formatter — normalizes indentation based on brace nesting. */
function formatCadenceScript(script: string): string {
    const TAB = '    ';

    // Phase 1: Expand inline blocks — split lines like `fun foo() {stmt1;stmt2;return x}`
    // into multi-line form before re-indenting.
    const expanded: string[] = [];
    for (const rawLine of script.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed) { expanded.push(''); continue; }
        // Match pattern: `prefix { body }` where body has `;` (multiple statements)
        const m = trimmed.match(/^(.+?)\s*\{(.+)\}\s*$/);
        if (m && m[2].includes(';')) {
            const prefix = m[1];
            const body = m[2].trim();
            // Split on `;` preserving the semicolons
            const stmts = body.split(';').map(s => s.trim()).filter(Boolean);
            expanded.push(`${prefix} {`);
            for (let i = 0; i < stmts.length; i++) {
                const stmt = stmts[i];
                // Last statement might not need semicolon (e.g. "return x")
                const needsSemi = i < stmts.length - 1 || (!stmt.startsWith('return ') && !stmt.startsWith('return;'));
                expanded.push(`    ${stmt}${needsSemi ? ';' : ''}`);
            }
            expanded.push('}');
        } else {
            expanded.push(trimmed);
        }
    }

    // Phase 2: Re-indent based on brace nesting
    let indent = 0;
    const result: string[] = [];
    for (const rawLine of expanded) {
        const trimmed = rawLine.trim();
        if (!trimmed) { result.push(''); continue; }
        const leadingClose = trimmed.match(/^[}\])]+/);
        if (leadingClose) indent = Math.max(0, indent - leadingClose[0].length);
        result.push(TAB.repeat(indent) + trimmed);
        let net = 0;
        for (const ch of trimmed) {
            if (ch === '{') net++;
            else if (ch === '}') net--;
        }
        indent = Math.max(0, indent + net);
    }
    return result.join('\n');
}

export const Route = createFileRoute('/txs/$txId')({
    component: TransactionDetail,
    validateSearch: (search: Record<string, unknown>) => ({
        tab: (search.tab as string) || undefined,
        view: (search.view as string) || undefined,
    }),
    loader: async ({ params, search }) => {
        try {
            const forceEVM = (search as any)?.view === 'evm';

            // If ?view=evm, ONLY try Blockscout — never fall through to Cadence
            if (forceEVM && /^0x[0-9a-fA-F]{64}$/.test(params.txId)) {
                try {
                    const evmTx = await getEVMTransaction(params.txId);
                    if (evmTx?.hash) {
                        return { transaction: null, evmTransaction: evmTx as BSTransaction, isEVM: true, error: null as string | null };
                    }
                } catch {
                    // Blockscout failed
                }
                return { transaction: null, evmTransaction: null as BSTransaction | null, isEVM: false, error: 'EVM transaction not found in Blockscout' };
            }

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
                return { transaction: transformedTx, evmTransaction: null as BSTransaction | null, isEVM: false, error: null as string | null };
            }
            // Backend's /flow/transaction/{id} already checks evm_tx_hashes
            // and evm_transactions tables for EVM hash → Cadence tx resolution.
            // If it returned 404, the EVM hash isn't indexed yet — try Blockscout EVM proxy.
            if (res.status === 404 || !res.ok) {
                // Fallback: if txId looks like an EVM hash, try Blockscout proxy
                if (/^0x[0-9a-fA-F]{64}$/.test(params.txId)) {
                    try {
                        const evmTx = await getEVMTransaction(params.txId);
                        if (evmTx?.hash) {
                            return { transaction: null, evmTransaction: evmTx as BSTransaction, isEVM: true, error: null as string | null };
                        }
                    } catch {
                        // EVM fetch failed too — fall through to not-found
                    }
                }
                return { transaction: null, evmTransaction: null as BSTransaction | null, isEVM: false, error: res.status === 404 ? 'Transaction not found' : 'Failed to load transaction details' };
            }
            return { transaction: null, evmTransaction: null as BSTransaction | null, isEVM: false, error: 'Failed to load transaction details' };
        } catch (e) {
            const message = (e as any)?.message;
            console.error('Failed to load transaction data', { message });
            // Also try EVM fallback on network errors
            if (/^0x[0-9a-fA-F]{64}$/.test(params.txId)) {
                try {
                    const evmTx = await getEVMTransaction(params.txId);
                    if (evmTx?.hash) {
                        return { transaction: null, evmTransaction: evmTx as BSTransaction, isEVM: true, error: null as string | null };
                    }
                } catch {
                    // EVM fetch failed too
                }
            }
            return { transaction: null, evmTransaction: null as BSTransaction | null, isEVM: false, error: 'Failed to load transaction details' };
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

/** Injects an error annotation below the target line element in SyntaxHighlighter via DOM */
function ScriptErrorAnnotation({ targetId, message, line, isDark }: { targetId: string; message: string; line: number; isDark: boolean }) {
    useEffect(() => {
        const el = document.getElementById(targetId);
        if (!el) return;
        // Check if annotation already injected
        if (el.nextElementSibling?.getAttribute('data-error-annotation') === 'true') return;

        // Measure the line number gutter width from the first <span> child (the line number)
        const lineNumSpan = el.querySelector('span.react-syntax-highlighter-line-number, span.linenumber, [style*="userSelect"]');
        let gutterPx = 56; // fallback
        if (lineNumSpan) {
            const rect = lineNumSpan.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            gutterPx = rect.right - elRect.left + 4; // right edge of line number + small gap
        }

        const annotation = document.createElement('div');
        annotation.setAttribute('data-error-annotation', 'true');
        annotation.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 12px 3px ${gutterPx}px;font-size:10px;font-family:ui-monospace,monospace;background:${isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)'};border-left:3px solid #ef4444;margin-left:-3px;color:#f87171;`;
        annotation.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>Line ${line}: ${message.replace(/</g, '&lt;')}</span>`;
        el.parentNode?.insertBefore(annotation, el.nextSibling);
        return () => { annotation.remove(); };
    }, [targetId, message, line, isDark]);
    return null;
}

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

function FlowRow({ from, to, amount, symbol, logo, badge, usdPrice, addressBook, transferType }: {
    from?: string; to?: string; amount?: string | number; symbol?: string; logo?: string; badge?: React.ReactNode;
    usdPrice?: number;
    addressBook: TxAddressBook;
    transferType?: string;
}) {
    const formattedAmount = amount != null ? Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—';
    return (
        <div className="flex items-center gap-0 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
            {/* FROM */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 min-w-0 flex-shrink-0">
                {from ? (
                    <TxResolvedAddress address={from} book={addressBook} prefixLen={8} suffixLen={4} reserveLabelSpace size={14} />
                ) : (
                    <span className="text-[11px] text-zinc-400 italic">{transferType === 'unstake' ? 'Unstake' : transferType === 'mint' ? 'Mint' : ''}</span>
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
                    <TxResolvedAddress address={to} book={addressBook} prefixLen={8} suffixLen={4} reserveLabelSpace size={14} />
                ) : (
                    <span className="text-[11px] text-zinc-400 italic">{transferType === 'stake' ? 'Stake' : transferType === 'burn' ? 'Burn' : ''}</span>
                )}
            </div>
        </div>
    );
}

function renderTransferRowBadge(row: TxDetailDisplayTransferRow): React.ReactNode {
    const badges: React.ReactNode[] = [];
    if (row.layer === 'evm') {
        badges.push(
            <span className="inline-flex items-center gap-1 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                <Globe className="w-2.5 h-2.5" /> EVM
            </span>
        );
    }
    if (row.layer === 'cross_vm') {
        badges.push(
            <span className="inline-flex items-center gap-1 text-[9px] text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                <Globe className="w-2.5 h-2.5" /> Cross-VM
            </span>
        );
    }
    if (row.layer === 'cadence') {
        badges.push(
            <span className="inline-flex items-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                <Globe className="w-2.5 h-2.5" /> Cadence
            </span>
        );
    }
    if (row.count > 1) {
        badges.push(
            <span className="text-[9px] text-zinc-500 bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                ×{row.count}
            </span>
        );
    }
    if (badges.length === 0) return null;
    return <>{badges.map((badge, index) => <span key={index}>{badge}</span>)}</>;
}

function TransactionSummaryCard({ transaction, assetView, addressBook, formatAddress: _formatAddress, onNftClick, isAdmin, isRefreshing = false }: { transaction: any; assetView: ReturnType<typeof buildTxDetailAssetView>; addressBook: TxAddressBook; formatAddress: (addr: string) => string; onNftClick?: (nt: any) => void; isAdmin?: boolean; isRefreshing?: boolean }) {
    const summaryLine = assetView.summaryLine || buildSummaryLine(assetView.summaryTransaction);
    const hasFT = assetView.transferListRows.length > 0;
    const hasDefi = transaction.defi_events?.length > 0;
    const hasEvm = Boolean(transaction.is_evm || transaction.evm_hash || transaction.evm_executions?.length > 0);
    const tags = (transaction.tags || []).map((t: string) => t.toLowerCase());
    const isDeploy = tags.some((t: string) => t.includes('deploy') || t.includes('contract_added') || t.includes('contract_updated'));
    const hasContractImports = transaction.contract_imports?.length > 0;

    const fmtAddr = (addr: string) => formatShort(addr, 8, 4);
    const evmSteps = hasEvm
        ? (transaction.evm_executions || [])
            .map((exec: any) => getEvmExecutionDisplayLabel(exec, transaction.events))
            .filter(Boolean)
            .filter((step: string, index: number, arr: string[]) => arr.indexOf(step) === index)
            .slice(0, 4)
        : [];

    // NFT collection banner image (gradient overlay like tx list)
    const nftBannerUrl = transaction.nft_transfers?.length > 0
        ? cleanUrl(transaction.nft_transfers[0].collection_logo)
        : '';

    return (
        <div className="relative overflow-hidden border border-zinc-200 dark:border-white/10 p-6 mb-8 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
            {isRefreshing && (
                <div className="absolute inset-x-0 top-0 h-[3px] bg-zinc-100 dark:bg-white/5 overflow-hidden">
                    <div className="h-full w-1/3 bg-gradient-to-r from-nothing-green-dark via-nothing-green to-sky-400 animate-[pulse_1.2s_ease-in-out_infinite]" />
                </div>
            )}
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
                <div className="flex items-center gap-2 flex-wrap">
                    {isRefreshing && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 border rounded-sm text-[10px] uppercase tracking-wider border-sky-200 dark:border-sky-500/30 text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Updating
                        </span>
                    )}
                    {deriveAllActivityBadges(transaction).map((b, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-sm text-[10px] font-bold uppercase tracking-wider ${b.bgColor} ${b.color}`}>
                            {b.label}
                        </span>
                    ))}
                </div>
            </div>

            {/* Summary line */}
            {summaryLine && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{summaryLine}</p>
            )}

            {/* Transfer flow diagram (auto-synthesized) */}
            <div className="mb-4">
                <TransferFlowDiagram detail={assetView.canonicalTransaction} addressBook={addressBook} />
            </div>

            {hasFT && (
                <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Token Transfers</p>
                        <span className="text-[9px] text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{assetView.transferListRows.length}</span>
                    </div>
                    {assetView.transferListRows.slice(0, 10).map((row, idx) => (
                        <FlowRow
                            key={`${row.layer}-${row.from}-${row.to}-${row.symbol}-${idx}`}
                            from={row.from}
                            to={row.to}
                            amount={row.amount}
                            symbol={row.symbol}
                            logo={row.logo}
                            usdPrice={row.amount > 0 ? row.usdValue / row.amount : 0}
                            addressBook={addressBook}
                            badge={renderTransferRowBadge(row)}
                            transferType={row.transferType}
                        />
                    ))}
                    {assetView.transferListRows.length > 10 && (
                        <p className="text-[10px] text-zinc-400 uppercase tracking-wider pl-1">+{assetView.transferListRows.length - 10} more</p>
                    )}
                </div>
            )}

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

            {evmSteps.length > 0 && (
                <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest">EVM Calls</p>
                        <span className="text-[9px] text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{evmSteps.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {evmSteps.map((step: string, idx: number) => (
                            <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-blue-200 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/10 text-[10px] text-blue-700 dark:text-blue-300 font-mono">
                                <Zap className="w-3 h-3" />
                                {step}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* EVM hash links — show all EVM tx hashes from executions (or legacy field) */}
            {hasEvm && (() => {
                const executionRows = (transaction.evm_executions || [])
                    .filter((exec: any) => exec?.hash)
                    .map((exec: any) => ({
                        hash: exec.hash,
                        tags: getEvmExecutionTags(exec, transaction.events),
                    }));
                const fallbackHashes = executionRows.length === 0 && transaction.evm_hash ? [{ hash: transaction.evm_hash, tags: [] as EvmExecutionTag[] }] : [];
                const rows = executionRows.length > 0 ? executionRows : fallbackHashes;
                return rows.length > 0 ? (
                    <div className="space-y-1.5 mb-4">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">EVM Hash{rows.length > 1 ? 'es' : ''}</span>
                        {rows.map((row, idx) => (
                            <div key={`${row.hash}-${idx}`} className="flex flex-col gap-3 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 p-3 rounded-sm md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Link
                                        to={`/txs/evm/$txId` as any}
                                        params={{ txId: `0x${row.hash.replace(/^0x/, '')}` }}
                                        className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all min-w-0 hover:underline"
                                    >
                                        0x{row.hash.replace(/^0x/, '')}
                                    </Link>
                                    <a href={`https://evm.flowindex.io/tx/0x${row.hash.replace(/^0x/, '')}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-blue-500 transition-colors flex-shrink-0">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                </div>
                                {row.tags.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap md:justify-end md:max-w-[48%]">
                                        {row.tags.map((tag, tagIndex) => (
                                            <span
                                                key={`${row.hash}-${tag.label}-${tagIndex}`}
                                                className={`inline-flex items-center px-2 py-1 rounded-sm border text-[10px] ${tag.mono ? 'font-mono' : 'font-semibold uppercase tracking-wider'} ${tag.className}`}
                                            >
                                                {tag.label}
                                            </span>
                                        ))}
                                    </div>
                                )}
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
                <AISummary transaction={assetView.summaryTransaction} />
            </div>
        </div>
    );
}

function TransactionDetail() {
    const { txId } = Route.useParams();
    const { tab: urlTab } = Route.useSearch();
    const navigate = useNavigate();
    const { transaction, evmTransaction, isEVM, error: loaderError } = Route.useLoaderData();

    const error = transaction ? null : (loaderError || 'Transaction not found');

    // Derive enrichments locally from events + script (no backend call needed)
    const enrichments = useMemo(() => {
        if (!transaction?.events?.length) return null;
        return deriveEnrichments(transaction.events, transaction.script);
    }, [transaction?.events, transaction?.script]);

    // Client-side full fetch to get enriched data (ft_transfers with USD, nft_transfers, defi_events)
    const [apiEnrichment, setApiEnrichment] = useState<any>(null);
    const [fullFetchSettled, setFullFetchSettled] = useState(false);
    const fullFetchDone = useRef(false);
    useEffect(() => {
        fullFetchDone.current = false;
        setApiEnrichment(null);
        setFullFetchSettled(false);
    }, [transaction?.id]);
    useEffect(() => {
        if (!transaction?.id || fullFetchDone.current) return;
        fullFetchDone.current = true;
        let cancelled = false;
        resolveApiBaseUrl().then(base =>
            fetch(`${base}/flow/transaction/${encodeURIComponent(transaction.id)}`)
                .then(r => r.ok ? r.json() : null)
                .then(json => {
                    if (cancelled) return;
                    const tx = json?.data?.[0];
                    if (tx) setApiEnrichment(tx);
                    setFullFetchSettled(true);
                })
        ).catch(() => {
            if (!cancelled) setFullFetchSettled(true);
        });
        return () => {
            cancelled = true;
        };
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

        // For ft_transfers: use API data as base (has usd_value, token metadata),
        // but event-decoder's transfer_type ALWAYS wins (more accurate, evidence-based).
        const derivedFt = enrichments?.ft_transfers;
        let ftTransfers = apiEnrichment?.ft_transfers?.length > 0
            ? apiEnrichment.ft_transfers
            : ((derivedFt && derivedFt.length > 0) ? derivedFt : transaction?.ft_transfers);
        if (ftTransfers && enrichments?.ft_transfers && enrichments.ft_transfers.length > 0 && ftTransfers !== enrichments.ft_transfers) {
            const derivedByKey = new Map<string, any>();
            for (const ft of enrichments!.ft_transfers) {
                derivedByKey.set(`${ft.token}:${ft.event_index}`, ft);
            }
            ftTransfers = ftTransfers.map((ft: any) => {
                const derived = derivedByKey.get(`${ft.token}:${ft.event_index}`);
                if (!derived) return ft;
                return {
                    ...ft,
                    // Event-decoder transfer_type is source of truth (evidence-based)
                    transfer_type: derived.transfer_type || ft.transfer_type,
                    evm_to_address: derived.evm_to_address || ft.evm_to_address,
                    evm_from_address: derived.evm_from_address || ft.evm_from_address,
                    to_address: ft.to_address || derived.to_address,
                    from_address: ft.from_address || derived.from_address,
                };
            });
        }

        const displayMetaByEvent = new Map<string, any>();
        const displayMetaByToken = new Map<string, any>();
        for (const ft of ftTransfers || []) {
            const eventKey = `${ft.token}:${ft.event_index}`;
            if (!displayMetaByEvent.has(eventKey)) displayMetaByEvent.set(eventKey, ft);
            if (ft.token && !displayMetaByToken.has(ft.token)) displayMetaByToken.set(ft.token, ft);
        }
        const rawFtTransfers = ((derivedFt && derivedFt.length > 0) ? derivedFt : (transaction?.raw_ft_transfers || ftTransfers || [])).map((ft: any) => {
            const meta = displayMetaByEvent.get(`${ft.token}:${ft.event_index}`) || displayMetaByToken.get(ft.token) || {};
            return {
                ...ft,
                token_logo: ft.token_logo || meta.token_logo,
                token_symbol: ft.token_symbol || meta.token_symbol,
                token_name: ft.token_name || meta.token_name,
                token_decimals: ft.token_decimals ?? meta.token_decimals,
                approx_usd_price: ft.approx_usd_price ?? meta.approx_usd_price,
                usd_value: ft.usd_value ?? meta.usd_value,
                transfer_type: ft.transfer_type || meta.transfer_type,
                evm_to_address: ft.evm_to_address || meta.evm_to_address,
                evm_from_address: ft.evm_from_address || meta.evm_from_address,
            };
        });

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
                    data: e.data || d.data,
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
            raw_ft_transfers: rawFtTransfers,
            canonical_transfer_summary: apiEnrichment?.canonical_transfer_summary || transaction?.canonical_transfer_summary,
            transfer_summary: apiEnrichment?.transfer_summary || transaction?.transfer_summary,
            nft_transfers: mergedNfts.length > 0 ? mergedNfts : apiNfts,
            defi_events: apiEnrichment?.defi_events?.length > 0 ? apiEnrichment.defi_events : transaction?.defi_events,
            evm_executions: evmExecs,
            contract_imports: (enrichments?.contract_imports && enrichments.contract_imports.length > 0 ? enrichments.contract_imports : apiEnrichment?.contract_imports) || transaction?.contract_imports,
            fee: enrichments?.fee || apiEnrichment?.fee || transaction?.fee,
            fee_usd: apiEnrichment?.fee_usd || transaction?.fee_usd,
        };
    }, [enrichments, apiEnrichment, transaction]);

    const assetView = useMemo(() => buildTxDetailAssetView(fullTx), [fullTx]);
    const addressBook = useMemo(() => buildTxAddressBook(fullTx), [fullTx]);
    const [transferDisplayMode, setTransferDisplayMode] = useState<'meaningful' | 'all'>('meaningful');
    const visibleTransferRows = transferDisplayMode === 'all' && assetView.rawTransferListRows.length > 0
        ? assetView.rawTransferListRows
        : assetView.transferListRows;
    const showTransferNoiseToggle = assetView.rawTransferListRows.length > assetView.transferListRows.length;
    const transferTableColumns = 'minmax(200px,1fr) minmax(180px,1fr) 36px minmax(180px,1fr) minmax(80px,auto)';
    const detailFlowReady = !transaction?.lite || !!apiEnrichment || fullFetchSettled;
    const hasTransfers = assetView.transferListRows.length > 0 || assetView.rawTransferListRows.length > 0 || fullTx?.nft_transfers?.length > 0 || fullTx?.defi_events?.length > 0;
    const showTransfersTab = hasTransfers;
    useEffect(() => {
        setTransferDisplayMode('meaningful');
    }, [transaction?.id]);
    const hasEvmExecutions = (fullTx?.evm_executions?.length || 0) > 0;
    const hasScheduled = (fullTx?.scheduled_txs?.length || 0) > 0;
    const validTabs = ['transfers', 'script', 'events', 'evm', 'scheduled'];
    const defaultTab = hasTransfers ? 'transfers' : hasEvmExecutions ? 'evm' : (fullTx?.script ? 'script' : 'events');
    const [activeTab, setActiveTab] = useState(() =>
        urlTab && validTabs.includes(urlTab) ? urlTab : defaultTab
    );
    const [scriptFormatted, setScriptFormatted] = useState(false);
    const nowTick = useTimeTicker(20000);
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const syntaxTheme = isDark ? vscDarkPlus : oneLight;

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

    // Compute script hashes (script_hash from API, normalized_hash client-side)
    const [scriptHashes, setScriptHashes] = useState<{ raw: string; normalized: string }>({ raw: '', normalized: '' });
    useEffect(() => {
        const script = transaction?.script;
        const apiHash = transaction?.script_hash;
        if (!script) return;
        (async () => {
            const [rawHash, normHash] = await Promise.all([
                apiHash ? Promise.resolve(apiHash) : sha256Hex(script),
                normalizedScriptHash(script),
            ]);
            setScriptHashes({ raw: rawHash, normalized: normHash });
        })();
    }, [transaction?.script, transaction?.script_hash]);

    // Contract identifier metadata for enriching script args (logo, name, symbol)
    const [contractMeta, setContractMeta] = useState<Map<string, { name: string; symbol: string; logo: string }>>(new Map());
    useEffect(() => {
        if (!transaction?.arguments) return;
        // Scan args for A.{16hex}.{Name} patterns
        const CONTRACT_ID_RE = /A\.[a-f0-9]{16}\.\w+/g;
        const argStr = typeof transaction.arguments === 'string' ? transaction.arguments : JSON.stringify(transaction.arguments);
        const matches = argStr.match(CONTRACT_ID_RE);
        if (!matches || matches.length === 0) return;
        const unique = [...new Set(matches)] as string[];
        // Fetch FT token list to resolve metadata
        resolveApiBaseUrl().then(base =>
            fetch(`${base}/flow/v1/ft?limit=500`).then(r => r.ok ? r.json() : null).then(json => {
                const tokens: any[] = json?.data || [];
                const map = new Map<string, { name: string; symbol: string; logo: string }>();
                for (const id of unique) {
                    // id format: A.{addr}.{ContractName} — match against token's address+contract_name
                    const parts = id.split('.');
                    if (parts.length < 3) continue;
                    const addr = parts[1];
                    const contractName = parts.slice(2).join('.');
                    const token = tokens.find((t: any) =>
                        t.contract_name === contractName && t.address?.replace(/^0x/, '') === addr
                    );
                    if (token) {
                        map.set(id, { name: token.name || contractName, symbol: token.symbol || '', logo: token.logo || '' });
                    }
                }
                if (map.size > 0) setContractMeta(map);
            })
        ).catch(() => {});
    }, [transaction?.arguments]);

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
                    ? { ...detail, owner: detail.owner || owner }  // Already in cadence format
                    : {
                        tokenId: detail.tokenId || tokenId,
                        owner: owner || '',
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
                    owner: owner || '',
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
    const formatEventPayload = formatEventPayloadValue;

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

    // EVM transaction — render dedicated EVM detail page (after all hooks)
    if (isEVM && evmTransaction) {
        return <EVMTxDetail tx={evmTransaction} />;
    }

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
                        {/* Badges — show all tags from backend, deduplicated */}
                        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 flex-wrap">
                            {(() => {
                                const tagBadges = deriveAllActivityBadges(transaction);
                                return tagBadges.map((b, i) => (
                                    <span key={i} className={`text-xs uppercase tracking-[0.2em] border px-2 py-1 rounded-sm w-fit font-bold ${b.bgColor} ${b.color}`}>
                                        {b.label}
                                    </span>
                                ));
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
                                speed={25}
                                maxIterations={12}
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

                                    {/* Error Context: syntax-highlighted surrounding lines from the tx script */}
                                    {(() => {
                                        const errLine = parsed.scriptErrorLine;
                                        const scriptText = transaction.script;
                                        if (!errLine || !scriptText) {
                                            // Fall back to parsed snippet if no script
                                            if (!parsed.codeSnippet || parsed.codeSnippet.length === 0) return null;
                                            const maxLn = parsed.codeSnippet[parsed.codeSnippet.length - 1]?.lineNum || 0;
                                            const gw = String(maxLn).length * 8 + 16;
                                            return (
                                                <div className="bg-zinc-900 border border-zinc-700 rounded-sm overflow-hidden mb-4">
                                                    <div className="px-3 py-1.5 border-b border-zinc-700 flex items-center gap-2">
                                                        <Braces className="h-3 w-3 text-zinc-500" />
                                                        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Error Context</span>
                                                    </div>
                                                    <div className="font-mono text-[11px] leading-[1.7] overflow-x-auto">
                                                        {parsed.codeSnippet.map((line, i) => (
                                                            <div key={i} className={`flex ${line.isError ? 'bg-red-500/20 border-l-3 border-red-500' : ''}`}>
                                                                <span className={`select-none text-right pr-3 pl-2 flex-shrink-0 ${line.isError ? 'bg-red-500/30 text-red-400' : 'text-zinc-600'}`} style={{ minWidth: gw }}>{line.lineNum}</span>
                                                                <span className={`pl-3 ${line.isError ? 'text-red-200 font-bold' : 'text-zinc-300'}`}>{line.code}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        const allLines = scriptText.split('\n');
                                        const start = Math.max(0, errLine - 6);
                                        const end = Math.min(allLines.length, errLine + 5);
                                        const snippet = allLines.slice(start, end).join('\n');
                                        const startLine = start + 1;
                                        return (
                                            <div className="bg-zinc-900 border border-zinc-700 rounded-sm overflow-hidden mb-4">
                                                <div className="px-3 py-1.5 border-b border-zinc-700 flex items-center gap-2">
                                                    <Braces className="h-3 w-3 text-zinc-500" />
                                                    <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Error Context</span>
                                                    <span className="text-[10px] text-zinc-600 font-mono">Line {errLine}</span>
                                                </div>
                                                <SyntaxHighlighter
                                                    language="swift"
                                                    style={vscDarkPlus}
                                                    customStyle={{ margin: 0, padding: '0.75rem 0', fontSize: '11px', lineHeight: '1.7', background: 'transparent' }}
                                                    showLineNumbers={true}
                                                    startingLineNumber={startLine}
                                                    wrapLines={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#555', userSelect: 'none' }}
                                                    lineProps={(lineNumber: number) => {
                                                        if (lineNumber === errLine) {
                                                            return {
                                                                id: 'error-context-line',
                                                                style: { backgroundColor: 'rgba(239,68,68,0.2)', borderLeft: '3px solid #ef4444', display: 'block' },
                                                            };
                                                        }
                                                        return { style: { display: 'block' } };
                                                    }}
                                                >
                                                    {snippet}
                                                </SyntaxHighlighter>
                                                {parsed.summary && (
                                                    <ScriptErrorAnnotation
                                                        targetId="error-context-line"
                                                        message={parsed.summary}
                                                        line={errLine}
                                                        isDark={isDark}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {parsed.callStack.length > 0 && (
                                        <div className="mb-3">
                                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 font-bold block mb-1.5">Call Stack</span>
                                            <div className="space-y-0.5">
                                                {parsed.callStack.map((entry, i) => {
                                                    const isContract = entry.location.includes('.');
                                                    const fullText = `${entry.location}:${entry.line}:${entry.col}`;
                                                    if (isContract) {
                                                        // Link to contract detail page with line/col
                                                        const contractId = `A.${entry.location.replace(/\./g, '.')}`;
                                                        return (
                                                            <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono">
                                                                <span className="text-zinc-400 dark:text-zinc-600">→</span>
                                                                <Link
                                                                    to={`/contracts/${contractId}` as any}
                                                                    search={{ line: entry.line, col: entry.col } as any}
                                                                    className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                                                                >
                                                                    {fullText}
                                                                </Link>
                                                            </div>
                                                        );
                                                    }
                                                    // Transaction script reference — scroll to script tab
                                                    return (
                                                        <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono">
                                                            <span className="text-zinc-400 dark:text-zinc-600">→</span>
                                                            <button
                                                                onClick={() => {
                                                                    switchTab('script');
                                                                    setTimeout(() => {
                                                                        const el = document.querySelector(`[data-error-line="${entry.line}"]`);
                                                                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                    }, 100);
                                                                }}
                                                                className="text-nothing-green-dark dark:text-nothing-green hover:underline text-left"
                                                            >
                                                                {fullText} <span className="text-zinc-500 text-[9px]">(this script)</span>
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Raw error: show expanded when no context/callstack, collapsed otherwise */}
                                    {(!parsed.codeSnippet && parsed.callStack.length === 0 && !parsed.scriptErrorLine) ? (
                                        <div>
                                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 font-bold block mb-1.5">Raw Error</span>
                                            <p className="text-red-600/70 dark:text-red-300/50 text-[10px] font-mono break-all leading-relaxed max-h-48 overflow-y-auto">
                                                {errMsg}
                                            </p>
                                        </div>
                                    ) : (
                                        <details className="group">
                                            <summary className="text-[10px] uppercase tracking-widest text-zinc-400 cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                                                Raw Error
                                            </summary>
                                            <p className="text-red-600/70 dark:text-red-300/50 text-[10px] font-mono break-all leading-relaxed mt-2 max-h-48 overflow-y-auto">
                                                {errMsg}
                                            </p>
                                        </details>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Transaction Summary Card */}
                <TransactionSummaryCard transaction={fullTx} assetView={assetView} addressBook={addressBook} formatAddress={formatAddress} onNftClick={handleNftClick} isAdmin={isAdmin} isRefreshing={!detailFlowReady} />

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
                        {hasEvmExecutions && (
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
                        {hasScheduled && (
                            <button
                                onClick={() => switchTab('scheduled')}
                                className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'scheduled'
                                    ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Clock className={`h-4 w-4 ${activeTab === 'scheduled' ? 'text-amber-500' : ''}`} />
                                    Scheduled
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

                                {visibleTransferRows.length > 0 && (
                                    <div>
                                        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                                            <div className="min-w-0">
                                                <h3 className="text-xs text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                                    <Coins className="h-4 w-4" /> Token Transfers ({visibleTransferRows.length})
                                                </h3>
                                                {!detailFlowReady && (
                                                    <div className="mt-2 max-w-sm">
                                                        <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-white/5 overflow-hidden">
                                                            <div className="h-full w-1/3 bg-gradient-to-r from-nothing-green-dark via-nothing-green to-sky-400 animate-[pulse_1.2s_ease-in-out_infinite]" />
                                                        </div>
                                                        <p className="mt-1 text-[10px] text-zinc-500 uppercase tracking-widest">Refreshing Detailed Transfer Decode</p>
                                                    </div>
                                                )}
                                                {showTransferNoiseToggle && (
                                                    <p className="mt-1 text-[10px] text-zinc-500">
                                                        {transferDisplayMode === 'meaningful'
                                                            ? `Showing merged asset flow. Hidden ${assetView.rawTransferListRows.length - assetView.transferListRows.length} noisy legs such as duplicate mint/burn bookkeeping and small operational transfers.`
                                                            : 'Showing every event-decoded FT row, including duplicate bridge legs, mint/burn bookkeeping, and fee-like operational transfers.'}
                                                    </p>
                                                )}
                                            </div>
                                            {showTransferNoiseToggle && (
                                                <div className="inline-flex items-center rounded-sm border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/5 p-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => setTransferDisplayMode('meaningful')}
                                                        className={`relative px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors rounded-sm z-10 ${transferDisplayMode === 'meaningful'
                                                            ? 'text-white dark:text-zinc-900'
                                                            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                                                            }`}
                                                    >
                                                        {transferDisplayMode === 'meaningful' && (
                                                            <motion.div
                                                                layoutId="tx-transfer-mode-toggle"
                                                                className="absolute inset-0 rounded-sm bg-zinc-900 dark:bg-white -z-10 shadow-md"
                                                                transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                                                            />
                                                        )}
                                                        Meaningful {assetView.transferListRows.length}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setTransferDisplayMode('all')}
                                                        className={`relative px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors rounded-sm z-10 ${transferDisplayMode === 'all'
                                                            ? 'text-white dark:text-zinc-900'
                                                            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                                                            }`}
                                                    >
                                                        {transferDisplayMode === 'all' && (
                                                            <motion.div
                                                                layoutId="tx-transfer-mode-toggle"
                                                                className="absolute inset-0 rounded-sm bg-zinc-900 dark:bg-white -z-10 shadow-md"
                                                                transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                                                            />
                                                        )}
                                                        All Decoded {assetView.rawTransferListRows.length}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                            <div
                                                className="hidden lg:grid items-center gap-x-4 px-4 py-2.5 bg-zinc-100/80 dark:bg-white/[0.03] border-b border-zinc-200 dark:border-white/5 text-[10px] uppercase tracking-[0.2em] text-zinc-500"
                                                style={{ gridTemplateColumns: transferTableColumns }}
                                            >
                                                <span>Asset</span>
                                                <span className="text-right">From</span>
                                                <span />
                                                <span>To</span>
                                                <span className="text-right">Context</span>
                                            </div>
                                            <div className="divide-y divide-zinc-100 dark:divide-white/5">
                                                {visibleTransferRows.map((row, idx) => (
                                                    <div
                                                        key={`${row.layer}-${row.eventIndex || 'agg'}-${row.from}-${row.to}-${row.symbol}-${idx}`}
                                                        className="px-4 py-3 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-black/50 transition-colors"
                                                    >
                                                        <div
                                                            className="hidden lg:grid items-center gap-x-4"
                                                            style={{ gridTemplateColumns: transferTableColumns }}
                                                        >
                                                            <div className="min-w-0 flex items-center gap-3">
                                                                {row.logo ? (
                                                                    <img src={row.logo} alt="" className="w-8 h-8 rounded-full border border-zinc-200 dark:border-white/10 flex-shrink-0" />
                                                                ) : (
                                                                    <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                                                        <Coins className="w-4 h-4 text-emerald-500" />
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className="text-sm font-mono font-medium text-zinc-900 dark:text-white">
                                                                            {row.amount != null ? Number(row.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                                                        </span>
                                                                        <span className="text-[10px] text-zinc-500 font-medium uppercase">{row.symbol}</span>
                                                                        {row.usdValue > 0 && <UsdValue value={row.usdValue} className="text-[10px]" />}
                                                                    </div>
                                                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                                        {row.transferType === 'mint' && (
                                                                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Mint</span>
                                                                        )}
                                                                        {row.transferType === 'burn' && (
                                                                            <span className="text-[9px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Burn</span>
                                                                        )}
                                                                        {row.transferType === 'stake' && (
                                                                            <span className="text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Stake</span>
                                                                        )}
                                                                        {row.transferType === 'unstake' && (
                                                                            <span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Unstake</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="min-w-0 overflow-hidden flex justify-end">
                                                                {row.from ? (
                                                                    <TxResolvedAddress address={row.from} book={addressBook} prefixLen={6} suffixLen={4} reserveLabelSpace size={16} align="right" className="w-full" />
                                                                ) : row.transferType === 'mint' ? (
                                                                    <span className="text-zinc-400 dark:text-zinc-600 italic text-sm">Mint</span>
                                                                ) : (
                                                                    <span />
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-center text-zinc-300 dark:text-zinc-600">
                                                                <ArrowRight className="w-4 h-4" />
                                                            </div>
                                                            <div className="min-w-0 overflow-hidden flex">
                                                                {row.to ? (
                                                                    <TxResolvedAddress address={row.to} book={addressBook} prefixLen={6} suffixLen={4} reserveLabelSpace size={16} className="w-full" />
                                                                ) : row.transferType === 'burn' ? (
                                                                    <span className="text-zinc-400 dark:text-zinc-600 italic text-sm">Burn</span>
                                                                ) : row.transferType === 'stake' ? (
                                                                    <span className="text-blue-400 dark:text-blue-500 italic text-sm">Stake</span>
                                                                ) : (
                                                                    <span />
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-end">
                                                                {renderTransferRowBadge(row)}
                                                            </div>
                                                        </div>

                                                        <div className="lg:hidden space-y-3">
                                                            <div>
                                                                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">Asset</div>
                                                                <div className="min-w-0 flex items-center gap-3">
                                                                    {row.logo ? (
                                                                        <img src={row.logo} alt="" className="w-8 h-8 rounded-full border border-zinc-200 dark:border-white/10 flex-shrink-0" />
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                                                            <Coins className="w-4 h-4 text-emerald-500" />
                                                                        </div>
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <span className="text-sm font-mono font-medium text-zinc-900 dark:text-white">
                                                                                {row.amount != null ? Number(row.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                                                            </span>
                                                                            <span className="text-[10px] text-zinc-500 font-medium uppercase">{row.symbol}</span>
                                                                            {row.usdValue > 0 && <UsdValue value={row.usdValue} className="text-[10px]" />}
                                                                        </div>
                                                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                                            {row.transferType === 'mint' && (
                                                                                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Mint</span>
                                                                            )}
                                                                            {row.transferType === 'burn' && (
                                                                                <span className="text-[9px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Burn</span>
                                                                            )}
                                                                            {row.transferType === 'stake' && (
                                                                                <span className="text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Stake</span>
                                                                            )}
                                                                            {row.transferType === 'unstake' && (
                                                                                <span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">Unstake</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] sm:items-center">
                                                                <div>
                                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">From</div>
                                                                    {row.from ? (
                                                                        <TxResolvedAddress address={row.from} book={addressBook} prefixLen={6} suffixLen={4} reserveLabelSpace size={16} />
                                                                    ) : row.transferType === 'mint' ? (
                                                                        <span className="text-zinc-400 dark:text-zinc-600 italic text-sm">Mint</span>
                                                                    ) : (
                                                                        <span />
                                                                    )}
                                                                </div>
                                                                <div className="hidden sm:flex items-center justify-center text-zinc-300 dark:text-zinc-600 pt-5">
                                                                    <ArrowRight className="w-4 h-4" />
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">To</div>
                                                                    {row.to ? (
                                                                        <TxResolvedAddress address={row.to} book={addressBook} prefixLen={6} suffixLen={4} reserveLabelSpace size={16} />
                                                                    ) : row.transferType === 'burn' ? (
                                                                        <span className="text-zinc-400 dark:text-zinc-600 italic text-sm">Burn</span>
                                                                    ) : row.transferType === 'stake' ? (
                                                                        <span className="text-blue-400 dark:text-blue-500 italic text-sm">Stake</span>
                                                                    ) : (
                                                                        <span />
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">Context</div>
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    {renderTransferRowBadge(row)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

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
                                    <div className="flex items-center gap-2 mb-2">
                                        <h3 className="text-xs text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                            <FileText className="h-4 w-4" /> Script Arguments
                                        </h3>
                                        {transaction.arguments && (() => {
                                            try {
                                                const raw = typeof transaction.arguments === 'string' ? JSON.parse(transaction.arguments) : transaction.arguments;
                                                if (!Array.isArray(raw)) return null;
                                                const decoded = raw.map((a: any) => {
                                                    const dec = (v: any): any => {
                                                        if (!v || typeof v !== 'object') return v;
                                                        if (v.value !== undefined) {
                                                            if (v.type === 'Optional') return v.value ? dec(v.value) : null;
                                                            if (v.type === 'Array') return v.value.map(dec);
                                                            if (v.type === 'Dictionary') { const d: Record<string, any> = {}; v.value.forEach((i: any) => { d[String(dec(i.key))] = dec(i.value); }); return d; }
                                                            if (v.type === 'Struct' || v.type === 'Resource' || v.type === 'Event') { const o: Record<string, any> = {}; v.value?.fields?.forEach((f: any) => { o[f.name] = dec(f.value); }); return o; }
                                                            if (v.type === 'Path') return `${v.value.domain}/${v.value.identifier}`;
                                                            if (v.type === 'Type') return v.value.staticType;
                                                            return v.value;
                                                        }
                                                        return v;
                                                    };
                                                    return dec(a);
                                                });
                                                const CopyLabel = ({ label, content }: { label: string; content: string }) => {
                                                    const [copied, setCopied] = useState(false);
                                                    return (
                                                        <button
                                                            type="button"
                                                            title={`Copy as ${label}`}
                                                            onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                                                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${copied ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 border-zinc-200 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-white/5'}`}
                                                        >{copied ? 'Copied!' : label}</button>
                                                    );
                                                };
                                                return (
                                                    <div className="flex items-center gap-1 ml-auto">
                                                        <span className="text-[10px] text-zinc-400 mr-0.5">Copy:</span>
                                                        <CopyLabel label="JSON" content={JSON.stringify(decoded, null, 2)} />
                                                        <CopyLabel label="Cadence" content={JSON.stringify(raw, null, 2)} />
                                                    </div>
                                                );
                                            } catch { return null; }
                                        })()}
                                    </div>
                                    {transaction.arguments ? (
                                        <div className="bg-zinc-50 dark:bg-black/50 border border-zinc-200 dark:border-white/5 p-4 rounded-sm">
                                            {(() => {
                                                // Detect Flow (0x + 16 hex) or EVM (0x + 40 hex) addresses in values
                                                const ADDRESS_RE = /^0x[a-fA-F0-9]{16}$|^0x[a-fA-F0-9]{40}$/;
                                                // Matches A.{16hex}.{ContractName} optionally followed by .Vault, .Collection, etc.
                                                const CONTRACT_ID_RE = /^A\.[a-f0-9]{16}\.\w+(\.\w+)?$/;

                                                const renderArgValue = (decoded: any): React.ReactNode => {
                                                    if (typeof decoded === 'string' && ADDRESS_RE.test(decoded)) {
                                                        return <AddressLink address={decoded.replace(/^0x/, '')} prefixLen={10} suffixLen={6} className="text-xs" />;
                                                    }
                                                    if (typeof decoded === 'string' && CONTRACT_ID_RE.test(decoded)) {
                                                        const parts = decoded.split('.');
                                                        // Extract base contract ID (A.{addr}.{ContractName}) for metadata lookup
                                                        const addr = parts[1];
                                                        const contractName = parts.slice(2, parts.length > 3 ? -1 : undefined).join('.');
                                                        const suffix = parts.length > 3 ? `.${parts[parts.length - 1]}` : '';
                                                        const contractId = `A.${addr}.${contractName}`;
                                                        const meta = contractMeta.get(contractId) || contractMeta.get(decoded);
                                                        return (
                                                            <Link to={`/contract/${contractId}` as any} className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline" title={meta ? `${meta.name}${meta.symbol ? ` (${meta.symbol})` : ''}` : contractName}>
                                                                {meta?.logo ? (
                                                                    <img src={meta.logo} alt="" className="w-4 h-4 rounded-full" />
                                                                ) : (
                                                                    <FileText className="w-3.5 h-3.5 text-zinc-400" />
                                                                )}
                                                                <span>{meta ? `${contractName}${meta.symbol ? ` (${meta.symbol})` : ''}${suffix}` : decoded}</span>
                                                            </Link>
                                                        );
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
                                                    // Prefer transaction(...) for user-facing args; fall back to fun main(...) for scripts
                                                    const match =
                                                        script.match(/^\s*transaction\s*\(([^)]*)\)/m) ||
                                                        script.match(/fun\s+main\s*\(([^)]*)\)/);
                                                    if (!match) return [];
                                                    const paramsStr = match[1].trim();
                                                    if (!paramsStr) return [];
                                                    return paramsStr.split(',').map(p => {
                                                        const trimmed = p.trim();
                                                        const colonIdx = trimmed.indexOf(':');
                                                        if (colonIdx === -1) return { name: trimmed, type: '' };
                                                        return { name: trimmed.slice(0, colonIdx).trim(), type: trimmed.slice(colonIdx + 1).trim() };
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

                                                                const decodedStr = typeof decoded === 'object' && decoded !== null
                                                                    ? JSON.stringify(decoded, null, 2)
                                                                    : String(decoded);

                                                                return (
                                                                    <div key={idx} className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden">
                                                                        {/* Header: name + type + copy */}
                                                                        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-white/5 border-b border-zinc-200 dark:border-white/5">
                                                                            <span className="text-[10px] text-zinc-400 font-mono tabular-nums">{idx}</span>
                                                                            <span className="text-[11px] text-zinc-800 dark:text-zinc-200 font-medium font-mono">{paramName}</span>
                                                                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded">{paramType}</span>
                                                                            <CopyButton content={decodedStr} className="ml-auto" />
                                                                        </div>
                                                                        {/* Value — scrollable if tall */}
                                                                        <div className="px-3 py-2.5 text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all leading-relaxed max-h-48 overflow-y-auto">
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
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-xs text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                            <Braces className="h-4 w-4" /> Cadence Script
                                        </h3>
                                        <div className="flex items-center gap-2">
                                        {transaction.script && (
                                            <CopyButton
                                                content={scriptFormatted ? formatCadenceScript(transaction.script) : transaction.script}
                                                variant="ghost"
                                                size="xs"
                                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold border border-zinc-300 dark:border-white/10 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                            />
                                        )}
                                        {transaction.script && (
                                            <button
                                                onClick={() => setScriptFormatted(prev => !prev)}
                                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                                                    scriptFormatted
                                                        ? 'border-blue-500/30 text-blue-500 bg-blue-500/10'
                                                        : 'border-zinc-300 dark:border-white/10 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5'
                                                }`}
                                            >
                                                <WrapText size={10} />
                                                {scriptFormatted ? 'Original' : 'Format'}
                                            </button>
                                        )}
                                        {transaction.script && (
                                            <Link
                                                to="/playground"
                                                search={{ tx: transaction.id } as any}
                                                target="_blank"
                                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                                            >
                                                <Play size={10} />
                                                Open in Playground
                                            </Link>
                                        )}
                                        {parsedError?.scriptErrorLine && transaction.script && (
                                            <button
                                                onClick={() => {
                                                    const el = document.getElementById('script-error-line');
                                                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                }}
                                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
                                            >
                                                <AlertCircle size={10} />
                                                Jump to Error (Line {parsedError.scriptErrorLine})
                                            </button>
                                        )}
                                        </div>
                                    </div>
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
                                                            id: 'script-error-line',
                                                            'data-error-line': String(lineNumber),
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
                                                {scriptFormatted ? formatCadenceScript(transaction.script) : transaction.script}
                                            </SyntaxHighlighter>
                                            {/* Inject error annotation below the error line via DOM effect */}
                                            {parsedError?.scriptErrorLine && parsedError?.summary && (
                                                <ScriptErrorAnnotation
                                                    targetId="script-error-line"
                                                    message={parsedError.summary}
                                                    line={parsedError.scriptErrorLine}
                                                    isDark={isDark}
                                                />
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-24 text-zinc-600 border border-zinc-200 dark:border-white/5 border-dashed rounded-sm">
                                            <p className="text-xs uppercase tracking-widest">No Script Content Available</p>
                                        </div>
                                    )}

                                    {/* Script Hashes */}
                                    {transaction.script && (scriptHashes.raw || scriptHashes.normalized) && (
                                        <div className="mt-3 border border-zinc-200 dark:border-white/5 rounded-sm divide-y divide-zinc-200 dark:divide-white/5">
                                            {scriptHashes.raw && (
                                                <div className="flex items-center gap-3 px-3 py-2">
                                                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold w-28 flex-shrink-0">Script Hash</span>
                                                    <code className="text-[10px] text-zinc-600 dark:text-zinc-400 font-mono truncate flex-1">{scriptHashes.raw}</code>
                                                    <CopyButton content={scriptHashes.raw} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 flex-shrink-0" />
                                                </div>
                                            )}
                                            {scriptHashes.normalized && (
                                                <div className="flex items-center gap-3 px-3 py-2">
                                                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold w-28 flex-shrink-0">Normalized</span>
                                                    <code className="text-[10px] text-zinc-600 dark:text-zinc-400 font-mono truncate flex-1">{scriptHashes.normalized}</code>
                                                    <CopyButton content={scriptHashes.normalized} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 flex-shrink-0" />
                                                </div>
                                            )}
                                            {scriptHashes.raw && scriptHashes.normalized && scriptHashes.raw !== scriptHashes.normalized && (
                                                <div className="px-3 py-1.5">
                                                    <span className="text-[9px] text-zinc-400 italic">Normalized hash groups scripts that differ only in comments/whitespace</span>
                                                </div>
                                            )}
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

                        {activeTab === 'scheduled' && hasScheduled && (
                            <div className="space-y-4">
                                {fullTx.scheduled_txs.map((st: any) => (
                                    <div key={st.scheduled_id} className="border border-zinc-200 dark:border-white/10 rounded-lg p-4 space-y-3">
                                        {/* Header: ID + status + priority + link */}
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Link to="/scheduled/$id" params={{ id: String(st.scheduled_id) }} className="text-nothing-green-dark dark:text-nothing-green hover:underline text-sm font-bold">
                                                Scheduled #{st.scheduled_id}
                                            </Link>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider ${
                                                st.status === 'EXECUTED' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                                                    : st.status === 'CANCELED' ? 'text-red-500 bg-red-500/10 border-red-500/20'
                                                    : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                                            }`}>{st.status}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                                st.priority === 0 ? 'text-red-500 bg-red-500/10 border-red-500/20'
                                                    : st.priority === 1 ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
                                                    : 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                                            }`}>{st.priority_label}</span>
                                            <span className="text-[10px] text-zinc-500 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-white/10">
                                                {st.matched_by === 'executed_tx' ? 'Executed by this tx' : 'Scheduled by this tx'}
                                            </span>
                                        </div>
                                        {/* Detail grid */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                            <div>
                                                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Handler</span>
                                                <p className="text-zinc-800 dark:text-zinc-200 font-medium mt-0.5">{st.handler_contract}</p>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Effort</span>
                                                <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{st.execution_effort}</p>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Fees</span>
                                                <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{parseFloat(st.fees).toFixed(4)} FLOW</p>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Expected At</span>
                                                <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{new Date(st.expected_at).toLocaleString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === 'evm' && hasEvmExecutions && (
                            <div className="space-y-6">
                                {fullTx.evm_executions && fullTx.evm_executions.length > 0 ? (
                                    fullTx.evm_executions.map((exec: any, idx: number) => (
                                        <div key={idx} className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                                            {(() => {
                                                const headerLink = getEVMExecutionHeaderLink(exec, transaction.events);
                                                return (
                                            <div className="bg-zinc-50 dark:bg-black/40 px-4 py-3 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between">
                                                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                                                    EVM Execution {fullTx.evm_executions.length > 1 ? `#${idx + 1}` : ''}
                                                </span>
                                                {headerLink && (
                                                    <a
                                                        href={headerLink.href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 min-w-0 text-right"
                                                    >
                                                        <span className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-mono truncate">
                                                            {headerLink.label}
                                                        </span>
                                                        {headerLink.verified && <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />}
                                                    </a>
                                                )}
                                            </div>
                                                );
                                            })()}
                                            <div className="p-4 space-y-4">
                                                {/* EVM Hash */}
                                                <div>
                                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">EVM Hash</p>
                                                    <div className="flex items-center gap-2">
                                                        <Link
                                                            to={`/txs/evm/$txId` as any}
                                                            params={{ txId: `0x${exec.hash?.replace(/^0x/i, '')}` }}
                                                            className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all hover:underline"
                                                        >
                                                            0x{exec.hash?.replace(/^0x/i, '')}
                                                        </Link>
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
                                                        <EVMEntityLink address={exec.from} meta={exec.from_meta} fallbackLabel="N/A" />
                                                        <EVMMetaBadges meta={exec.from_meta} />
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">To</p>
                                                        <EVMEntityLink address={exec.to} meta={exec.to_meta} fallbackLabel="Contract Creation" />
                                                        {exec.to_meta?.implementation_address && (
                                                            <div className="mt-1 text-[10px] text-zinc-500 flex items-center gap-1.5">
                                                                <span>Implementation</span>
                                                                <AddressLink address={exec.to_meta.implementation_address} prefixLen={8} suffixLen={4} size={12} className="text-[10px]" />
                                                            </div>
                                                        )}
                                                        <EVMMetaBadges meta={exec.to_meta} />
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

                                                {/* Decoded ERC call data */}
                                                {(() => {
                                                    const abiDecoded = exec.decoded_call;
                                                    if (abiDecoded?.method) {
                                                        const args: any[] = Array.isArray(abiDecoded.args) ? abiDecoded.args : [];
                                                        return (
                                                            <div className="border border-zinc-200 dark:border-white/5 rounded-sm p-4 space-y-3">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
                                                                        ABI
                                                                    </span>
                                                                    <span className="text-xs text-zinc-700 dark:text-zinc-300 font-mono">
                                                                        {abiDecoded.method}
                                                                    </span>
                                                                    {abiDecoded.via_proxy && (
                                                                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30">
                                                                            Proxy
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                    {abiDecoded.signature && (
                                                                        <div>
                                                                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Signature</p>
                                                                            <code className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">{abiDecoded.signature}</code>
                                                                        </div>
                                                                    )}
                                                                    {abiDecoded.contract_name && (
                                                                        <div>
                                                                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Decoded Against</p>
                                                                            <div className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">{abiDecoded.contract_name}</div>
                                                                            {abiDecoded.implementation_name && (
                                                                                <div className="text-[10px] text-zinc-500 mt-1">
                                                                                    Impl: {abiDecoded.implementation_name}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {args.length > 0 && (
                                                                    <div className="space-y-2">
                                                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Arguments</p>
                                                                        <div className="space-y-2">
                                                                            {args.map((arg: any, argIdx: number) => (
                                                                                <div key={argIdx} className="p-2.5 rounded-sm border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/20">
                                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                                        <span className="text-[10px] font-mono text-zinc-900 dark:text-white">
                                                                                            {arg.name || `arg${argIdx}`}
                                                                                        </span>
                                                                                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-zinc-200 dark:border-white/10 text-zinc-500">
                                                                                            {arg.type || 'unknown'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="mt-1.5 text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">
                                                                                        {isEvmAddressLike(arg.value) ? (
                                                                                            <AddressLink address={arg.value} prefixLen={8} suffixLen={4} size={12} className="text-xs" />
                                                                                        ) : (
                                                                                            <code>{stringifyDecodedValue(arg.value)}</code>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    // Try exec.data first, then extract from raw event payload
                                                    let callData = exec.data;
                                                    if (!callData) {
                                                        const matchedEvt = transaction.events?.find((e: any) => e.event_index === exec.event_index);
                                                        const evtPayload = matchedEvt?.values || matchedEvt?.payload || matchedEvt?.data;
                                                        if (evtPayload) {
                                                            const fmt = formatEventPayload(evtPayload);
                                                            if (fmt.payload) {
                                                                const decoded = decodeFlowDirectCallPayload(fmt.payload);
                                                                if (decoded?.data) callData = decoded.data;
                                                            }
                                                        }
                                                    }
                                                    if (!callData) return null;
                                                    const decoded = decodeEVMCallData(callData);
                                                    if (decoded.callType === 'unknown') return null;
                                                    const CALL_LABELS: Record<string, { label: string; tag: string; color: string }> = {
                                                        erc20_transfer: { label: 'ERC-20 Transfer', tag: 'ERC-20', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' },
                                                        erc20_transferFrom: { label: 'ERC-20 TransferFrom', tag: 'ERC-20', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' },
                                                        erc721_safeTransferFrom: { label: 'ERC-721 SafeTransferFrom', tag: 'ERC-721', color: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30' },
                                                        erc1155_safeTransferFrom: { label: 'ERC-1155 SafeTransferFrom', tag: 'ERC-1155', color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30' },
                                                        erc1155_safeBatchTransferFrom: { label: 'ERC-1155 BatchTransfer', tag: 'ERC-1155', color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30' },
                                                    };
                                                    const info = CALL_LABELS[decoded.callType] || { label: decoded.callType, tag: 'EVM', color: 'text-zinc-500 bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/10' };
                                                    return (
                                                        <div className="border border-zinc-200 dark:border-white/5 rounded-sm p-4 space-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${info.color}`}>
                                                                    {info.tag}
                                                                </span>
                                                                <span className="text-xs text-zinc-700 dark:text-zinc-300 font-mono">{info.label}</span>
                                                            </div>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                {decoded.recipient && (
                                                                    <div>
                                                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Recipient</p>
                                                                        <div className="flex items-center gap-2">
                                                                            <code className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">0x{decoded.recipient}</code>
                                                                            <a href={`https://evm.flowindex.io/address/0x${decoded.recipient}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-blue-500 transition-colors flex-shrink-0">
                                                                                <ExternalLink className="h-3 w-3" />
                                                                            </a>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {decoded.tokenID && (
                                                                    <div>
                                                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                                                                            {decoded.callType.startsWith('erc20') ? 'Amount (raw)' : 'Token ID'}
                                                                        </p>
                                                                        <code className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all">{decoded.tokenID}</code>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

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
                                                    if (exec.from_meta) decodedPayload.from_meta = exec.from_meta;
                                                    if (exec.to_meta) decodedPayload.to_meta = exec.to_meta;
                                                    if (exec.decoded_call) decodedPayload.decoded_call = exec.decoded_call;
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
                                                    const rawTxPayloadView = decodedRawTx ? {
                                                        type: 'Flow Direct Call (0xff)',
                                                        nonce: decodedRawTx.nonce,
                                                        sub_type: decodedRawTx.subType,
                                                        from: decodedRawTx.from || null,
                                                        to: decodedRawTx.to || 'Contract Creation',
                                                        data: decodedRawTx.data || null,
                                                        value: `${decodedRawTx.value} FLOW`,
                                                        gas_limit: decodedRawTx.gasLimit,
                                                        raw: rawTxPayloadHex,
                                                    } : null;
                                                    const abiPayload = exec.decoded_call ? {
                                                        method: exec.decoded_call.method || null,
                                                        signature: exec.decoded_call.signature || null,
                                                        contract_name: exec.decoded_call.contract_name || exec.to_meta?.label || exec.to_meta?.contract_name || null,
                                                        implementation_name: exec.decoded_call.implementation_name || null,
                                                        implementation_address: exec.to_meta?.implementation_address || null,
                                                        via_proxy: Boolean(exec.decoded_call.via_proxy),
                                                        args: Array.isArray(exec.decoded_call.args) ? exec.decoded_call.args : [],
                                                    } : null;

                                                    const isExpanded = expandedPayloads[idx] ?? false;
                                                    const payloadTabKey = `evm_payload_tab_${idx}`;
                                                    const activePayloadTab = (expandedPayloads as any)[payloadTabKey] || (abiPayload ? 'abi' : decodedRawTx ? 'raw' : 'evm');
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
                                                                    {/* Sub-tabs: ABI Payload | Raw TX Payload | EVM Payload */}
                                                                    {(decodedRawTx || abiPayload) && (
                                                                        <div className="flex border-b border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-black/30">
                                                                            {decodedRawTx && (
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); setExpandedPayloads(prev => ({ ...prev, [payloadTabKey]: 'raw' })); }}
                                                                                    className={`px-4 py-2 text-[10px] uppercase tracking-widest transition-colors ${activePayloadTab === 'raw' ? 'text-zinc-900 dark:text-white border-b-2 border-zinc-900 dark:border-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                                                                >
                                                                                    Raw TX Payload
                                                                                </button>
                                                                            )}
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setExpandedPayloads(prev => ({ ...prev, [payloadTabKey]: 'evm' })); }}
                                                                                className={`px-4 py-2 text-[10px] uppercase tracking-widest transition-colors ${activePayloadTab === 'evm' ? 'text-zinc-900 dark:text-white border-b-2 border-zinc-900 dark:border-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                                                            >
                                                                                EVM Payload
                                                                            </button>
                                                                            {abiPayload && (
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); setExpandedPayloads(prev => ({ ...prev, [payloadTabKey]: 'abi' })); }}
                                                                                    className={`px-4 py-2 text-[10px] uppercase tracking-widest transition-colors ${activePayloadTab === 'abi' ? 'text-zinc-900 dark:text-white border-b-2 border-zinc-900 dark:border-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                                                                >
                                                                                    ABI Payload
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div className="p-4 bg-zinc-50 dark:bg-black/40 border-t border-zinc-200 dark:border-white/5 max-h-[400px] overflow-y-auto">
                                                                        {activePayloadTab === 'raw' && rawTxPayloadView ? (
                                                                            <JsonPayloadBlock value={rawTxPayloadView} isDark={isDark} />
                                                                        ) : activePayloadTab === 'abi' && abiPayload ? (
                                                                            <JsonPayloadBlock value={abiPayload} isDark={isDark} />
                                                                        ) : (
                                                                            <JsonPayloadBlock value={decodedPayload} isDark={isDark} />
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
                                                <Link to={`/txs/evm/$txId` as any} params={{ txId: fullTx.evm_hash }} className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all hover:underline">{fullTx.evm_hash}</Link>
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
                    nftType={selectedNftCollection.id}
                    nftId={selectedNft?.tokenId}
                    collectionId={selectedNftCollection.id}
                    collectionName={selectedNftCollection.name}
                    onClose={() => setSelectedNft(null)}
                />
            )}
        </div>
    );
}
