import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Coins, Database } from 'lucide-react';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';
import { EVMBridgeBadge } from '../../components/ui/EVMBridgeBadge';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Ft } from '../../api/gen/find';
import { Pagination } from '../../components/Pagination';

interface TokensSearch {
  page?: number;
}

export const Route = createFileRoute('/tokens/')({
  component: Tokens,
  validateSearch: (search: Record<string, unknown>): TokensSearch => ({
    page: Number(search.page) || 1,
  }),
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: async ({ deps: { page } }) => {
    const limit = 25;
    const offset = (page - 1) * limit;
    try {
      await ensureHeyApiConfigured();
      const res = await getFlowV1Ft({ query: { limit, offset } });
      const payload: any = res.data;
      return { tokens: payload?.data || [], meta: payload?._meta || null, page };
    } catch (e) {
      console.error('Failed to load tokens', e);
      return { tokens: [], meta: null, page };
    }
  },
})

function TokenLogo({ logo, symbol }: { logo?: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (symbol || '?')[0].toUpperCase();

  if (logo && !failed) {
    return (
      <img
        src={logo}
        alt={symbol}
        width={32}
        height={32}
        className="w-8 h-8 object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-white/10 font-mono text-sm font-bold text-zinc-500 dark:text-zinc-400">
      {letter}
    </div>
  );
}

function Tokens() {
  const { tokens, meta, page } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  const limit = 25;
  const offset = (page - 1) * limit;

  const totalCount = Number(meta?.count || 0);
  const hasNext = totalCount > 0 ? offset + limit < totalCount : tokens.length === limit;

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const setPage = (newPage: number) => {
    navigate({ search: { page: newPage } });
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10">
            <Coins className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Tokens</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">Fungible Tokens (FT)</p>
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
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1 font-mono">Total Tokens</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={totalCount} format={{ useGrouping: true }} />
          </p>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1 font-mono">Indexed At Height</p>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-zinc-400" />
            <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
              <NumberFlow value={Number(meta?.height || 0)} format={{ useGrouping: true }} />
            </p>
          </div>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1 font-mono">Page</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={tokens.length} format={{ useGrouping: true }} />
            <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400 ml-2">
              of {totalCount.toLocaleString()}
            </span>
          </p>
        </div>
      </motion.div>

      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Token</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Address</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">Holders</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {tokens.map((t) => {
                  const id = String(t?.id || t?.token || '');
                  const addr = normalizeHex(t?.address);
                  const symbol = String(t?.symbol || '');
                  const name = String(t?.name || '');
                  const contractName = String(t?.contract_name || '');
                  const holderCount = Number(t?.holder_count || 0);
                  const logo = t?.logo || '';
                  const evmAddress = String(t?.evm_address || '');
                  const isVerified = Boolean(t?.is_verified);

                  return (
                    <motion.tr
                      layout
                      key={id || `${addr}-${symbol}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <TokenLogo logo={logo} symbol={symbol || contractName} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link
                                to={`/tokens/${encodeURIComponent(id)}`}
                                className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline truncate"
                                title={id}
                              >
                                {name && symbol ? (
                                  <>
                                    {name}
                                    <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">{symbol}</span>
                                  </>
                                ) : (
                                  symbol || contractName || id
                                )}
                              </Link>
                              {isVerified && <VerifiedBadge size={14} />}
                              {evmAddress && <EVMBridgeBadge evmAddress={evmAddress} />}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate" title={id}>
                              {contractName || id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        {addr ? (
                          <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                        ) : (
                          <span className="text-zinc-500 font-mono text-sm">N/A</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm text-zinc-900 dark:text-white">
                          {holderCount.toLocaleString()}
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
          <Pagination currentPage={page} onPageChange={setPage} hasNext={hasNext} />
        </div>
      </div>
    </div>
  );
}
