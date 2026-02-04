import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, User, Activity, Wallet, Key, Code, Coins, Image as ImageIcon, FileText } from 'lucide-react';
import { Pagination } from '../components/Pagination';
import NumberFlow from '@number-flow/react';

function AccountDetail() {
  const { address } = useParams();
  const [account, setAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('info');
  const [activityTab, setActivityTab] = useState('transactions');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [txLoading, setTxLoading] = useState(false);
  const [txCursors, setTxCursors] = useState({ 1: '' });
  const [txHasNext, setTxHasNext] = useState(false);
  const [tokenTransfers, setTokenTransfers] = useState([]);
  const [tokenCursor, setTokenCursor] = useState('');
  const [tokenHasMore, setTokenHasMore] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [nftTransfers, setNftTransfers] = useState([]);
  const [nftCursor, setNftCursor] = useState('');
  const [nftHasMore, setNftHasMore] = useState(false);
  const [nftLoading, setNftLoading] = useState(false);

  useEffect(() => {
    const loadAccountInfo = async () => {
      try {
        const accountRes = await api.getAccount(address);
        setAccount({
          address: accountRes.address,
          balance: accountRes.balance,
          createdAt: null,
          contracts: accountRes.contracts || [],
          keys: accountRes.keys || []
        });
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch account:', err);
        setError('Account not found');
        setLoading(false);
      }
    };
    loadAccountInfo();
  }, [address]);

  const loadTransactions = async (page) => {
    setTxLoading(true);
    try {
      const cursor = txCursors[page] ?? '';
      const txRes = await api.getAccountTransactions(address, cursor, 20);
      const items = txRes?.items ?? (Array.isArray(txRes) ? txRes : []);
      const nextCursor = txRes?.next_cursor ?? '';
      const accountTxs = (items || [])
        .map(tx => ({
          ...tx,
          type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
          payer: tx.payer_address || tx.proposer_address,
          proposer: tx.proposer_address,
          blockHeight: tx.block_height
        }));
      setTransactions(accountTxs);
      setTxHasNext(Boolean(nextCursor));
      if (nextCursor) {
        setTxCursors(prev => ({ ...prev, [page + 1]: nextCursor }));
      }
    } catch (err) {
      console.error("Failed to load transactions", err);
    } finally {
      setTxLoading(false);
    }
  };

  const loadTokenTransfers = async (cursorValue, append) => {
    setTokenLoading(true);
    try {
      const tokenRes = await api.getAccountTokenTransfers(address, cursorValue, 20);
      const items = tokenRes?.items ?? tokenRes ?? [];
      const nextCursor = tokenRes?.next_cursor ?? '';
      setTokenTransfers(prev => (append ? [...prev, ...items] : items));
      setTokenCursor(nextCursor || '');
      setTokenHasMore(Boolean(nextCursor));
    } catch (err) {
      console.error('Failed to load token transfers', err);
    } finally {
      setTokenLoading(false);
    }
  };

  const loadNFTTransfers = async (cursorValue, append) => {
    setNftLoading(true);
    try {
      const nftRes = await api.getAccountNFTTransfers(address, cursorValue, 20);
      const items = nftRes?.items ?? nftRes ?? [];
      const nextCursor = nftRes?.next_cursor ?? '';
      setNftTransfers(prev => (append ? [...prev, ...items] : items));
      setNftCursor(nextCursor || '');
      setNftHasMore(Boolean(nextCursor));
    } catch (err) {
      console.error('Failed to load NFT transfers', err);
    } finally {
      setNftLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  useEffect(() => {
    setCurrentPage(1);
    setTxCursors({ 1: '' });
    setTxHasNext(false);
    if (currentPage === 1) {
      loadTransactions(1);
    }
    setTokenTransfers([]);
    setTokenCursor('');
    setTokenHasMore(false);
    setNftTransfers([]);
    setNftCursor('');
    setNftHasMore(false);
  }, [address]);

  useEffect(() => {
    if (activityTab === 'tokens' && tokenTransfers.length === 0 && !tokenLoading) {
      loadTokenTransfers('', false);
    }
    if (activityTab === 'nfts' && nftTransfers.length === 0 && !nftLoading) {
      loadNFTTransfers('', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityTab, address]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const formatShort = (value, size = 10) => {
    if (!value) return 'N/A';
    if (value.length <= size + 3) return value;
    return `${value.slice(0, size)}...`;
  };



  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-800 border-t-nothing-green rounded-full animate-spin"></div>
          <p className="text-nothing-green text-xs uppercase tracking-[0.2em] animate-pulse">Retrieving Account...</p>
        </div>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="border border-red-500/30 bg-nothing-dark p-8 max-w-md text-center">
          <User className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white uppercase tracking-widest mb-2">Account Not Found</h2>
          <p className="text-zinc-500 text-xs mb-6">The requested account could not be located.</p>
          <Link to="/" className="inline-block w-full border border-white/20 hover:bg-white/10 text-white text-xs uppercase tracking-widest py-3 transition-all">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-mono selection:bg-nothing-green selection:text-black">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Back Button */}
        <Link to="/" className="inline-flex items-center space-x-2 text-zinc-500 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs uppercase tracking-widest">Return to Dashboard</span>
        </Link>

        {/* Header */}
        <div className="border border-white/10 p-8 mb-8 relative overflow-hidden bg-nothing-dark">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Wallet className="h-32 w-32" />
          </div>

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                  Account
                </span>
              </div>

              <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 break-all">
                {account.address}
              </h1>
            </div>
          </div>
        </div>

        {/* Account Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="border border-white/10 p-6 bg-nothing-dark hover:border-nothing-green/50 transition-colors">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Balance</p>
            <p className="text-2xl font-bold text-white overflow-hidden text-ellipsis flex items-center gap-2">
              <NumberFlow
                value={account.balance || 0}
                format={{ minimumFractionDigits: 0, maximumFractionDigits: 4 }}
              />
              <span className="text-sm text-nothing-green">FLOW</span>
            </p>
          </div>
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Transactions</p>
            <p className="text-2xl font-bold text-white">{transactions.length >= 10 ? '10+' : transactions.length}</p>
          </div>
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Contracts</p>
            <p className="text-2xl font-bold text-white">{account.contracts?.length || 0}</p>
          </div>
        </div>

        {/* Tabs for Account Info & Keys */}
        <div className="mb-8">
          <div className="flex border-b border-white/10 mb-0">
            <button
              onClick={() => setActiveTab('info')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'info'
                ? 'text-white border-b-2 border-nothing-green bg-white/5'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <User className={`h-4 w-4 ${activeTab === 'info' ? 'text-nothing-green' : ''}`} />
                Account Info
              </span>
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'keys'
                ? 'text-white border-b-2 border-nothing-green bg-white/5'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <Key className={`h-4 w-4 ${activeTab === 'keys' ? 'text-nothing-green' : ''}`} />
                Public Keys
              </span>
            </button>
            <button
              onClick={() => setActiveTab('contracts')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'contracts'
                ? 'text-white border-b-2 border-nothing-green bg-white/5'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <FileText className={`h-4 w-4 ${activeTab === 'contracts' ? 'text-nothing-green' : ''}`} />
                Contracts ({account.contracts ? account.contracts.length : 0})
              </span>
            </button>
          </div>

          <div className="bg-nothing-dark border border-white/10 border-t-0 p-6 min-h-[200px]">
            {activeTab === 'info' && (
              <div className="space-y-4">
                <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
                  Account Overview
                </h2>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Address</p>
                  <p className="text-sm text-white font-mono">{account.address}</p>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Created At</p>
                  <p className="text-sm text-white font-mono">
                    {account.createdAt ? new Date(account.createdAt).toLocaleString() : 'N/A'}
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'keys' && (
              <div className="space-y-4">
                <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
                  Associated Public Keys
                </h2>
                {account.keys && account.keys.length > 0 ? (
                  <div className="space-y-2">
                    {account.keys.map((key, idx) => (
                      <div key={idx} className="bg-black/50 border border-white/5 p-4 group">
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between">
                            <span className="text-[10px] text-zinc-500 uppercase">Index #{key.keyIndex ?? idx}</span>
                            <span className="text-[10px] text-zinc-500 uppercase">Algorithm: {key.signingAlgorithm}</span>
                          </div>
                          <code className="text-xs text-zinc-400 break-all font-mono">{key.publicKey}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">No keys found</p>
                )}
              </div>
            )}

            {activeTab === 'contracts' && (
              <div className="space-y-4">
                <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
                  Deployed Contracts
                </h2>
                {account.contracts && account.contracts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {account.contracts.map((contract, idx) => (
                      <div key={idx} className="bg-black/50 border border-white/5 p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Code className="h-4 w-4 text-nothing-green" />
                          <span className="text-sm text-white font-mono">{contract.name || contract}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">No contracts deployed</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Activity */}
        <div className="border border-white/10 bg-nothing-dark">
          <div className="p-6 border-b border-white/10 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-white text-sm uppercase tracking-widest">Activity</h2>
              {activityTab === 'transactions' && (
                <span className="text-xs text-zinc-500">{transactions.length} Found (Page {currentPage})</span>
              )}
              {activityTab === 'tokens' && (
                <span className="text-xs text-zinc-500">{tokenTransfers.length} Found</span>
              )}
              {activityTab === 'nfts' && (
                <span className="text-xs text-zinc-500">{nftTransfers.length} Found</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActivityTab('transactions')}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors ${activityTab === 'transactions'
                  ? 'border-nothing-green text-white bg-white/5'
                  : 'border-white/10 text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Activity className={`h-3 w-3 ${activityTab === 'transactions' ? 'text-nothing-green' : ''}`} />
                  Transactions
                </span>
              </button>
              <button
                onClick={() => setActivityTab('tokens')}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors ${activityTab === 'tokens'
                  ? 'border-nothing-green text-white bg-white/5'
                  : 'border-white/10 text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Coins className={`h-3 w-3 ${activityTab === 'tokens' ? 'text-nothing-green' : ''}`} />
                  Tokens
                </span>
              </button>
              <button
                onClick={() => setActivityTab('nfts')}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors ${activityTab === 'nfts'
                  ? 'border-nothing-green text-white bg-white/5'
                  : 'border-white/10 text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <ImageIcon className={`h-3 w-3 ${activityTab === 'nfts' ? 'text-nothing-green' : ''}`} />
                  NFTs
                </span>
              </button>
            </div>
          </div>

          {activityTab === 'transactions' && (
            <>
              <div className="overflow-x-auto min-h-[200px] relative">
                {txLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-dashed border-white rounded-full animate-spin"></div>
                  </div>
                )}

                {transactions.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-zinc-500 uppercase tracking-wider">
                        <th className="p-4 font-normal">Tx Hash</th>
                        <th className="p-4 font-normal">Type</th>
                        <th className="p-4 font-normal">Role</th>
                        <th className="p-4 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {transactions.map((tx) => {
                        const role = tx.payer === address ? 'Payer' :
                          tx.proposer === address ? 'Proposer' : 'Authorizer';
                        return (
                          <tr key={tx.id} className="hover:bg-white/5 transition-colors group">
                            <td className="p-4">
                              <Link to={`/transactions/${tx.id}`} className="text-nothing-green hover:underline font-mono">
                                {tx.id.slice(0, 16)}...
                              </Link>
                            </td>
                            <td className="p-4">
                              <span className="border border-white/10 px-2 py-1 rounded-sm text-zinc-300 text-[10px] uppercase">
                                {tx.type}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className="text-[10px] uppercase text-zinc-500">{role}</span>
                            </td>
                            <td className="p-4">
                              <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-400' : 'text-yellow-500'}`}>
                                {tx.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  !txLoading && <div className="p-8 text-center text-zinc-500 italic">No transactions found</div>
                )}
              </div>

              <Pagination
                currentPage={currentPage}
                onPageChange={handlePageChange}
                hasNext={txHasNext}
              />
            </>
          )}

          {activityTab === 'tokens' && (
            <>
              <div className="overflow-x-auto min-h-[200px] relative">
                {tokenLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-dashed border-white rounded-full animate-spin"></div>
                  </div>
                )}

                {tokenTransfers.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-zinc-500 uppercase tracking-wider">
                        <th className="p-4 font-normal">Tx Hash</th>
                        <th className="p-4 font-normal">Block</th>
                        <th className="p-4 font-normal">Contract</th>
                        <th className="p-4 font-normal">From</th>
                        <th className="p-4 font-normal">To</th>
                        <th className="p-4 font-normal">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tokenTransfers.map((tt) => (
                        <tr key={`${tt.transaction_id}-${tt.event_index}`} className="hover:bg-white/5 transition-colors group">
                          <td className="p-4">
                            <Link to={`/transactions/${tt.transaction_id}`} className="text-nothing-green hover:underline font-mono">
                              {formatShort(tt.transaction_id, 16)}
                            </Link>
                          </td>
                          <td className="p-4">
                            <Link to={`/blocks/${tt.block_height}`} className="text-zinc-300 hover:text-white">
                              {tt.block_height}
                            </Link>
                          </td>
                          <td className="p-4 font-mono text-zinc-300">
                            {formatShort(tt.token_contract_address, 12)}
                          </td>
                          <td className="p-4">
                            {tt.from_address ? (
                              <Link to={`/accounts/${tt.from_address}`} className="text-zinc-300 hover:text-white font-mono">
                                {formatShort(tt.from_address, 10)}
                              </Link>
                            ) : (
                              <span className="text-zinc-600">N/A</span>
                            )}
                          </td>
                          <td className="p-4">
                            {tt.to_address ? (
                              <Link to={`/accounts/${tt.to_address}`} className="text-zinc-300 hover:text-white font-mono">
                                {formatShort(tt.to_address, 10)}
                              </Link>
                            ) : (
                              <span className="text-zinc-600">N/A</span>
                            )}
                          </td>
                          <td className="p-4 text-zinc-300">{tt.amount || '0'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !tokenLoading && <div className="p-8 text-center text-zinc-500 italic">No token transfers found</div>
                )}
              </div>

              <div className="p-6 border-t border-white/10 flex justify-center">
                <button
                  onClick={() => loadTokenTransfers(tokenCursor, true)}
                  disabled={!tokenHasMore || tokenLoading}
                  className="px-6 py-2 border border-white/10 bg-black/40 text-xs uppercase tracking-widest hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {tokenHasMore ? 'Load More' : 'No More Results'}
                </button>
              </div>
            </>
          )}

          {activityTab === 'nfts' && (
            <>
              <div className="overflow-x-auto min-h-[200px] relative">
                {nftLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-dashed border-white rounded-full animate-spin"></div>
                  </div>
                )}

                {nftTransfers.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-zinc-500 uppercase tracking-wider">
                        <th className="p-4 font-normal">Tx Hash</th>
                        <th className="p-4 font-normal">Block</th>
                        <th className="p-4 font-normal">Contract</th>
                        <th className="p-4 font-normal">From</th>
                        <th className="p-4 font-normal">To</th>
                        <th className="p-4 font-normal">Token ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {nftTransfers.map((tt) => (
                        <tr key={`${tt.transaction_id}-${tt.event_index}`} className="hover:bg-white/5 transition-colors group">
                          <td className="p-4">
                            <Link to={`/transactions/${tt.transaction_id}`} className="text-nothing-green hover:underline font-mono">
                              {formatShort(tt.transaction_id, 16)}
                            </Link>
                          </td>
                          <td className="p-4">
                            <Link to={`/blocks/${tt.block_height}`} className="text-zinc-300 hover:text-white">
                              {tt.block_height}
                            </Link>
                          </td>
                          <td className="p-4 font-mono text-zinc-300">
                            {formatShort(tt.token_contract_address, 12)}
                          </td>
                          <td className="p-4">
                            {tt.from_address ? (
                              <Link to={`/accounts/${tt.from_address}`} className="text-zinc-300 hover:text-white font-mono">
                                {formatShort(tt.from_address, 10)}
                              </Link>
                            ) : (
                              <span className="text-zinc-600">N/A</span>
                            )}
                          </td>
                          <td className="p-4">
                            {tt.to_address ? (
                              <Link to={`/accounts/${tt.to_address}`} className="text-zinc-300 hover:text-white font-mono">
                                {formatShort(tt.to_address, 10)}
                              </Link>
                            ) : (
                              <span className="text-zinc-600">N/A</span>
                            )}
                          </td>
                          <td className="p-4 text-zinc-300 font-mono">{tt.nft_id || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !nftLoading && <div className="p-8 text-center text-zinc-500 italic">No NFT transfers found</div>
                )}
              </div>

              <div className="p-6 border-t border-white/10 flex justify-center">
                <button
                  onClick={() => loadNFTTransfers(nftCursor, true)}
                  disabled={!nftHasMore || nftLoading}
                  className="px-6 py-2 border border-white/10 bg-black/40 text-xs uppercase tracking-widest hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {nftHasMore ? 'Load More' : 'No More Results'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AccountDetail;
