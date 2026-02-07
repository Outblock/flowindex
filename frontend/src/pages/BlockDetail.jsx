import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Box, Clock, Hash, Activity, ArrowRightLeft, User, Coins, Image as ImageIcon } from 'lucide-react';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/time';
import { useTimeTicker } from '../hooks/useTimeTicker';

function BlockDetail() {
  const { height } = useParams();
  const [block, setBlock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const nowTick = useTimeTicker(20000);

  useEffect(() => {
    const loadBlock = async () => {
      try {
        const rawBlock = await api.getBlock(height);
        // Transform transactions if present
        const transformedBlock = {
          ...rawBlock,
          transactions: (rawBlock.transactions || []).map(tx => ({
            ...tx,
            type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
            payer: tx.payer_address || tx.proposer_address,
            blockHeight: tx.block_height
          }))
        };
        setBlock(transformedBlock);
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch block:', err);
        setError('Block not found');
        setLoading(false);
      }
    };
    loadBlock();
  }, [height]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 border-t-nothing-green-dark dark:border-t-nothing-green rounded-full animate-spin"></div>
          <p className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] animate-pulse">Retrieving Block Data...</p>
        </div>
      </div>
    );
  }

  if (error || !block) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
        <div className="border border-red-500/30 bg-red-50 dark:bg-nothing-dark p-8 max-w-md text-center shadow-sm">
          <Box className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Block Not Found</h2>
          <p className="text-zinc-600 dark:text-zinc-500 text-xs mb-6">The requested block could not be located.</p>
          <Link to="/" className="inline-block w-full border border-red-200 dark:border-white/20 hover:bg-red-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const blockTimeAbsolute = formatAbsoluteTime(block.timestamp);
  const blockTimeRelative = formatRelativeTime(block.timestamp, nowTick);

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
              <div className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-widest">
                <Hash className="w-3 h-3" />
                <span className="break-all">{block.id}</span>
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
                <code className="text-sm text-zinc-600 dark:text-zinc-400 break-all">{block.parentId}</code>
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
                  {block.transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                      <td className="p-4">
                        <Link to={`/transactions/${tx.id}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                          {tx.id.slice(0, 16)}...
                        </Link>
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

export default BlockDetail;
