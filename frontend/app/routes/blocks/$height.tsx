import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1BlockByHeight, getFlowV1BlockByHeightTransaction } from '../../api/gen/find';
import { ArrowLeft, Box, Clock, Hash, Activity, ArrowRightLeft, User, Coins, Image as ImageIcon, Layers } from 'lucide-react';
import { NotFoundPage } from '../../components/ui/NotFoundPage';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { buildMeta } from '../../lib/og/meta';

export const Route = createFileRoute('/blocks/$height')({
    component: BlockDetail,
    loader: async ({ params }) => {
        try {
            await ensureHeyApiConfigured();
            const [blockRes, txRes] = await Promise.all([
                getFlowV1BlockByHeight({ path: { height: Number(params.height) as any } }),
                getFlowV1BlockByHeightTransaction({ path: { height: Number(params.height) as any } }),
            ]);
            const rawBlock: any = blockRes.data?.data?.[0] ?? blockRes.data?.data ?? null;
            if (!rawBlock) return { block: null };
            const rawTxs: any[] = txRes.data?.data ?? [];
            const transformedBlock = {
                ...rawBlock,
                txCount: rawBlock.tx_count ?? rawBlock.tx ?? rawTxs.length,
                transactions: rawTxs.map(tx => ({
                    ...tx,
                    type: tx.tags?.[0] || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
                    payer: tx.payer || tx.payer_address || tx.proposer_address,
                    blockHeight: tx.block_height,
                    gasUsed: tx.gas_used ?? 0,
                }))
            };
            return { block: transformedBlock };
        } catch (e) {
            console.error("Failed to load block data", e);
            return { block: null };
        }
    },
    head: ({ params }) => ({
        meta: buildMeta({
            title: `Block #${Number(params.height).toLocaleString()}`,
            description: `Flow block at height ${Number(params.height).toLocaleString()}`,
            ogImagePath: `block/${params.height}`,
        }),
    }),
})


function BlockDetail() {
    const { height } = Route.useParams();
    const { block: initialBlock } = Route.useLoaderData();
    const [block, setBlock] = useState<any>(initialBlock);
    // const [loading, setLoading] = useState(false); // handled by loader
    const [error, setError] = useState<any>(initialBlock ? null : 'Block not found');
    const nowTick = useTimeTicker(20000);

    // If initial load failed, we could retry client side, but for now we assume loader failure means not found/error
    useEffect(() => {
        if (!initialBlock) {
            setError('Block not found');
        } else {
            setBlock(initialBlock);
            setError(null);
        }
    }, [initialBlock]);

    if (error || !block) {
        return (
            <NotFoundPage
                icon={Box}
                title="Block Not Found"
                identifier={`Block #${height}`}
                description="This block could not be located in our indexed data."
                hint="The indexer may not have reached this block yet. Check indexing progress or try again shortly."
            />
        );
    }

    const blockTimeAbsolute = formatAbsoluteTime(block.timestamp);
    const blockTimeRelative = formatRelativeTime(block.timestamp, nowTick);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                {/* Back Button */}
                <button onClick={() => window.history.back()} className="inline-flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-8 group">
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Back</span>
                </button>

                {/* Header */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-8 relative overflow-hidden bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Box className="h-32 w-32" />
                    </div>

                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6">
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <span className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green-dark/30 dark:border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                                    Block
                                </span>
                                {block.isSealed && (
                                    <span className="text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-[0.2em] border border-zinc-300 dark:border-zinc-700 px-2 py-1 rounded-sm w-fit">
                                        Sealed
                                    </span>
                                )}
                            </div>

                            <h1 className="text-4xl md:text-5xl font-bold text-zinc-900 dark:text-white mb-2">
                                #{block.height.toLocaleString()}
                            </h1>
                            <div className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-widest group">
                                <Hash className="w-3 h-3" />
                                <span className="break-all">{block.id}</span>
                                <CopyButton
                                    content={block.id}
                                    variant="ghost"
                                    size="xs"
                                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                />
                            </div>
                        </div>

                        <div className="text-right">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Timestamp</p>
                            <p className="text-sm text-zinc-900 dark:text-white">
                                {blockTimeAbsolute || 'N/A'}
                            </p>
                            {blockTimeRelative && (
                                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">
                                    {blockTimeRelative}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                            Block Details
                        </h2>
                        <div className="space-y-6">
                            <div className="group">
                                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Parent Hash</p>
                                <div className="flex items-center gap-2 group">
                                    <code className="text-sm text-zinc-600 dark:text-zinc-400 break-all">{block.parentId}</code>
                                    <CopyButton
                                        content={block.parentId}
                                        variant="ghost"
                                        size="xs"
                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Collection Count</p>
                                    <span className="text-xl text-zinc-900 dark:text-white">{block.collectionCount || 0}</span>
                                </div>
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Total Gas Used</p>
                                    <span className="text-xl text-zinc-900 dark:text-white">{block.totalGasUsed || 0}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark flex flex-col justify-center items-center text-center shadow-sm dark:shadow-none">
                        <Activity className="w-8 h-8 text-nothing-green-dark dark:text-nothing-green mb-4" />
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Transaction Count</p>
                        <p className="text-5xl text-zinc-900 dark:text-white font-bold">{block.txCount || (block.transactions?.length || 0)}</p>
                    </div>
                </div>

                {/* Transactions List */}
                <div className="border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="p-6 border-b border-zinc-200 dark:border-white/10 flex justify-between items-center">
                        <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest">Transactions</h2>
                        <span className="text-xs text-zinc-500">{block.transactions?.length || 0} Found</span>
                    </div>

                    <div className="overflow-x-auto">
                        {block.transactions && block.transactions.length > 0 ? (
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                        <th className="p-4 font-normal">Tx Hash</th>
                                        <th className="p-4 font-normal">Type</th>
                                        <th className="p-4 font-normal">Status</th>
                                        <th className="p-4 font-normal text-right">Gas</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {block.transactions.map((tx: any) => (
                                        <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <Link to={`/txs/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                                        {tx.id.slice(0, 16)}...
                                                    </Link>
                                                    <CopyButton
                                                        content={tx.id}
                                                        variant="ghost"
                                                        size="xs"
                                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 ml-1"
                                                    />
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="border border-zinc-200 dark:border-white/10 px-2 py-1 rounded-sm text-zinc-600 dark:text-zinc-300 text-[10px] uppercase bg-zinc-50 dark:bg-transparent">
                                                    {tx.type}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-500 dark:text-zinc-400' : 'text-yellow-600 dark:text-yellow-500'}`}>
                                                    {tx.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right text-zinc-600 dark:text-zinc-400">
                                                {tx.gasUsed || 0}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="p-8 text-center text-zinc-500 italic">No transactions in this block</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
