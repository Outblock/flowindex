import { createFileRoute, Link, useRouterState } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, Users, ArrowRightLeft, ArrowLeft, ExternalLink, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { EVMBridgeBadge } from '../../components/ui/EVMBridgeBadge';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
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
  loader: async ({ params, location }: any) => {
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

  const normalizeHex = (value: any) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const [showPaths, setShowPaths] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const id = String(token?.id || tokenParam);
  const addr = normalizeHex(token?.address);
  const symbol = String(token?.symbol || '');
  const decimals = Number(token?.decimals || 0);
  const tokenName = token?.name || token?.contract_name || id;

  const formatBalance = (raw: number | string) => {
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return '0';
    if (decimals <= 0) return num.toLocaleString();
    return num.toLocaleString(undefined, { minimumFractionDigits: Math.min(decimals, 4), maximumFractionDigits: Math.min(decimals, 8) });
  };

  const parseSocials = (): Record<string, string> => {
    if (!token?.socials) return {};
    try {
      if (typeof token.socials === 'string') return JSON.parse(token.socials);
      if (typeof token.socials === 'object') return token.socials as Record<string, string>;
    } catch { /* ignore */ }
    return {};
  };
  const socials = parseSocials();

  const sp = new URLSearchParams(location?.search as string ?? '');
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
      <button onClick={() => window.history.back()} className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors group">
        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
        <span className="text-xs uppercase tracking-widest">Back</span>
      </button>
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
          {token?.logo && !logoError ? (
            <img
              src={token.logo}
              alt={tokenName}
              className="h-10 w-10 rounded-full object-cover bg-zinc-100 dark:bg-white/10"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="p-3 bg-nothing-green/10 rounded-lg">
              <Coins className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white tracking-tighter">
                {tokenName}
              </h1>
              {symbol && (
                <span className="text-lg text-zinc-400 dark:text-zinc-500 font-mono">
                  {symbol}
                </span>
              )}
              {token?.evm_address && <EVMBridgeBadge evmAddress={String(token.evm_address)} />}
            </div>
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
        className="space-y-6"
      >
        {/* Info table */}
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm shadow-sm dark:shadow-none overflow-hidden">
          <div className="grid grid-cols-[auto_1fr] text-sm">
            <div className="px-4 py-3 text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest border-b border-zinc-100 dark:border-white/5">Contract</div>
            <div className="px-4 py-3 font-mono text-zinc-900 dark:text-white break-all border-b border-zinc-100 dark:border-white/5 flex items-center gap-1">
              {addr ? <AddressLink address={addr} prefixLen={20} suffixLen={0} /> : 'N/A'}
              {addr && <CopyButton content={addr} variant="ghost" size="xs" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" />}
            </div>
            {token?.evm_address && (<>
              <div className="px-4 py-3 text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest border-b border-zinc-100 dark:border-white/5">EVM Address</div>
              <div className="px-4 py-3 font-mono text-zinc-900 dark:text-white break-all border-b border-zinc-100 dark:border-white/5 flex items-center gap-1">
                {String(token.evm_address).slice(0, 10)}...{String(token.evm_address).slice(-8)}
                <CopyButton content={String(token.evm_address)} variant="ghost" size="xs" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" />
              </div>
            </>)}
            <div className="px-4 py-3 text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest border-b border-zinc-100 dark:border-white/5">Holders</div>
            <div className="px-4 py-3 font-mono font-bold text-zinc-900 dark:text-white border-b border-zinc-100 dark:border-white/5">
              <SafeNumberFlow value={Number.isFinite(holdersCount) ? holdersCount : 0} format={{ useGrouping: true }} />
              <span className="ml-2 text-[10px] font-normal text-amber-500 dark:text-amber-400">May be inaccurate during indexing</span>
            </div>
            {token?.total_supply != null && (<>
              <div className="px-4 py-3 text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest border-b border-zinc-100 dark:border-white/5">Total Supply</div>
              <div className="px-4 py-3 font-mono font-bold text-zinc-900 dark:text-white border-b border-zinc-100 dark:border-white/5">{formatBalance(token.total_supply)}</div>
            </>)}
            <div className="px-4 py-3 text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Decimals</div>
            <div className="px-4 py-3 font-mono font-bold text-zinc-900 dark:text-white">{decimals}</div>
          </div>
        </div>

        {/* Description + External URL + Socials */}
        {(token?.description || token?.external_url || Object.keys(socials).length > 0) && (
          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none space-y-3">
            {token?.description && (
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{token.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {token?.external_url && (
                <a
                  href={token.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-nothing-green-dark dark:text-nothing-green hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {(() => { try { return new URL(token.external_url).hostname; } catch { return token.external_url; } })()}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {Object.entries(socials).map(([platform, url]) => (
                <a
                  key={platform}
                  href={String(url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors capitalize"
                >
                  {platform}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Vault / Receiver / Balance paths (collapsible) */}
        {(token?.vault_path || token?.receiver_path || token?.balance_path) && (
          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm shadow-sm dark:shadow-none overflow-hidden">
            <button
              onClick={() => setShowPaths(!showPaths)}
              className="w-full p-4 flex items-center justify-between text-xs uppercase tracking-widest font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
            >
              <span>Cadence Paths</span>
              {showPaths ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showPaths && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {token?.vault_path && (
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Vault Path</p>
                    <p className="text-xs font-mono text-zinc-900 dark:text-white break-all">{token.vault_path}</p>
                  </div>
                )}
                {token?.receiver_path && (
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Receiver Path</p>
                    <p className="text-xs font-mono text-zinc-900 dark:text-white break-all">{token.receiver_path}</p>
                  </div>
                )}
                {token?.balance_path && (
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Balance Path</p>
                    <p className="text-xs font-mono text-zinc-900 dark:text-white break-all">{token.balance_path}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider w-12">#</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {[...holdersState].sort((a: any, b: any) => Number(b?.balance || 0) - Number(a?.balance || 0)).map((h: any, idx: number) => {
                    const a = normalizeHex(h?.address);
                    const bal = Math.max(Number(h?.balance || 0), 0);
                    const rank = holdersOffset + idx + 1;
                    return (
                      <motion.tr
                        layout
                        key={`${a}-${bal}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4 text-xs text-zinc-400 dark:text-zinc-500 font-mono">{rank}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <AddressLink address={a} prefixLen={20} suffixLen={0} />
                            <CopyButton
                              content={a}
                              variant="ghost"
                              size="xs"
                              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded" title={String(bal)}>
                            {formatBalance(bal)}
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
                  {transfersState.map((t: any) => {
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
                            <Link to={`/txs/${normalizeHex(tx)}` as any} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
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
                              <AddressLink address={from} />
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
                              <AddressLink address={to} />
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
                          <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded" title={String(amount)}>
                            {formatBalance(amount)}
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
