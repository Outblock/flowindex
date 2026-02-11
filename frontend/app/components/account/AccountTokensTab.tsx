import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { Coins } from 'lucide-react';
import type { FTVaultInfo, StorageInfo as FCLStorageInfo } from '../../../cadence/cadence.gen';
import { normalizeAddress, formatShort, getTokenLogoURL } from './accountUtils';

interface Props {
    address: string;
}

export function AccountTokensTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [tokens, setTokens] = useState<FTVaultInfo[]>([]);
    const [storage, setStorage] = useState<FCLStorageInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadTokens = async () => {
        setLoading(true);
        setError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const res = await cadenceService.getToken(normalizedAddress);
            setTokens(res?.tokens || []);
            setStorage(res?.storage || null);
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

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500">Fungible Tokens</div>
                {loading && <div className="text-[10px] text-zinc-500">Loading...</div>}
            </div>

            {error && <div className="text-xs text-red-500 dark:text-red-400 mb-4">{error}</div>}

            {/* Storage summary */}
            {storage && (
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">Used</div>
                        <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{storage.storageUsedInMB}</div>
                    </div>
                    <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">Capacity</div>
                        <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{storage.storageCapacityInMB}</div>
                    </div>
                    <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">Available</div>
                        <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{storage.storageAvailableInMB}</div>
                    </div>
                </div>
            )}

            {/* Token table */}
            <div className="min-h-[120px] relative">
                {tokens.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                    <th className="p-4 font-normal">Token</th>
                                    <th className="p-4 font-normal">Contract</th>
                                    <th className="p-4 font-normal text-right">Balance</th>
                                    <th className="p-4 font-normal">EVM Bridge</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {tokens.map((t: any, i: number) => {
                                    const logoUrl = getTokenLogoURL(t);
                                    return (
                                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    {logoUrl ? (
                                                        <img src={logoUrl} alt="" className="w-5 h-5 rounded-full object-cover bg-zinc-200 dark:bg-white/10 flex-shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
                                                    ) : null}
                                                    <div className={`w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center flex-shrink-0 ${logoUrl ? 'hidden' : ''}`}>
                                                        <Coins className="h-3 w-3 text-zinc-400" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-mono text-zinc-900 dark:text-white truncate">{t.name || t.contractName}</div>
                                                        {t.symbol && <div className="text-[10px] text-zinc-500">{t.symbol}</div>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <Link to={`/accounts/${normalizeAddress(t.contractAddress)}` as any} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                                    {formatShort(t.contractAddress)}
                                                </Link>
                                                <div className="text-[10px] text-zinc-500">{t.contractName}</div>
                                            </td>
                                            <td className="p-4 text-right font-mono font-bold text-zinc-900 dark:text-white">
                                                {t.balance != null ? Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                            </td>
                                            <td className="p-4 font-mono text-zinc-500 text-[10px]">
                                                {t.evmAddress || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : !loading ? (
                    <div className="text-center text-zinc-500 italic py-8">No tokens found</div>
                ) : null}
            </div>
        </div>
    );
}
