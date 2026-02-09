import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Pagination } from '../components/Pagination';
import NumberFlow from '@number-flow/react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  ArrowLeft, User, Activity, Wallet, Key, Code, Coins, Image as ImageIcon,
  FileText, HardDrive, Folder, FolderOpen, File, ChevronRight, ChevronDown
} from 'lucide-react';

SyntaxHighlighter.registerLanguage('cadence', swift);

function AccountDetail() {
  const { address } = useParams();
  const [account, setAccount] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('info');
  const [activityTab, setActivityTab] = useState('transactions');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [txLoading, setTxLoading] = useState(false);
  const [txCursors, setTxCursors] = useState({ 1: '' });
  const [txHasNext, setTxHasNext] = useState(false);
  const [tokenTransfers, setTokenTransfers] = useState<any[]>([]);
  const [tokenCursor, setTokenCursor] = useState('');
  const [tokenHasMore, setTokenHasMore] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [nftTransfers, setNftTransfers] = useState<any[]>([]);
  const [nftCursor, setNftCursor] = useState('');
  const [nftHasMore, setNftHasMore] = useState(false);
  const [nftLoading, setNftLoading] = useState(false);

  // Contract code viewer
  const [selectedContract, setSelectedContract] = useState('');
  const [selectedContractCode, setSelectedContractCode] = useState('');
  const [contractCodeLoading, setContractCodeLoading] = useState(false);
  const [contractCodeError, setContractCodeError] = useState<any>(null);

  // Storage viewer (JSON-CDC via FlowView-compatible scripts)
  const [storageOverview, setStorageOverview] = useState<any>(null);
  const [storageSelected, setStorageSelected] = useState<any>(null);
  const [storageItem, setStorageItem] = useState<any>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<any>(null);
  const [expandedDomains, setExpandedDomains] = useState({ storage: true, public: true, private: false });

  const normalizeAddress = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const formatShort = (value, head = 8, tail = 6) => {
    if (!value) return 'N/A';
    const normalized = normalizeAddress(value);
    if (normalized.length <= head + tail + 3) return normalized;
    return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
  };

  // Decode JSON-CDC (Cadence JSON) to plain JS values for display.
  const decodeCadenceValue = (val) => {
    if (!val || typeof val !== 'object') return val;

    if (val.value !== undefined) {
      if (val.type === 'Optional') return val.value ? decodeCadenceValue(val.value) : null;
      if (val.type === 'Array') return Array.isArray(val.value) ? val.value.map(decodeCadenceValue) : [];
      if (val.type === 'Dictionary') {
        const dict = {};
        (val.value || []).forEach((item) => {
          const k = decodeCadenceValue(item.key);
          const v = decodeCadenceValue(item.value);
          dict[String(k)] = v;
        });
        return dict;
      }
      if (val.type === 'Struct' || val.type === 'Resource' || val.type === 'Event') {
        const obj = {};
        if (val.value && Array.isArray(val.value.fields)) {
          val.value.fields.forEach((f) => {
            obj[f.name] = decodeCadenceValue(f.value);
          });
          return obj;
        }
      }
      if (val.type === 'Path') {
        const domain = val.value?.domain ?? '';
        const identifier = val.value?.identifier ?? '';
        return domain && identifier ? `${domain}/${identifier}` : '';
      }
      if (val.type === 'Type') return val.value?.staticType ?? '';
      if (val.type === 'Address') return normalizeAddress(val.value);

      return val.value;
    }

    return val;
  };

  const normalizedAddress = normalizeAddress(address);

  useEffect(() => {
    // Reset per-address UI state
    setSelectedContract('');
    setSelectedContractCode('');
    setContractCodeError(null);
    setStorageOverview(null);
    setStorageSelected(null);
    setStorageItem(null);
    setStorageError(null);

    const loadAccountInfo = async () => {
      try {
        const accountRes = await api.getAccount(normalizedAddress || address);
        const normalizedKeys = (accountRes.keys || []).map((key) => ({
          keyIndex: key.keyIndex ?? key.key_index ?? key.index,
          publicKey: key.publicKey ?? key.public_key ?? '',
          signingAlgorithm: key.signingAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
          hashingAlgorithm: key.hashingAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
          weight: key.weight ?? 0,
          sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
          revoked: Boolean(key.revoked),
        }));
        setAccount({
          address: normalizeAddress(accountRes.address),
          balance: accountRes.balance,
          createdAt: null,
          contracts: accountRes.contracts || [],
          keys: normalizedKeys
        });
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch account:', err);
        setError('Account not found');
        setLoading(false);
      }
    };
    loadAccountInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const loadTransactions = async (page) => {
    setTxLoading(true);
    try {
      const cursor = txCursors[page] ?? '';
      const txRes = await api.getAccountTransactions(normalizedAddress || address, cursor, 20);
      const items = txRes?.items ?? (Array.isArray(txRes) ? txRes : []);
      const nextCursor = txRes?.next_cursor ?? '';
      const accountTxs = (items || [])
        .map(tx => ({
          ...tx,
          type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
          payer: normalizeAddress(tx.payer_address || tx.proposer_address),
          proposer: normalizeAddress(tx.proposer_address),
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
      const tokenRes = await api.getAccountTokenTransfers(normalizedAddress || address, cursorValue, 20);
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
      const nftRes = await api.getAccountNFTTransfers(normalizedAddress || address, cursorValue, 20);
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

  const loadContractCode = async (name) => {
    if (!name) return;
    setContractCodeLoading(true);
    setContractCodeError(null);
    setSelectedContract(name);
    setSelectedContractCode('');
    try {
      const res = await api.getAccountContractCode(normalizedAddress || address, name);
      setSelectedContractCode(res?.code || '');
    } catch (err) {
      console.error('Failed to load contract code', err);
      setContractCodeError('Failed to load contract code');
    } finally {
      setContractCodeLoading(false);
    }
  };

  const loadStorageOverview = async () => {
    setStorageLoading(true);
    setStorageError(null);
    setStorageItem(null);
    setStorageSelected(null);
    try {
      const res = await api.getAccountStorageOverview(normalizedAddress || address);
      setStorageOverview(decodeCadenceValue(res));
    } catch (err) {
      console.error('Failed to load storage overview', err);
      setStorageError('Failed to load storage overview');
    } finally {
      setStorageLoading(false);
    }
  };

  const browseStoragePath = async (pathValue, opts = {}) => {
    const str = String(pathValue || '');
    const parts = str.split('/');
    const identifier = parts[parts.length - 1] || '';
    if (!identifier) return;

    setStorageLoading(true);
    setStorageError(null);
    setStorageSelected(str);
    setStorageItem(null);
    try {
      const res = await api.getAccountStorageItem(normalizedAddress || address, identifier, opts);
      setStorageItem(decodeCadenceValue(res));
    } catch (err) {
      console.error('Failed to browse storage item', err);
      setStorageError('Failed to browse storage item');
    } finally {
      setStorageLoading(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (activeTab !== 'storage') return;
    if (storageOverview || storageLoading) return;
    loadStorageOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, address]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 border-t-nothing-green-dark dark:border-t-nothing-green rounded-full animate-spin"></div>
          <p className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] animate-pulse">Retrieving Account...</p>
        </div>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
        <div className="border border-red-500/30 bg-red-50 dark:bg-nothing-dark p-8 max-w-md text-center shadow-sm">
          <User className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Account Not Found</h2>
          <p className="text-zinc-600 dark:text-zinc-500 text-xs mb-6">The requested account could not be located.</p>
          <Link to="/" className="inline-block w-full border border-zinc-200 dark:border-white/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

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
            <Wallet className="h-32 w-32" />
          </div>

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green-dark/30 dark:border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                  Account
                </span>
              </div>

              <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white mb-2 break-all" title={account.address}>
                {formatShort(account.address, 12, 8)}
              </h1>
            </div>
          </div>
        </div>

        {/* Account Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark hover:border-nothing-green-dark/50 dark:hover:border-nothing-green/50 transition-colors shadow-sm dark:shadow-none">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Balance</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white overflow-hidden text-ellipsis flex items-center gap-2">
              <NumberFlow
                value={account.balance || 0}
                format={{ minimumFractionDigits: 0, maximumFractionDigits: 4 }}
              />
              <span className="text-sm text-nothing-green-dark dark:text-nothing-green">FLOW</span>
            </p>
          </div>
          <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Transactions</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white">{transactions.length >= 10 ? '10+' : transactions.length}</p>
          </div>
          <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Contracts</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white">{account.contracts?.length || 0}</p>
          </div>
        </div>

        {/* Tabs for Account Info & Keys */}
        <div className="mb-8">
          <div className="flex border-b border-zinc-200 dark:border-white/10 mb-0">
            <button
              onClick={() => setActiveTab('info')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'info'
                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <User className={`h-4 w-4 ${activeTab === 'info' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                Account Info
              </span>
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'keys'
                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <Key className={`h-4 w-4 ${activeTab === 'keys' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                Public Keys
              </span>
            </button>
            <button
              onClick={() => setActiveTab('contracts')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'contracts'
                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <FileText className={`h-4 w-4 ${activeTab === 'contracts' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                Contracts ({account.contracts ? account.contracts.length : 0})
              </span>
            </button>
            <button
              onClick={() => setActiveTab('storage')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'storage'
                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <HardDrive className={`h-4 w-4 ${activeTab === 'storage' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                Storage
              </span>
            </button>
          </div>

          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 border-t-0 p-6 min-h-[200px] shadow-sm dark:shadow-none">
            {activeTab === 'info' && (
              <div className="space-y-4">
                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                  Account Overview
                </h2>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Address</p>
                  <p className="text-sm text-zinc-900 dark:text-white font-mono" title={account.address}>{formatShort(account.address, 12, 8)}</p>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Created At</p>
                  <p className="text-sm text-zinc-900 dark:text-white font-mono">
                    {account.createdAt ? new Date(account.createdAt).toLocaleString() : 'N/A'}
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'keys' && (
              <div className="space-y-4">
                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                  Associated Public Keys
                </h2>
                {account.keys && account.keys.length > 0 ? (
                  <div className="space-y-2">
                    {account.keys.map((key, idx) => (
                      <div key={idx} className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-5 group hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors rounded-sm">
                        <div className="flex flex-col gap-4">
                          {/* Top Row: Metadata Badges */}
                          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 dark:border-white/5 pb-3">
                            <div className="flex items-center gap-2 pr-3 border-r border-zinc-200 dark:border-white/5">
                              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Index</span>
                              <span className="text-xs text-zinc-900 dark:text-white font-mono">#{key.keyIndex ?? idx}</span>
                            </div>

                            <div className="flex items-center gap-2 pr-3 border-r border-zinc-200 dark:border-white/5">
                              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Weight</span>
                              <span className="text-xs text-zinc-900 dark:text-white font-mono">{key.weight ?? 0}</span>
                            </div>

                            <div className="flex items-center gap-2 pr-3 border-r border-zinc-200 dark:border-white/5">
                              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Algo</span>
                              <span className="text-xs text-zinc-600 dark:text-zinc-300 font-mono">
                                {key.signingAlgorithm || 'N/A'} <span className="text-zinc-400 dark:text-zinc-600">/</span> {key.hashingAlgorithm || 'N/A'}
                              </span>
                            </div>

                            <span className={`ml-auto text-[10px] uppercase px-2 py-0.5 border rounded-sm tracking-widest ${key.revoked
                              ? 'border-red-500/40 text-red-500 bg-red-500/10'
                              : 'border-nothing-green-dark/30 dark:border-nothing-green/30 text-nothing-green-dark dark:text-nothing-green bg-nothing-green-dark/10 dark:bg-nothing-green/10'
                              }`}>
                              {key.revoked ? 'Revoked' : 'Active'}
                            </span>
                          </div>

                          {/* Bottom Row: Key Data */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-600 uppercase tracking-widest">Public Key</span>
                            <div className="bg-zinc-100 dark:bg-black/60 p-3 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden group-hover:bg-white dark:group-hover:bg-black/80 transition-colors">
                              <code className="text-xs text-zinc-600 dark:text-zinc-400 break-all font-mono leading-relaxed select-all">
                                {key.publicKey}
                              </code>
                            </div>
                          </div>
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
                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                  Deployed Contracts
                </h2>
                {account.contracts && account.contracts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {account.contracts.map((contract, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => loadContractCode(contract.name || contract)}
                        className="bg-zinc-50 dark:bg-black/50 border border-zinc-200 dark:border-white/5 p-4 flex items-center justify-between hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 hover:bg-zinc-100 dark:hover:bg-black/70 transition-colors text-left rounded-sm"
                      >
                        <div className="flex items-center gap-3">
                          <Code className="h-4 w-4 text-nothing-green-dark dark:text-nothing-green" />
                          <span className="text-sm text-zinc-900 dark:text-white font-mono">{contract.name || contract}</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">View</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">No contracts deployed</p>
                )}

                {(contractCodeLoading || contractCodeError || selectedContractCode) && (
                  <div className="mt-6 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/40 p-4 rounded-sm">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
                        Contract Source
                      </div>
                      {selectedContract && (
                        <div className="text-xs text-zinc-900 dark:text-white font-mono">
                          {selectedContract}
                        </div>
                      )}
                    </div>

                    {contractCodeLoading && (
                      <div className="text-xs text-zinc-500 italic">Loading contract source…</div>
                    )}
                    {contractCodeError && (
                      <div className="text-xs text-red-500 dark:text-red-400">{contractCodeError}</div>
                    )}
                    {!contractCodeLoading && !contractCodeError && selectedContractCode && (
                      <div className="rounded-sm overflow-hidden border border-zinc-200 dark:border-white/10">
                        <SyntaxHighlighter
                          language="cadence"
                          style={vscDarkPlus}
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            fontSize: '11px',
                            lineHeight: '1.5',
                            maxHeight: '420px',
                          }}
                          showLineNumbers={true}
                          lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: "#555", userSelect: "none" }}
                        >
                          {selectedContractCode}
                        </SyntaxHighlighter>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'storage' && (
              <div className="space-y-4">
                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                  Storage
                </h2>

                {storageError && (
                  <div className="text-xs text-red-500 dark:text-red-400 mb-4">{storageError}</div>
                )}

                {(!storageOverview && storageLoading) && (
                  <div className="text-xs text-zinc-500 italic p-4">Loading storage overview...</div>
                )}

                {storageOverview && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
                    {/* Left: File Browser */}
                    <div className="md:col-span-1 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/40 rounded-sm flex flex-col overflow-hidden">
                      <div className="p-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">File Browser</span>
                        <span className="text-[10px] text-zinc-500">
                          {storageOverview.used ?? '?'} / {storageOverview.capacity ?? '?'}
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto p-2 space-y-1">
                        {/* Domains */}
                        {['storage', 'public', 'private'].map(domain => {
                          const paths = domain === 'storage' ? storageOverview.storagePaths
                            : domain === 'public' ? storageOverview.publicPaths
                              : domain === 'private' ? storageOverview.privatePaths
                                : [];
                          if (!paths || paths.length === 0) return null;

                          const isExpanded = expandedDomains[domain];

                          return (
                            <div key={domain}>
                              <button
                                onClick={() => setExpandedDomains(prev => ({ ...prev, [domain]: !prev[domain] }))}
                                className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-sm transition-colors text-zinc-700 dark:text-zinc-300"
                              >
                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {isExpanded ? <FolderOpen className="h-3 w-3 text-nothing-green-dark dark:text-nothing-green" /> : <Folder className="h-3 w-3 text-nothing-green-dark dark:text-nothing-green" />}
                                <span className="text-xs font-semibold uppercase tracking-wider">/{domain}</span>
                                <span className="text-[10px] text-zinc-500 ml-auto">({paths.length})</span>
                              </button>

                              {isExpanded && (
                                <div className="ml-4 pl-2 border-l border-zinc-200 dark:border-white/5 mt-1 space-y-0.5">
                                  {paths.map(path => {
                                    const name = path.split('/').pop();
                                    const isSelected = storageSelected === path;
                                    return (
                                      <button
                                        key={path}
                                        onClick={() => {
                                          if (domain === 'storage') browseStoragePath(path);
                                          else {
                                            setStorageSelected(path);
                                            setStorageItem({ [domain + 'Path']: path });
                                          }
                                        }}
                                        className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded-sm transition-colors text-xs font-mono truncate ${isSelected
                                          ? 'bg-nothing-green-dark/10 dark:bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green'
                                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5'}`}
                                        title={path}
                                      >
                                        <File className="h-3 w-3 flex-shrink-0" />
                                        <span className="truncate">{name}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Right: Content Viewer */}
                    <div className="md:col-span-2 border border-zinc-200 dark:border-white/10 bg-white dark:bg-black/40 rounded-sm flex flex-col overflow-hidden relative">
                      {storageLoading && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                          <div className="w-8 h-8 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin"></div>
                        </div>
                      )}

                      <div className="p-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileText className="h-4 w-4 text-zinc-500" />
                          <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate" title={storageSelected || ''}>
                            {storageSelected || 'Select a file'}
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-[#1e1e1e] relative">
                        {storageItem ? (
                          <SyntaxHighlighter
                            language="json"
                            style={vscDarkPlus}
                            customStyle={{
                              margin: 0,
                              padding: '1.5rem',
                              fontSize: '11px',
                              lineHeight: '1.6',
                              minHeight: '100%',
                            }}
                            showLineNumbers={true}
                            lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: "#555", userSelect: "none" }}
                          >
                            {JSON.stringify(storageItem, null, 2)}
                          </SyntaxHighlighter>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-600">
                            <HardDrive className="h-12 w-12 mb-4 opacity-20" />
                            <p className="text-xs uppercase tracking-widest">Select an item to view contents</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Activity */}
        <div className="border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
          <div className="p-6 border-b border-zinc-200 dark:border-white/10 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest">Activity</h2>
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
                className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm ${activityTab === 'transactions'
                  ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Activity className={`h-3 w-3 ${activityTab === 'transactions' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                  Transactions
                </span>
              </button>
              <button
                onClick={() => setActivityTab('tokens')}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm ${activityTab === 'tokens'
                  ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Coins className={`h-3 w-3 ${activityTab === 'tokens' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                  Tokens
                </span>
              </button>
              <button
                onClick={() => setActivityTab('nfts')}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm ${activityTab === 'nfts'
                  ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <ImageIcon className={`h-3 w-3 ${activityTab === 'nfts' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                  NFTs
                </span>
              </button>
            </div>
          </div>

          {activityTab === 'transactions' && (
            <>
              <div className="overflow-x-auto min-h-[200px] relative">
                {txLoading && (
                  <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin"></div>
                  </div>
                )}

                {transactions.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                        <th className="p-4 font-normal">Tx Hash</th>
                        <th className="p-4 font-normal">Type</th>
                        <th className="p-4 font-normal">Role</th>
                        <th className="p-4 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                      {transactions.map((tx) => {
                        const role = tx.payer === normalizedAddress ? 'Payer' :
                          tx.proposer === normalizedAddress ? 'Proposer' : 'Authorizer';
                        return (
                          <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                            <td className="p-4">
                              <Link to={`/transactions/${tx.id}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                {formatShort(tx.id, 12, 8)}
                              </Link>
                            </td>
                            <td className="p-4">
                              <span className="border border-zinc-200 dark:border-white/10 px-2 py-1 rounded-sm text-zinc-600 dark:text-zinc-300 text-[10px] uppercase bg-zinc-100 dark:bg-transparent">
                                {tx.type}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className="text-[10px] uppercase text-zinc-500">{role}</span>
                            </td>
                            <td className="p-4">
                              <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-500 dark:text-zinc-400' : 'text-yellow-600 dark:text-yellow-500'}`}>
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
                  <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin"></div>
                  </div>
                )}

                {tokenTransfers.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                        <th className="p-4 font-normal">Tx Hash</th>
                        <th className="p-4 font-normal">Block</th>
                        <th className="p-4 font-normal">Contract</th>
                        <th className="p-4 font-normal">From</th>
                        <th className="p-4 font-normal">To</th>
                        <th className="p-4 font-normal">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                      {tokenTransfers.map((t, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                          <td className="p-4">
                            <Link to={`/transactions/${t.tx_id}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                              {formatShort(t.tx_id, 8, 0)}
                            </Link>
                          </td>
                          <td className="p-4 text-zinc-500 dark:text-zinc-400">
                            {Number(t.block_height).toLocaleString()}
                          </td>
                          <td className="p-4 text-zinc-600 dark:text-zinc-300">
                            {formatShort(t.token_id, 20)}
                          </td>
                          <td className="p-4 font-mono text-zinc-500 dark:text-zinc-400">
                            {t.from_address ? formatShort(t.from_address) : 'Mint'}
                          </td>
                          <td className="p-4 font-mono text-zinc-500 dark:text-zinc-400">
                            {t.to_address ? formatShort(t.to_address) : 'Burn'}
                          </td>
                          <td className="p-4 text-zinc-900 dark:text-white font-bold">
                            {Number(t.amount).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !tokenLoading && <div className="p-8 text-center text-zinc-500 italic">No token transfers found</div>
                )}
              </div>
              <div className="p-4 border-t border-zinc-200 dark:border-white/5 text-center">
                {tokenHasMore ? (
                  <button onClick={() => loadTokenTransfers(tokenCursor, true)} className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">Load More</button>
                ) : (
                  <span className="text-xs text-zinc-500 italic">End of History</span>
                )}
              </div>
            </>
          )}

          {activityTab === 'nfts' && (
            <>
              <div className="overflow-x-auto min-h-[200px] relative">
                {nftLoading && (
                  <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin"></div>
                  </div>
                )}

                {nftTransfers.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                        <th className="p-4 font-normal">Tx Hash</th>
                        <th className="p-4 font-normal">Block</th>
                        <th className="p-4 font-normal">Collection</th>
                        <th className="p-4 font-normal">NFT ID</th>
                        <th className="p-4 font-normal">From</th>
                        <th className="p-4 font-normal">To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                      {nftTransfers.map((nft, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                          <td className="p-4">
                            <Link to={`/transactions/${nft.tx_id}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                              {formatShort(nft.tx_id, 8, 0)}
                            </Link>
                          </td>
                          <td className="p-4 text-zinc-500 dark:text-zinc-400">
                            {Number(nft.block_height).toLocaleString()}
                          </td>
                          <td className="p-4 text-zinc-600 dark:text-zinc-300" title={nft.nft_type}>
                            {((nft.nft_type || '').split('.').pop())}
                          </td>
                          <td className="p-4 text-zinc-900 dark:text-white font-bold">
                            #{nft.nft_id}
                          </td>
                          <td className="p-4 font-mono text-zinc-500 dark:text-zinc-400">
                            {nft.from_address ? formatShort(nft.from_address) : 'Mint'}
                          </td>
                          <td className="p-4 font-mono text-zinc-500 dark:text-zinc-400">
                            {nft.to_address ? formatShort(nft.to_address) : 'Burn'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !nftLoading && <div className="p-8 text-center text-zinc-500 italic">No NFT transfers found</div>
                )}
              </div>
              <div className="p-4 border-t border-zinc-200 dark:border-white/5 text-center">
                {nftHasMore ? (
                  <button onClick={() => loadNFTTransfers(nftCursor, true)} className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">Load More</button>
                ) : (
                  <span className="text-xs text-zinc-500 italic">End of History</span>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

export default AccountDetail;
