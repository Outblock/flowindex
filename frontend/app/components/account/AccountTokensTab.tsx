import { useState, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Coins, Filter, Layers, Box, Info } from 'lucide-react';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import type { FTVaultInfo } from '../../../cadence/cadence.gen';
import { normalizeAddress, getTokenLogoURL } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { EVMBridgeBadge } from '../ui/EVMBridgeBadge';
import { motion, AnimatePresence } from 'framer-motion';
import { getFlowV1Ft } from '../../api/gen/find';
import { UsdValue } from '../UsdValue';
import { resolveApiBaseUrl } from '../../api';

type TokenSubTab = 'all' | 'cadence' | 'evm';

interface EVMToken {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    icon_url?: string;
    balance: number;
    rawValue: string;
}

interface Props {
    address: string;
    coaAddress?: string;
    subtab?: string;
    onSubTabChange?: (subtab: string | undefined) => void;
}

export function AccountTokensTab({ address, coaAddress, subtab, onSubTabChange }: Props) {
    const normalizedAddress = normalizeAddress(address);

    // Determine active sub-tab
    const activeSubTab: TokenSubTab = (subtab === 'cadence' || subtab === 'evm') ? subtab : 'all';
    const setSubTab = (tab: TokenSubTab) => {
        onSubTabChange?.(tab === 'all' ? undefined : tab);
    };

    // --- Cadence tokens state ---
    const [tokens, setTokens] = useState<FTVaultInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [backendFTs, setBackendFTs] = useState<any[]>([]);
    const [priceData, setPriceData] = useState<{ prices: Record<string, number>; tokenMap: Record<string, string> }>({ prices: {}, tokenMap: {} });

    // --- EVM tokens state ---
    const [evmTokens, setEvmTokens] = useState<EVMToken[]>([]);
    const [evmLoading, setEvmLoading] = useState(false);
    const [evmError, setEvmError] = useState<string | null>(null);

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
            if (items.length >= 100) {
                getFlowV1Ft({ query: { limit: 100, offset: 100 } }).then((res2) => {
                    const more = (res2.data as any)?.data || [];
                    setBackendFTs((prev: any[]) => [...prev, ...more]);
                }).catch(() => {});
            }
        }).catch(() => {});
    }, []);

    // Fetch all token prices once
    useEffect(() => {
        resolveApiBaseUrl().then((base) =>
            fetch(`${base}/status/prices`).then(r => r.json()).then((res) => {
                const d = res?.data?.[0];
                if (d) setPriceData({ prices: d.prices || {}, tokenMap: d.token_map || {} });
            })
        ).catch(() => {});
    }, []);

    // Fetch EVM tokens when coaAddress is available
    useEffect(() => {
        if (!coaAddress) {
            setEvmTokens([]);
            return;
        }
        let cancelled = false;
        const load = async () => {
            setEvmLoading(true);
            setEvmError(null);
            try {
                const base = await resolveApiBaseUrl();
                const res = await fetch(`${base}/flow/evm/address/${coaAddress}/token?type=ERC-20`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                const items = json?.items || [];
                if (cancelled) return;
                setEvmTokens(items.map((item: any) => ({
                    address: item.token?.address || '',
                    name: item.token?.name || 'Unknown',
                    symbol: item.token?.symbol || '???',
                    decimals: Number(item.token?.decimals || 18),
                    icon_url: item.token?.icon_url || '',
                    balance: Number(item.value || '0') / Math.pow(10, Number(item.token?.decimals || 18)),
                    rawValue: item.value || '0',
                })));
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to load EVM tokens', err);
                setEvmError('Failed to load EVM tokens');
            } finally {
                if (!cancelled) setEvmLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [coaAddress]);

    // Build lookup map: "A.{hex}.{ContractName}" -> backend metadata
    const metaMap = useMemo(() => {
        const map: Record<string, { name?: string; symbol?: string; logo?: string; evm_address?: string; is_verified?: boolean }> = {};
        for (const ft of backendFTs) {
            const id = ft.id || '';
            if (id) map[id] = { name: ft.name, symbol: ft.symbol, logo: ft.logo, evm_address: ft.evm_address, is_verified: ft.is_verified };
        }
        return map;
    }, [backendFTs]);

    // Get USD price for a token by contract name or symbol
    const getTokenPrice = (contractName: string): number => {
        const sym = priceData.tokenMap[contractName];
        if (sym && priceData.prices[sym]) return priceData.prices[sym];
        return 0;
    };

    const getTokenPriceBySymbol = (symbol: string): number => {
        if (priceData.prices[symbol]) return priceData.prices[symbol];
        // Try uppercase
        const upper = symbol.toUpperCase();
        if (priceData.prices[upper]) return priceData.prices[upper];
        return 0;
    };

    const [hideZero, setHideZero] = useState(true);

    const displayTokens = useMemo(() => {
        let list = [...tokens];
        if (hideZero) list = list.filter(t => t.balance != null && Number(t.balance) > 0);
        list.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
        return list;
    }, [tokens, hideZero]);

    const displayEvmTokens = useMemo(() => {
        let list = [...evmTokens];
        if (hideZero) list = list.filter(t => t.balance > 0);
        list.sort((a, b) => b.balance - a.balance);
        return list;
    }, [evmTokens, hideZero]);

    // --- Merged "All" view ---
    // Build a merged list: Cadence tokens with optional matched EVM balance, plus unmatched EVM-only tokens
    const mergedTokens = useMemo(() => {
        if (activeSubTab !== 'all') return [];

        // Build EVM lookup by lowercase address
        const evmByAddr = new Map<string, EVMToken>();
        for (const et of displayEvmTokens) {
            if (et.address) evmByAddr.set(et.address.toLowerCase(), et);
        }

        const matched = new Set<string>();
        const merged: Array<{
            type: 'cadence' | 'evm' | 'bridged';
            cadenceToken?: FTVaultInfo;
            evmToken?: EVMToken;
            identifier?: string;
            meta?: any;
            displayName: string;
            displaySymbol: string;
            logoUrl: string;
            sortValue: number;
        }> = [];

        for (const t of displayTokens) {
            const identifier = `A.${normalizeAddress(t.contractAddress).replace(/^0x/, '')}.${t.contractName}`;
            const meta = metaMap[identifier];
            const evmAddr = meta?.evm_address || (t as any).evmAddress || '';
            const matchedEvm = evmAddr ? evmByAddr.get(evmAddr.toLowerCase()) : undefined;
            if (matchedEvm) matched.add(matchedEvm.address.toLowerCase());

            const logoUrl = meta?.logo || getTokenLogoURL(t);
            const displayName = meta?.name || t.name || t.contractName;
            const displaySymbol = meta?.symbol || t.symbol;

            // For bridged tokens, use combined balance for sorting
            const cadenceBal = Number(t.balance || 0);
            const evmBal = matchedEvm ? matchedEvm.balance : 0;

            merged.push({
                type: matchedEvm ? 'bridged' : 'cadence',
                cadenceToken: t,
                evmToken: matchedEvm,
                identifier,
                meta,
                displayName,
                displaySymbol,
                logoUrl,
                sortValue: cadenceBal + evmBal,
            });
        }

        // Append unmatched EVM-only tokens
        for (const et of displayEvmTokens) {
            if (!matched.has(et.address.toLowerCase())) {
                merged.push({
                    type: 'evm',
                    evmToken: et,
                    displayName: et.name,
                    displaySymbol: et.symbol,
                    logoUrl: et.icon_url || '',
                    sortValue: et.balance,
                });
            }
        }

        // Sort by combined value descending
        merged.sort((a, b) => b.sortValue - a.sortValue);

        return merged;
    }, [activeSubTab, displayTokens, displayEvmTokens, metaMap]);

    // --- Sub-tab filter buttons ---
    const subTabs: { id: TokenSubTab; label: string; icon: any }[] = [
        { id: 'all', label: 'All', icon: Layers },
        { id: 'cadence', label: 'Cadence', icon: Coins },
        { id: 'evm', label: 'EVM', icon: Box },
    ];

    const isAnythingLoading = loading || evmLoading;

    return (
        <div className="space-y-6">
            {/* Sub-tab bar + filters */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    {subTabs.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setSubTab(id)}
                            className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm whitespace-nowrap shrink-0 ${activeSubTab === id
                                ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                                : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <Icon className={`h-3 w-3 ${activeSubTab === id ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                {label}
                            </span>
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => setHideZero(prev => !prev)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-widest border rounded-sm transition-colors ${hideZero ? 'border-nothing-green-dark/30 dark:border-nothing-green/30 text-nothing-green-dark dark:text-nothing-green bg-nothing-green/5' : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                >
                    <Filter className="w-3 h-3" />
                    {hideZero ? 'Hide Zero' : 'Show All'}
                </button>
            </div>

            {error && activeSubTab !== 'evm' && (
                <GlassCard className="border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
                    <div className="text-xs text-red-500 dark:text-red-400">{error}</div>
                </GlassCard>
            )}
            {evmError && activeSubTab !== 'cadence' && (
                <GlassCard className="border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
                    <div className="text-xs text-red-500 dark:text-red-400">{evmError}</div>
                </GlassCard>
            )}

            {/* --- ALL TAB --- */}
            {activeSubTab === 'all' && (
                <div className="flex flex-col gap-3">
                    {isAnythingLoading ? (
                        <TokenListSkeleton />
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {mergedTokens.map((item, i) => {
                                if (item.type === 'evm' && item.evmToken) {
                                    return (
                                        <motion.div key={`evm-${item.evmToken.address}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                                            <EVMTokenRow token={item.evmToken} getPrice={getTokenPriceBySymbol} />
                                        </motion.div>
                                    );
                                }
                                if (item.type === 'bridged' && item.cadenceToken && item.evmToken) {
                                    return (
                                        <motion.div key={`bridged-${item.identifier}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                                            <BridgedTokenRow
                                                cadenceToken={item.cadenceToken}
                                                evmToken={item.evmToken}
                                                identifier={item.identifier!}
                                                meta={item.meta}
                                                logoUrl={item.logoUrl}
                                                displayName={item.displayName}
                                                displaySymbol={item.displaySymbol}
                                                getTokenPrice={getTokenPrice}
                                                getTokenPriceBySymbol={getTokenPriceBySymbol}
                                            />
                                        </motion.div>
                                    );
                                }
                                const t = item.cadenceToken!;
                                return (
                                    <motion.div key={`${t.contractAddress}-${t.contractName}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                                        <CadenceTokenRow
                                            token={t}
                                            identifier={item.identifier!}
                                            meta={item.meta}
                                            logoUrl={item.logoUrl}
                                            displayName={item.displayName}
                                            displaySymbol={item.displaySymbol}
                                            getTokenPrice={getTokenPrice}
                                        />
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    )}
                    {mergedTokens.length === 0 && !isAnythingLoading && (
                        <EmptyState />
                    )}
                </div>
            )}

            {/* --- CADENCE TAB --- */}
            {activeSubTab === 'cadence' && (
                <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                        <Coins className="w-4 h-4" />
                        Cadence Tokens ({displayTokens.length}{hideZero && tokens.length !== displayTokens.length ? ` / ${tokens.length}` : ''})
                    </h3>
                    {loading ? (
                        <TokenListSkeleton />
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {displayTokens.map((t: FTVaultInfo, i: number) => {
                                const identifier = `A.${normalizeAddress(t.contractAddress).replace(/^0x/, '')}.${t.contractName}`;
                                const meta = metaMap[identifier];
                                const logoUrl = meta?.logo || getTokenLogoURL(t);
                                const displayName = meta?.name || t.name || t.contractName;
                                const displaySymbol = meta?.symbol || t.symbol;
                                return (
                                    <motion.div key={`${t.contractAddress}-${t.contractName}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                                        <CadenceTokenRow
                                            token={t}
                                            identifier={identifier}
                                            meta={meta}
                                            logoUrl={logoUrl}
                                            displayName={displayName}
                                            displaySymbol={displaySymbol}
                                            getTokenPrice={getTokenPrice}
                                        />
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    )}
                    {displayTokens.length === 0 && !loading && <EmptyState />}
                </div>
            )}

            {/* --- EVM TAB --- */}
            {activeSubTab === 'evm' && (
                <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                        <Box className="w-4 h-4" />
                        EVM Tokens ({displayEvmTokens.length})
                    </h3>
                    {!coaAddress ? (
                        <GlassCard className="text-center py-12">
                            <Info className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
                            <div className="text-zinc-500 italic">This account does not have a COA (EVM) address</div>
                            <div className="text-xs text-zinc-400 mt-2">EVM token balances are only available for accounts with a Cadence-Owned Account on Flow EVM.</div>
                        </GlassCard>
                    ) : evmLoading ? (
                        <TokenListSkeleton />
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {displayEvmTokens.map((t, i) => (
                                <motion.div key={t.address} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                                    <EVMTokenRow token={t} getPrice={getTokenPriceBySymbol} />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    )}
                    {coaAddress && displayEvmTokens.length === 0 && !evmLoading && (
                        <GlassCard className="text-center py-12">
                            <Box className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
                            <div className="text-zinc-500 italic">No ERC-20 tokens found on EVM</div>
                        </GlassCard>
                    )}
                </div>
            )}
        </div>
    );
}

// --- Reusable sub-components ---

function TokenListSkeleton() {
    return (
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
    );
}

function EmptyState() {
    return (
        <GlassCard className="text-center py-12">
            <Coins className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
            <div className="text-zinc-500 italic">No fungible tokens found</div>
        </GlassCard>
    );
}

function TokenIcon({ logoUrl, name }: { logoUrl: string; name: string }) {
    return (
        <div className="flex-shrink-0">
            {logoUrl ? (
                <img
                    src={logoUrl}
                    alt={name}
                    className="w-10 h-10 object-cover bg-white dark:bg-white/10 shadow-sm rounded-full"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                />
            ) : null}
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/10 dark:to-white/5 flex items-center justify-center shadow-inner ${logoUrl ? 'hidden' : ''}`}>
                <Coins className="h-5 w-5 text-zinc-400" />
            </div>
        </div>
    );
}

function SmallTokenIcon({ logoUrl, fallback }: { logoUrl: string; fallback?: React.ReactNode }) {
    if (!logoUrl) return <>{fallback || <Coins className="w-4 h-4 text-zinc-400" />}</>;
    return (
        <img
            src={logoUrl}
            className="w-4 h-4 rounded-full object-cover bg-white dark:bg-white/10"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
    );
}

function BridgedTokenRow({ cadenceToken: t, evmToken, identifier, meta, logoUrl, displayName, displaySymbol, getTokenPrice, getTokenPriceBySymbol }: {
    cadenceToken: FTVaultInfo;
    evmToken: EVMToken;
    identifier: string;
    meta: any;
    logoUrl: string;
    displayName: string;
    displaySymbol: string;
    getTokenPrice: (name: string) => number;
    getTokenPriceBySymbol: (symbol: string) => number;
}) {
    const cadenceBal = Number(t.balance || 0);
    const evmBal = evmToken.balance;
    const totalBal = cadenceBal + evmBal;
    const cadencePrice = getTokenPrice(t.contractName);
    const evmPrice = getTokenPriceBySymbol(evmToken.symbol) || cadencePrice;
    const totalUsd = cadenceBal * cadencePrice + evmBal * evmPrice;

    // Use best available logo: cadence metadata logo or EVM icon, complement each other
    const cadenceLogoUrl = logoUrl;
    const evmLogoUrl = evmToken.icon_url || '';
    const bestLogo = cadenceLogoUrl || evmLogoUrl;

    return (
        <GlassCard className="hover:bg-white/40 dark:hover:bg-white/10 transition-colors group relative overflow-hidden p-4">
            {/* Header: token identity + combined total */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    <TokenIcon logoUrl={bestLogo} name={displayName} />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <div className="font-bold text-zinc-900 dark:text-white leading-tight truncate">{displayName}</div>
                            <div className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full">{displaySymbol}</div>
                            <EVMBridgeBadge evmAddress={meta?.evm_address || (t as any).evmAddress || ''} />
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                            <Link
                                to="/tokens/$token"
                                params={{ token: identifier }}
                                className="text-[10px] font-mono text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors truncate max-w-[160px]"
                            >
                                {t.contractName}
                            </Link>
                            {meta?.is_verified && <VerifiedBadge size={13} />}
                            {(() => {
                                const p = cadencePrice;
                                if (!p) return null;
                                const fmt = p >= 1 ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : p >= 0.01 ? `$${p.toFixed(4)}` : `$${p.toFixed(6)}`;
                                return <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500">@ {fmt}</span>;
                            })()}
                        </div>
                    </div>
                </div>

                <div className="text-right flex-shrink-0">
                    <div className="text-lg font-mono font-bold text-zinc-900 dark:text-white">
                        {totalBal.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </div>
                    {totalUsd > 0 && <UsdValue amount={1} price={totalUsd} className="text-xs" />}
                </div>
            </div>

            {/* Sub-rows: Cadence + EVM breakdowns */}
            <div className="mt-3 ml-14 border-t border-zinc-100 dark:border-white/5 pt-2 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <SmallTokenIcon logoUrl={cadenceLogoUrl} fallback={<Coins className="w-4 h-4 text-zinc-400" />} />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Cadence</span>
                        <span className="text-[10px] font-mono text-zinc-400">{t.symbol || displaySymbol}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                            {cadenceBal.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        </span>
                        {cadenceBal > 0 && cadencePrice > 0 && (
                            <UsdValue amount={cadenceBal} price={cadencePrice} className="text-[10px] text-zinc-400" />
                        )}
                    </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <SmallTokenIcon logoUrl={evmLogoUrl} fallback={<Box className="w-4 h-4 text-purple-400" />} />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-purple-500 dark:text-purple-400">EVM</span>
                        <span className="text-[10px] font-mono text-zinc-400">{evmToken.symbol}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                            {evmBal.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        </span>
                        {evmBal > 0 && evmPrice > 0 && (
                            <UsdValue amount={evmBal} price={evmPrice} className="text-[10px] text-zinc-400" />
                        )}
                    </div>
                </div>
            </div>
        </GlassCard>
    );
}

function CadenceTokenRow({ token: t, identifier, meta, logoUrl, displayName, displaySymbol, getTokenPrice }: {
    token: FTVaultInfo;
    identifier: string;
    meta: any;
    logoUrl: string;
    displayName: string;
    displaySymbol: string;
    getTokenPrice: (name: string) => number;
}) {
    const evmAddr = meta?.evm_address || (t as any).evmAddress || '';
    return (
        <GlassCard className="hover:bg-white/40 dark:hover:bg-white/10 transition-colors group relative overflow-hidden p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
                <TokenIcon logoUrl={logoUrl} name={displayName} />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="font-bold text-zinc-900 dark:text-white leading-tight truncate">{displayName}</div>
                        <div className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full">{displaySymbol}</div>
                        {evmAddr && <EVMBridgeBadge evmAddress={evmAddr} />}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                        <Link
                            to="/tokens/$token"
                            params={{ token: identifier }}
                            className="text-[10px] font-mono text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors truncate max-w-[160px]"
                        >
                            {t.contractName}
                        </Link>
                        {meta?.is_verified && <VerifiedBadge size={13} />}
                        {(() => {
                            const p = getTokenPrice(t.contractName);
                            if (!p) return null;
                            const fmt = p >= 1 ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : p >= 0.01 ? `$${p.toFixed(4)}` : `$${p.toFixed(6)}`;
                            return <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500">@ {fmt}</span>;
                        })()}
                    </div>
                </div>
            </div>

            <div className="text-right flex-shrink-0">
                <div className="text-lg font-mono font-bold text-zinc-900 dark:text-white">
                    {t.balance != null ? Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}
                </div>
                {t.balance != null && Number(t.balance) > 0 && (() => {
                    const price = getTokenPrice(t.contractName);
                    return price > 0 ? <UsdValue amount={Number(t.balance)} price={price} className="text-xs" /> : null;
                })()}
            </div>
        </GlassCard>
    );
}

function EVMTokenRow({ token, getPrice }: { token: EVMToken; getPrice: (symbol: string) => number }) {
    const price = getPrice(token.symbol);
    return (
        <GlassCard className="hover:bg-white/40 dark:hover:bg-white/10 transition-colors group relative overflow-hidden p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
                <TokenIcon logoUrl={token.icon_url || ''} name={token.name} />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="font-bold text-zinc-900 dark:text-white leading-tight truncate">{token.name}</div>
                        <div className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full">{token.symbol}</div>
                        <span className="text-[9px] font-mono text-purple-500 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">EVM</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[200px]">{token.address}</span>
                        {price > 0 && (() => {
                            const fmt = price >= 1 ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : price >= 0.01 ? `$${price.toFixed(4)}` : `$${price.toFixed(6)}`;
                            return <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500">@ {fmt}</span>;
                        })()}
                    </div>
                </div>
            </div>
            <div className="text-right flex-shrink-0">
                <div className="text-lg font-mono font-bold text-zinc-900 dark:text-white">
                    {token.balance.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                </div>
                {token.balance > 0 && price > 0 && (
                    <UsdValue amount={token.balance} price={price} className="text-xs" />
                )}
            </div>
        </GlassCard>
    );
}
