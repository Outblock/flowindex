import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1KeyByPublicKey } from '../../api/gen/find';
import { ArrowLeft, Key, ShieldCheck, ShieldOff } from 'lucide-react';
import { CopyButton } from '../../../components/animate-ui/components/buttons/copy';

export const Route = createFileRoute('/key/$publicKey')({
    component: KeySearchResults,
    loader: async ({ params }) => {
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1KeyByPublicKey({ path: { publicKey: params.publicKey } });
            const items: any[] = res.data?.data ?? [];
            const meta: any = res.data?._meta ?? {};
            return { keys: items, meta, error: null };
        } catch (e) {
            console.error("Failed to search by public key", e);
            return { keys: [], meta: {}, error: 'Failed to search accounts by public key' };
        }
    }
})

function KeySearchResults() {
    const { keys: initialKeys, meta: initialMeta, error: initialError } = Route.useLoaderData();
    const { publicKey } = Route.useParams();
    const [keys, setKeys] = useState<any[]>(initialKeys);
    const [error, setError] = useState<string | null>(initialError);

    useEffect(() => {
        setKeys(initialKeys);
        setError(initialError);
    }, [initialKeys, initialError]);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                {/* Back Button */}
                <Link to="/" className="inline-flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-8 group">
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Return to Dashboard</span>
                </Link>

                {/* Header */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-8 relative overflow-hidden bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Key className="h-32 w-32" />
                    </div>

                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green-dark/30 dark:border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                                Public Key Search
                            </span>
                        </div>

                        <h1 className="text-xl md:text-2xl font-bold text-zinc-900 dark:text-white mb-2 break-all">
                            {publicKey}
                        </h1>
                        <div className="flex items-center gap-2">
                            <CopyButton
                                content={publicKey}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            />
                            <span className="text-xs text-zinc-500">
                                {keys.length} account{keys.length !== 1 ? 's' : ''} found
                            </span>
                        </div>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="border border-red-500/30 bg-red-50 dark:bg-nothing-dark p-8 text-center mb-8">
                        <Key className="h-12 w-12 text-red-500 mx-auto mb-4" />
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Error</h2>
                        <p className="text-zinc-600 dark:text-zinc-500 text-xs">{error}</p>
                    </div>
                )}

                {/* Results Table */}
                <div className="border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="p-6 border-b border-zinc-200 dark:border-white/10 flex justify-between items-center">
                        <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest">Matching Accounts</h2>
                        <span className="text-xs text-zinc-500">{keys.length} Result{keys.length !== 1 ? 's' : ''}</span>
                    </div>

                    <div className="overflow-x-auto">
                        {keys.length > 0 ? (
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                        <th className="p-4 font-normal">Address</th>
                                        <th className="p-4 font-normal">Key Index</th>
                                        <th className="p-4 font-normal">Signing Algo</th>
                                        <th className="p-4 font-normal">Hashing Algo</th>
                                        <th className="p-4 font-normal text-right">Weight</th>
                                        <th className="p-4 font-normal text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {keys.map((k: any, i: number) => (
                                        <tr key={`${k.address}-${k.key_index}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <AddressLink address={k.address} prefixLen={20} suffixLen={0} />
                                                    <CopyButton
                                                        content={k.address}
                                                        variant="ghost"
                                                        size="xs"
                                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 ml-1"
                                                    />
                                                </div>
                                            </td>
                                            <td className="p-4 text-zinc-600 dark:text-zinc-400">
                                                {k.key_index}
                                            </td>
                                            <td className="p-4">
                                                <span className="border border-zinc-200 dark:border-white/10 px-2 py-1 rounded-sm text-zinc-600 dark:text-zinc-300 text-[10px] uppercase bg-zinc-50 dark:bg-transparent">
                                                    {k.signing_algorithm}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className="border border-zinc-200 dark:border-white/10 px-2 py-1 rounded-sm text-zinc-600 dark:text-zinc-300 text-[10px] uppercase bg-zinc-50 dark:bg-transparent">
                                                    {k.hashing_algorithm}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right text-zinc-600 dark:text-zinc-400">
                                                {k.weight}
                                            </td>
                                            <td className="p-4 text-center">
                                                {k.revoked ? (
                                                    <span className="inline-flex items-center gap-1 text-red-500 text-[10px] uppercase">
                                                        <ShieldOff className="w-3 h-3" />
                                                        Revoked
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-nothing-green-dark dark:text-nothing-green text-[10px] uppercase">
                                                        <ShieldCheck className="w-3 h-3" />
                                                        Active
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : !error ? (
                            <div className="p-8 text-center text-zinc-500 italic">
                                No accounts found for this public key
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
