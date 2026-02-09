import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Database } from 'lucide-react';
import NumberFlow from '@number-flow/react';

import { api } from '../api';
import { useWebSocketStatus } from '../hooks/useWebSocket';
import { Pagination } from '../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/time';
import { useTimeTicker } from '../hooks/useTimeTicker';

export default function Accounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [page, setPage] = useState(1);
  const limit = 20;
  const offset = useMemo(() => (page - 1) * limit, [page]);

  const { isConnected } = useWebSocketStatus();
  const nowTick = useTimeTicker(20000);

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listFlowAccounts(limit, offset, { sort_by: 'block_height' });
      setAccounts(res?.data || []);
      setMeta(res?._meta || null);
    } catch (err) {
      console.error('Failed to load accounts:', err);
      setError('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalCount = Number(meta?.count || 0);
  const hasNext = totalCount > 0 ? offset + limit < totalCount : accounts.length === limit;

  if (loading && accounts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 border-t-nothing-green-dark dark:border-t-nothing-green rounded-full animate-spin"></div>
          <p className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] animate-pulse">Loading Accounts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10 rounded-lg">
            <Users className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Accounts</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Flow Accounts Catalog</p>
          </div>
        </div>

        <div className={`flex items-center space-x-2 px-3 py-1 border rounded-full ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            {isConnected ? 'Live Feed' : 'Offline'}
          </span>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Total Accounts</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={Number.isFinite(totalCount) ? totalCount : 0} format={{ useGrouping: true }} />
          </p>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Indexed At Height</p>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-zinc-400" />
            <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
              <NumberFlow value={Number(meta?.height || 0)} format={{ useGrouping: true }} />
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Sort</p>
          <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
            {meta?.sort_by || 'block_height'}
          </p>
          {meta?.warning ? (
            <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-widest">{meta.warning}</p>
          ) : null}
        </div>
      </motion.div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-4 rounded-sm text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Accounts Table */}
      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Last Seen Height</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Updated</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Storage Used (MB)</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Storage Available (MB)</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {accounts.map((a) => {
                  const addr = normalizeHex(a?.address);
                  const height = Number(a?.height || 0);
                  const ts = a?.timestamp || '';
                  const rel = ts ? formatRelativeTime(ts, nowTick) : '';
                  const abs = ts ? formatAbsoluteTime(ts) : '';
                  const used = Number(a?.storage_used || 0);
                  const available = Number(a?.storage_available || 0);

                  return (
                    <motion.tr
                      layout
                      key={addr || `${height}-${ts}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          to={`/accounts/${addr}`}
                          className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                        >
                          {addr}
                        </Link>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                          {height ? height.toLocaleString() : '0'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-zinc-900 dark:text-white">{rel}</span>
                          <span className="text-xs text-zinc-500">{abs}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                          {Number.isFinite(used) ? used.toFixed(2) : '0.00'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                          {Number.isFinite(available) ? available.toFixed(2) : '0.00'}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-white/5">
          <Pagination
            currentPage={page}
            onPageChange={setPage}
            hasNext={hasNext}
          />
        </div>
      </div>
    </div>
  );
}

