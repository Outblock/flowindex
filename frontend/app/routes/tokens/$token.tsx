import { createFileRoute, Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, Users, ArrowRightLeft } from 'lucide-react';
import { CopyButton } from '../../../components/animate-ui/components/buttons/copy';
import { SafeNumberFlow } from '../../components/SafeNumberFlow';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1FtByToken, getFlowV1FtByTokenHolding, getFlowV1FtTransfer } from '../../api/gen/find';
import { Pagination } from '../../components/Pagination';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary';

interface TokenSearch {
  holdersPage?: number;
  transfersPage?: number;
}

export const Route = createFileRoute('/tokens/$token')({
  component: TokenDetail,
  loader: async ({ params, location }) => {
    const token = params.token;
    const sp = new URLSearchParams(location?.search ?? '');
    const holdersPage = Number(sp.get('holdersPage') || '1') || 1;
    const transfersPage = Number(sp.get('transfersPage') || '1') || 1;
    const holdersLimit = 25;
    const transfersLimit = 25;
    const holdersOffset = (holdersPage - 1) * holdersLimit;
    const transfersOffset = (transfersPage - 1) * transfersLimit;

    try {
      await ensureHeyApiConfigured();
      const [tokenRes, holdersRes, transfersRes] = await Promise.all([
        getFlowV1FtByToken({ path: { token } }),
        getFlowV1FtByTokenHolding({ path: { token }, query: { limit: holdersLimit, offset: holdersOffset } }),
        getFlowV1FtTransfer({ query: { limit: transfersLimit, offset: transfersOffset, token } }),
      ]);

      const tokenPayload: any = tokenRes?.data;
      const holdersPayload: any = holdersRes?.data;
      const transfersPayload: any = transfersRes?.data;
      const tokenRow = (tokenPayload?.data && tokenPayload.data[0]) || null;
      return {
        token: tokenRow,
        holders: holdersPayload?.data || [],
        holdersMeta: holdersPayload?._meta || null,
        transfers: transfersPayload?.data || [],
        transfersMeta: transfersPayload?._meta || null,
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
  return (
    <RouteErrorBoundary title="Token Page Error">
      <TokenDetailInner />
    </RouteErrorBoundary>
  );
}

function TokenDetailInner() {
  const { token, holders, holdersMeta, transfers, transfersMeta, tokenParam, holdersPage, transfersPage } =
    Route.useLoaderData();
  const navigate = Route.useNavigate();
  const location = useRouterState({ select: (s) => s.location });

  const [holdersState, setHoldersState] = useState(holders);
  const [holdersMetaState, setHoldersMetaState] = useState(holdersMeta);
  const [transfersState, setTransfersState] = useState(transfers);
  const [transfersMetaState, setTransfersMetaState] = useState(transfersMeta);
  const [isLoading, setIsLoading] = useState(false);
  const lastKeyRef = useRef<string>('');

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const id = String(token?.id || tokenParam);
  const addr = normalizeHex(token?.address);
  const symbol = String(token?.symbol || '');
  // decimals/updatedAt are not very meaningful for most users; we prioritize holder count instead.

  const sp = new URLSearchParams(location?.search ?? '');
  const holdersPageFromUrl = Number(sp.get('holdersPage') || holdersPage || 1) || 1;
  const transfersPageFromUrl = Number(sp.get('transfersPage') || transfersPage || 1) || 1;

  const holdersLimit = 25;
  const holdersOffset = (holdersPageFromUrl - 1) * holdersLimit;
  const holdersCount = Number(holdersMetaState?.count || 0);
  const holdersHasNext =
    holdersCount > 0 ? holdersOffset + holdersLimit < holdersCount : holdersState.length === holdersLimit;

  const transfersLimit = 25;
  const transfersOffset = (transfersPageFromUrl - 1) * transfersLimit;
  const transfersCount = Number(transfersMetaState?.count || 0);
  const transfersHasNext =
    transfersCount > 0 ? transfersOffset + transfersLimit < transfersCount : transfersState.length === transfersLimit;

  const setHoldersPage = (newPage: number) => {
    navigate({ search: { holdersPage: newPage, transfersPage: transfersPageFromUrl } });
  };

  const setTransfersPage = (newPage: number) => {
    navigate({ search: { holdersPage: holdersPageFromUrl, transfersPage: newPage } });
  };

  useEffect(() => {
    setHoldersState(holders);
    setHoldersMetaState(holdersMeta);
    setTransfersState(transfers);
    setTransfersMetaState(transfersMeta);
  }, [holders, holdersMeta, transfers, transfersMeta, tokenParam]);

  useEffect(() => {
    const key = `${tokenParam}|${holdersPageFromUrl}|${transfersPageFromUrl}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    let cancelled = false;
    const fetchPage = async () => {
      try {
        setIsLoading(true);
        await ensureHeyApiConfigured();
        const [holdersRes, transfersRes] = await Promise.all([
          getFlowV1FtByTokenHolding({ path: { token: tokenParam }, query: { limit: holdersLimit, offset: holdersOffset } }),
          getFlowV1FtTransfer({ query: { limit: transfersLimit, offset: transfersOffset, token: tokenParam } }),
        ]);
        if (cancelled) return;
        setHoldersState(holdersRes?.data?.data || []);
        setHoldersMetaState(holdersRes?.data?._meta || null);
        setTransfersState(transfersRes?.data?.data || []);
        setTransfersMetaState(transfersRes?.data?._meta || null);
      } catch (e) {
        console.error('Failed to refresh token data', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchPage();
    return () => {
      cancelled = true;
    };
  }, [tokenParam, holdersPageFromUrl, transfersPageFromUrl]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {isLoading && (
        <div className="text-xs uppercase tracking-widest text-nothing-green-dark dark:text-nothing-green">
          Loading...
        </div>
      )}
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
            <div className="flex items-center gap-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono break-all">{id}</p>
              <CopyButton
                content={id}
                variant="ghost"
                size="xs"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              />
            </div>
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
            {addr && (
              <CopyButton
                content={addr}
                variant="ghost"
                size="xs"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 ml-1"
              />
            )}
          </p>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Holders</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <SafeNumberFlow value={Number.isFinite(holdersCount) ? holdersCount : 0} format={{ useGrouping: true }} />
          </p>
          <div className="mt-2 text-[10px] uppercase tracking-widest text-zinc-500">
            Page size: {holdersState.length}
          </div>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Name / Symbol</p>
          <p className="text-sm text-zinc-900 dark:text-white break-all">
            {token?.name || token?.contract_name || id}
          </p>
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {symbol || '—'}
          </div>
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
                  {holdersState.map((h) => {
                    const a = normalizeHex(h?.address);
                    const bal = Math.max(Number(h?.balance || 0), 0);
                    return (
                      <motion.tr
                        layout
                        key={`${a}-${bal}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Link to={`/accounts/${a}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                              {a}
                            </Link>
                            <CopyButton
                              content={a}
                              variant="ghost"
                              size="xs"
                              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                          </div>
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
            <Pagination currentPage={holdersPageFromUrl} onPageChange={setHoldersPage} hasNext={holdersHasNext} />
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
                  {transfersState.map((t) => {
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
                          <div className="flex items-center gap-2">
                            <Link to={`/transactions/${normalizeHex(tx)}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                              {normalizeHex(tx).slice(0, 18)}...
                            </Link>
                            <CopyButton
                              content={normalizeHex(tx)}
                              variant="ghost"
                              size="xs"
                              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                          </div>
                        </td>
                        <td className="p-4">
                          {from ? (
                            <div className="flex items-center gap-2">
                              <Link to={`/accounts/${from}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:underline">
                                {from.slice(0, 14)}...
                              </Link>
                              <CopyButton
                                content={from}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                              />
                            </div>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          {to ? (
                            <div className="flex items-center gap-2">
                              <Link to={`/accounts/${to}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:underline">
                                {to.slice(0, 14)}...
                              </Link>
                              <CopyButton
                                content={to}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                              />
                            </div>
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
            <Pagination currentPage={transfersPageFromUrl} onPageChange={setTransfersPage} hasNext={transfersHasNext} />
          </div>
        </div>
      </div>
    </div>
  );
}
