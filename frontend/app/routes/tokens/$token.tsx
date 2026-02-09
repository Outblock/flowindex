import { createFileRoute, Link } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, Users, ArrowRightLeft } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../../api';
import { Pagination } from '../../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';

interface TokenSearch {
  holdersPage?: number;
  transfersPage?: number;
}

export const Route = createFileRoute('/tokens/$token')({
  component: TokenDetail,
  validateSearch: (search: Record<string, unknown>): TokenSearch => ({
    holdersPage: Number(search.holdersPage) || 1,
    transfersPage: Number(search.transfersPage) || 1,
  }),
  loaderDeps: ({ params: { token }, search: { holdersPage, transfersPage } }) => ({ token, holdersPage, transfersPage }),
  loader: async ({ deps: { token, holdersPage, transfersPage } }) => {
    const holdersLimit = 25;
    const transfersLimit = 25;
    const holdersOffset = (holdersPage - 1) * holdersLimit;
    const transfersOffset = (transfersPage - 1) * transfersLimit;

    try {
      const [tokenRes, holdersRes, transfersRes] = await Promise.all([
        api.getFlowFTToken(token),
        api.listFlowFTHoldingsByToken(token, holdersLimit, holdersOffset),
        api.listFlowFTTransfers(transfersLimit, transfersOffset, { token }),
      ]);

      const tokenRow = (tokenRes?.data && tokenRes.data[0]) || null;
      return {
        token: tokenRow,
        holders: holdersRes?.data || [],
        holdersMeta: holdersRes?._meta || null,
        transfers: transfersRes?.data || [],
        transfersMeta: transfersRes?._meta || null,
        tokenParam: token,
        holdersPage,
        transfersPage,
      };
    } catch (e) {
      console.error('Failed to load token detail', e);
      return {
        token: null,
        holders: [],
        holdersMeta: null,
        transfers: [],
        transfersMeta: null,
        tokenParam: token,
        holdersPage,
        transfersPage,
      };
    }
  },
})

function TokenDetail() {
  const { token, holders, holdersMeta, transfers, transfersMeta, tokenParam, holdersPage, transfersPage } =
    Route.useLoaderData();
  const navigate = Route.useNavigate();
  const nowTick = useTimeTicker(20000);

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const id = String(token?.id || tokenParam);
  const addr = normalizeHex(token?.address);
  const symbol = String(token?.symbol || '');
  const decimals = Number(token?.decimals || 0);
  const updatedAt = token?.updated_at || token?.timestamp || '';
  const rel = updatedAt ? formatRelativeTime(updatedAt, nowTick) : '';
  const abs = updatedAt ? formatAbsoluteTime(updatedAt) : '';

  const holdersLimit = 25;
  const holdersOffset = (holdersPage - 1) * holdersLimit;
  const holdersCount = Number(holdersMeta?.count || 0);
  const holdersHasNext = holdersCount > 0 ? holdersOffset + holdersLimit < holdersCount : holders.length === holdersLimit;

  const transfersLimit = 25;
  const transfersOffset = (transfersPage - 1) * transfersLimit;
  const transfersCount = Number(transfersMeta?.count || 0);
  const transfersHasNext = transfersCount > 0 ? transfersOffset + transfersLimit < transfersCount : transfers.length === transfersLimit;

  const setHoldersPage = (newPage: number) => {
    navigate({ search: { holdersPage: newPage, transfersPage } });
  };

  const setTransfersPage = (newPage: number) => {
    navigate({ search: { holdersPage, transfersPage: newPage } });
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10 rounded-lg">
            <Coins className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">
              Token
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono break-all">{id}</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Contract Address</p>
          <p className="text-sm font-mono text-zinc-900 dark:text-white break-all">
            {addr ? (
              <Link to={`/accounts/${addr}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline">
                {addr}
              </Link>
            ) : (
              'N/A'
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Symbol / Decimals</p>
          <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
            {symbol || '—'} <span className="text-sm text-zinc-500">/</span>{' '}
            <NumberFlow value={Number.isFinite(decimals) ? decimals : 0} />
          </p>
          <div className="mt-2 text-xs text-zinc-500">
            <div>{rel}</div>
            <div>{abs}</div>
          </div>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Name</p>
          <p className="text-sm text-zinc-900 dark:text-white break-all">{token?.name || token?.contract_name || '—'}</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Holders */}
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
          <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-500" />
            <span className="text-xs uppercase tracking-widest font-semibold text-zinc-600 dark:text-zinc-300">Holders</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {holders.map((h) => {
                    const a = normalizeHex(h?.address);
                    const bal = Number(h?.balance || 0);
                    return (
                      <motion.tr
                        layout
                        key={`${a}-${bal}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4">
                          <Link to={`/accounts/${a}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                            {a}
                          </Link>
                        </td>
                        <td className="p-4 text-right">
                          <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                            {Number.isFinite(bal) ? bal : 0}
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
            <Pagination currentPage={holdersPage} onPageChange={setHoldersPage} hasNext={holdersHasNext} />
          </div>
        </div>

        {/* Transfers */}
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
          <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-zinc-500" />
            <span className="text-xs uppercase tracking-widest font-semibold text-zinc-600 dark:text-zinc-300">Recent Transfers</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Tx</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">From</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">To</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {transfers.map((t) => {
                    const tx = String(t?.transaction_hash || '');
                    const from = normalizeHex(t?.sender);
                    const to = normalizeHex(t?.receiver);
                    const amount = Number(t?.amount || 0);
                    return (
                      <motion.tr
                        layout
                        key={`${tx}-${from}-${to}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4">
                          <Link to={`/transactions/${normalizeHex(tx)}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                            {normalizeHex(tx).slice(0, 18)}...
                          </Link>
                        </td>
                        <td className="p-4">
                          {from ? (
                            <Link to={`/accounts/${from}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:underline">
                              {from.slice(0, 14)}...
                            </Link>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          {to ? (
                            <Link to={`/accounts/${to}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:underline">
                              {to.slice(0, 14)}...
                            </Link>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                            {Number.isFinite(amount) ? amount : 0}
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
            <Pagination currentPage={transfersPage} onPageChange={setTransfersPage} hasNext={transfersHasNext} />
          </div>
        </div>
      </div>
    </div>
  );
}

