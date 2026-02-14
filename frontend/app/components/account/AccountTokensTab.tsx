import { useState, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Coins, ExternalLink } from 'lucide-react';
import type { FTVaultInfo } from '../../../cadence/cadence.gen';
import { normalizeAddress, formatShort, getTokenLogoURL } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { EVMBridgeBadge } from '../ui/EVMBridgeBadge';
import { motion, AnimatePresence } from 'framer-motion';
import { getFlowV1Ft } from '../../api/gen/find';

interface Props {
    address: string;
}

export function AccountTokensTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [tokens, setTokens] = useState<FTVaultInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [backendFTs, setBackendFTs] = useState<any[]>([]);

    const loadTokens = async () => {
        setLoading(true);
        setError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const res = await cadenceService.getToken(normalizedAddress);
            setTokens(res?.tokens || []);
        } catch (err) {
            console.error('Failed to load token data', err);
            setError('Failed to load token data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (tokens.length === 0 && !loading) loadTokens();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    // Fetch backend FT metadata once
    useEffect(() => {
        getFlowV1Ft({ query: { limit: 100, offset: 0 } }).then((res) => {
            const items = (res.data as any)?.data || [];
            setBackendFTs(items);
            // Fetch more if there are exactly 100 (paginate)
            if (items.length >= 100) {
                getFlowV1Ft({ query: { limit: 100, offset: 100 } }).then((res2) => {
                    const more = (res2.data as any)?.data || [];
                    setBackendFTs((prev: any[]) => [...prev, ...more]);
                }).catch(() => {});
            }
        }).catch(() => {});
    }, []);

    // Build lookup map: "A.{hex}.{ContractName}" → backend metadata
    const metaMap = useMemo(() => {
        const map: Record<string, { name?: string; symbol?: string; logo?: string; evm_address?: string }> = {};
        for (const ft of backendFTs) {
            const id = ft.id || '';
            if (id) map[id] = { name: ft.name, symbol: ft.symbol, logo: ft.logo, evm_address: ft.evm_address };
        }
        return map;
    }, [backendFTs]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                    <Coins className="w-4 h-4" />
                    Fungible Tokens ({tokens.length})
                </h3>
            </div>

            {error && (
                <GlassCard className="border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
                    <div className="text-xs text-red-500 dark:text-red-400">{error}</div>
                </GlassCard>
            )}

            <div className="flex flex-col gap-3">
                {loading ? (
                    <div className="flex flex-col gap-3">
                        {[1, 2, 3].map((i) => (
                            <GlassCard key={i} className="p-4 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4 w-full">
                                    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-white/5 animate-pulse flex-shrink-0" />
                                    <div className="space-y-2 flex-1">
                                        <div className="h-4 w-32 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
                                        <div className="h-3 w-24 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
                                    </div>
                                </div>
                                <div className="h-6 w-24 bg-zinc-200 dark:bg-white/5 animate-pulse rounded flex-shrink-0" />
                            </GlassCard>
                        ))}
                    </div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        {tokens.map((t: FTVaultInfo, i: number) => {
                            const identifier = `A.${normalizeAddress(t.contractAddress).replace(/^0x/, '')}.${t.contractName}`;
                            const meta = metaMap[identifier];
                            const logoUrl = meta?.logo || getTokenLogoURL(t);
                            const displayName = meta?.name || t.name || t.contractName;
                            const displaySymbol = meta?.symbol || t.symbol;
                            const evmAddr = meta?.evm_address || (t as any).evmAddress || '';
                            return (
                                <motion.div
                                    key={`${t.contractAddress}-${t.contractName}`}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                >
                                    <GlassCard className="hover:bg-white/40 dark:hover:bg-white/10 transition-colors group relative overflow-hidden p-4 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="flex-shrink-0">
                                                {logoUrl ? (
                                                    <img
                                                        src={logoUrl}
                                                        alt={displayName}
                                                        className="w-10 h-10 object-cover bg-white dark:bg-white/10 shadow-sm rounded-full"
                                                        loading="lazy"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                                                    />
                                                ) : null}
                                                <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/10 dark:to-white/5 flex items-center justify-center shadow-inner ${logoUrl ? 'hidden' : ''}`}>
                                                    <Coins className="h-5 w-5 text-zinc-400" />
                                                </div>
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-bold text-zinc-900 dark:text-white leading-tight truncate">{displayName}</div>
                                                    <div className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full">{displaySymbol}</div>
                                                    {evmAddr && <EVMBridgeBadge evmAddress={evmAddr} />}
                                                </div>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <Link
                                                        to="/accounts/$address"
                                                        params={{ address: normalizeAddress(t.contractAddress) }}
                                                        className="text-[10px] font-mono text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green flex items-center gap-1 transition-colors"
                                                    >
                                                        {formatShort(t.contractAddress)}
                                                        <ExternalLink className="w-2.5 h-2.5" />
                                                    </Link>
                                                    <span className="text-[10px] text-zinc-300 dark:text-zinc-600">•</span>
                                                    <span className="text-[10px] text-zinc-400 font-mono truncate max-w-[100px]">{t.contractName}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right flex-shrink-0">
                                            <div className="text-lg font-mono font-bold text-zinc-900 dark:text-white">
                                                {t.balance != null ? Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                            </div>
                                        </div>
                                    </GlassCard>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                )}
            </div>

            {tokens.length === 0 && !loading && (
                <GlassCard className="text-center py-12">
                    <Coins className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
                    <div className="text-zinc-500 italic">No fungible tokens found</div>
                </GlassCard>
            )}
        </div>
    );
}
