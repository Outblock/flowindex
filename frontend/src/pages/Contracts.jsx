import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Search, Database } from 'lucide-react';
import NumberFlow from '@number-flow/react';

import { api } from '../api';
import { useWebSocketStatus } from '../hooks/useWebSocket';
import { Pagination } from '../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/time';
import { useTimeTicker } from '../hooks/useTimeTicker';

export default function Contracts() {
  const [contracts, setContracts] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const limit = 25;
  const offset = useMemo(() => (page - 1) * limit, [page]);

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

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
      const res = await api.listFlowContracts(limit, offset, { identifier: activeQuery });
      setContracts(res?.data || []);
      setMeta(res?._meta || null);
    } catch (err) {
      console.error('Failed to load contracts:', err);
      setError('Failed to load contracts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeQuery]);

  const totalCount = Number(meta?.count || 0);
  const hasNext = totalCount > 0 ? offset + limit < totalCount : contracts.length === limit;

  const submitQuery = (e) => {
    e.preventDefault();
    const next = String(query || '').trim();
    setActiveQuery(next);
    setPage(1);
  };

  if (loading && contracts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 border-t-nothing-green-dark dark:border-t-nothing-green rounded-full animate-spin"></div>
          <p className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] animate-pulse">Loading Contracts...</p>
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
            <FileText className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Contracts</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Smart Contracts Indexed</p>
          </div>
        </div>

        <div className={`flex items-center space-x-2 px-3 py-1 border rounded-full ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            {isConnected ? 'Live Feed' : 'Offline'}
          </span>
        </div>
      </motion.div>

      {/* Filter */}
      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        onSubmit={submitQuery}
        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 rounded-sm shadow-sm dark:shadow-none flex items-center gap-3"
      >
        <div className="flex items-center gap-2 text-zinc-500">
          <Search className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-widest font-semibold">Filter</span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="identifier or address (e.g. A.82ed... .MyContract or 0x82ed...)"
          className="flex-1 bg-transparent border border-zinc-200 dark:border-white/10 px-3 py-2 rounded-sm text-sm font-mono text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-nothing-green/30"
        />
        <button
          type="submit"
          className="px-4 py-2 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-sm text-xs uppercase tracking-widest font-semibold text-zinc-700 dark:text-zinc-200 transition-colors"
        >
          Apply
        </button>
      </motion.form>

      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Total Contracts</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={Number.isFinite(totalCount) ? totalCount : 0} format={{ useGrouping: true }} />
          </p>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Valid From Height</p>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-zinc-400" />
            <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
              <NumberFlow value={Number(meta?.valid_from || 0)} format={{ useGrouping: true }} />
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Filter</p>
          <p className="text-sm font-mono text-zinc-900 dark:text-white break-all">
            {activeQuery || '(none)'}
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

      {/* Contracts Table */}
      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Identifier</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Valid From</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Imports</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {contracts.map((c) => {
                  const identifier = String(c?.identifier || c?.id || '');
                  const addr = normalizeHex(c?.address);
                  const validFrom = Number(c?.valid_from || 0);
                  const createdAt = c?.created_at || '';
                  const rel = createdAt ? formatRelativeTime(createdAt, nowTick) : '';
                  const abs = createdAt ? formatAbsoluteTime(createdAt) : '';
                  const imports = Number(c?.import_count || 0);

                  return (
                    <motion.tr
                      layout
                      key={identifier || `${addr}-${validFrom}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          to={`/contracts/${identifier}`}
                          className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline"
                          title={identifier}
                        >
                          {identifier}
                        </Link>
                      </td>
                      <td className="p-4">
                        {addr ? (
                          <Link
                            to={`/accounts/${addr}`}
                            className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                          >
                            {addr}
                          </Link>
                        ) : (
                          <span className="text-zinc-500">N/A</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                          {validFrom ? validFrom.toLocaleString() : '0'}
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
                          {Number.isFinite(imports) ? imports : 0}
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

