import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, Users, ArrowRightLeft } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../../api';
import { Pagination } from '../../components/Pagination';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary';

interface CollectionSearch {
  ownersPage?: number;
  transfersPage?: number;
}

export const Route = createFileRoute('/nfts/$nftType')({
  component: NFTCollectionDetail,
  // See note in /tokens/$token about SSR + validateSearch.
  loader: async ({ params, location }) => {
    const nftType = params.nftType;
    const sp = new URLSearchParams(location.search);
    const ownersPage = Number(sp.get('ownersPage') || '1') || 1;
    const transfersPage = Number(sp.get('transfersPage') || '1') || 1;
    const ownersLimit = 25;
    const transfersLimit = 25;
    const ownersOffset = (ownersPage - 1) * ownersLimit;
    const transfersOffset = (transfersPage - 1) * transfersLimit;

    try {
      const [collectionRes, ownersRes, transfersRes] = await Promise.all([
        api.getFlowNFTCollection(nftType),
        api.listFlowNFTHoldingsByCollection(nftType, ownersLimit, ownersOffset),
        api.listFlowNFTTransfers(transfersLimit, transfersOffset, { nft_type: nftType }),
      ]);
      const row = (collectionRes?.data && collectionRes.data[0]) || null;
      return {
        collection: row,
        owners: ownersRes?.data || [],
        ownersMeta: ownersRes?._meta || null,
        transfers: transfersRes?.data || [],
        transfersMeta: transfersRes?._meta || null,
        nftType,
        ownersPage,
        transfersPage,
      };
    } catch (e) {
      console.error('Failed to load NFT collection', e);
      return {
        collection: null,
        owners: [],
        ownersMeta: null,
        transfers: [],
        transfersMeta: null,
        nftType,
        ownersPage,
        transfersPage,
      };
    }
  },
})

function NFTCollectionDetail() {
  return (
    <RouteErrorBoundary title="NFT Page Error">
      <NFTCollectionDetailInner />
    </RouteErrorBoundary>
  );
}

function NFTCollectionDetailInner() {
  const { collection, owners, ownersMeta, transfers, transfersMeta, nftType, ownersPage, transfersPage } =
    Route.useLoaderData();
  const navigate = Route.useNavigate();

  const [itemId, setItemId] = useState('');

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const id = String(collection?.id || nftType);
  const addr = normalizeHex(collection?.address);
  const tokenCount = Number(collection?.number_of_tokens || 0);
  const ownerCount = Number(collection?.owner_count || ownersMeta?.count || 0);

  const ownersLimit = 25;
  const ownersOffset = (ownersPage - 1) * ownersLimit;
  const ownersCount = Number(ownersMeta?.count || 0);
  const ownersHasNext = ownersCount > 0 ? ownersOffset + ownersLimit < ownersCount : owners.length === ownersLimit;

  const transfersLimit = 25;
  const transfersOffset = (transfersPage - 1) * transfersLimit;
  const transfersCount = Number(transfersMeta?.count || 0);
  const transfersHasNext = transfersCount > 0 ? transfersOffset + transfersLimit < transfersCount : transfers.length === transfersLimit;

  const setOwnersPage = (newPage: number) => {
    navigate({ search: { ownersPage: newPage, transfersPage } });
  };
  const setTransfersPage = (newPage: number) => {
    navigate({ search: { ownersPage, transfersPage: newPage } });
  };

  const itemLink = useMemo(() => {
    const trimmed = String(itemId || '').trim();
    if (!trimmed) return '';
    return `/nfts/${encodeURIComponent(id)}/item/${encodeURIComponent(trimmed)}`;
  }, [id, itemId]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10 rounded-lg">
            <Image className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">
              NFT Collection
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
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Holders</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={Number.isFinite(ownersCount) ? ownersCount : 0} format={{ useGrouping: true }} />
          </p>
          <div className="mt-2 text-[10px] uppercase tracking-widest text-zinc-500">
            Page size: {owners.length}
          </div>
        </div>
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
          <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Tokens</p>
          <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
            <NumberFlow value={Number.isFinite(tokenCount) ? tokenCount : 0} format={{ useGrouping: true }} />
          </p>
          {Number.isFinite(ownerCount) && ownerCount > 0 ? (
            <div className="mt-2 text-[10px] uppercase tracking-widest text-zinc-500">
              Owners (Approx): {ownerCount.toLocaleString()}
            </div>
          ) : null}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 rounded-sm shadow-sm dark:shadow-none flex flex-col md:flex-row items-start md:items-center gap-3"
      >
        <div className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">Jump To Item</div>
        <input
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          placeholder="NFT id (token_id)"
          className="flex-1 bg-transparent border border-zinc-200 dark:border-white/10 px-3 py-2 rounded-sm text-sm font-mono text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-nothing-green/30"
        />
        <Link
          to={itemLink || '#'}
          onClick={(e) => {
            if (!itemLink) e.preventDefault();
          }}
          className={`px-4 py-2 border border-zinc-200 dark:border-white/10 rounded-sm text-xs uppercase tracking-widest font-semibold transition-colors ${
            itemLink ? 'bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200' : 'opacity-40 cursor-not-allowed'
          }`}
        >
          Open
        </Link>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
          <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-500" />
            <span className="text-xs uppercase tracking-widest font-semibold text-zinc-600 dark:text-zinc-300">Owners</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {owners.map((o) => {
                    // API returns `owner` (not `address`) for NFT holdings.
                    // Keep backward-compat with any older shape that used `address`.
                    const a = normalizeHex(o?.owner || o?.address);
                    const count = Number(o?.count || 0);
                    return (
                      <motion.tr
                        layout
                        key={`${a}-${count}`}
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
                            {Number.isFinite(count) ? count : 0}
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
            <Pagination currentPage={ownersPage} onPageChange={setOwnersPage} hasNext={ownersHasNext} />
          </div>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
          <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-zinc-500" />
            <span className="text-xs uppercase tracking-widest font-semibold text-zinc-600 dark:text-zinc-300">Recent Transfers</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Item</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">From</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">To</th>
                  <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Tx</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {transfers.map((t) => {
                    const tx = String(t?.transaction_hash || '');
                    const from = normalizeHex(t?.sender);
                    const to = normalizeHex(t?.receiver);
                    const nftId = String(t?.nft_id || '');
                    return (
                      <motion.tr
                        layout
                        key={`${tx}-${nftId}-${from}-${to}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="p-4">
                          {nftId ? (
                            <Link
                              to={`/nfts/${encodeURIComponent(id)}/item/${encodeURIComponent(nftId)}`}
                              className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                            >
                              {nftId}
                            </Link>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
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
                        <td className="p-4">
                          {tx ? (
                            <Link to={`/transactions/${normalizeHex(tx)}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                              {normalizeHex(tx).slice(0, 18)}...
                            </Link>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
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
