import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Box, Activity, TrendingUp, Database, ArrowRightLeft } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import { FlowPriceChart } from '../components/FlowPriceChart';
import { EpochProgress } from '../components/EpochProgress';
import { NetworkStats } from '../components/NetworkStats';
import { Pagination } from '../components/Pagination';
import { DailyStatsChart } from '../components/DailyStatsChart';

function Home() {
  const [blocks, setBlocks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  // const [loading, setLoading] = useState(true); // Unused
  const [status, setStatus] = useState(null);
  const [networkStats, setNetworkStats] = useState(null); // New state

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();

  // Pagination State
  const [blockPage, setBlockPage] = useState(1);
  const [txPage, setTxPage] = useState(1);

  const [newBlockIds, setNewBlockIds] = useState(new Set());
  const [newTxIds, setNewTxIds] = useState(new Set());
  // Removed unused refs and state

  const { isConnected, lastMessage } = useWebSocket();

  // Load Blocks for Page
  const loadBlocks = async (page) => {
    try {
      const res = await api.getBlocks(page);
      setBlocks(res || []);
    } catch (err) {
      console.error("Failed to load blocks", err);
    }
  };

  // Load Txs for Page
  const loadTransactions = async (page) => {
    try {
      const res = await api.getTransactions(page);
      const transformedTxs = Array.isArray(res) ? res.map(tx => ({
        ...tx,
        type: tx.type || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
        payer: tx.payer_address || tx.proposer_address,
        blockHeight: tx.block_height
      })) : [];
      setTransactions(transformedTxs);
    } catch (err) {
      console.error("Failed to load transactions", err);
    }
  };

  const handleBlockPageChange = (newPage) => {
    setBlockPage(newPage);
    loadBlocks(newPage);
  };

  const handleTxPageChange = (newPage) => {
    setTxPage(newPage);
    loadTransactions(newPage);
  };

  // Handle WebSocket messages (Real-time updates)
  useEffect(() => {
    if (!lastMessage) return;

    // Only update if on first page
    if (blockPage === 1 && lastMessage.type === 'new_block') {
      const newBlock = lastMessage.payload;
      setBlocks(prev => [newBlock, ...(prev || []).slice(0, 9)]);
      setNewBlockIds(prev => new Set(prev).add(newBlock.height));
      setTimeout(() => setNewBlockIds(prev => {
        const next = new Set(prev);
        next.delete(newBlock.height);
        return next;
      }), 3000);
    }

    // Only update if on first page
    if (txPage === 1 && lastMessage.type === 'new_transaction') {
      const rawTx = lastMessage.payload;
      const newTx = {
        ...rawTx,
        type: rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
        payer: rawTx.payer_address || rawTx.proposer_address,
        blockHeight: rawTx.block_height
      };
      setTransactions(prev => [newTx, ...(prev || []).slice(0, 9)]);
      setNewTxIds(prev => new Set(prev).add(newTx.id));
      setTimeout(() => setNewTxIds(prev => {
        const next = new Set(prev);
        next.delete(newTx.id);
        return next;
      }), 3000);
    }
  }, [lastMessage, blockPage, txPage]);

  // Initial data load
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [statusResult, netStatsResult] = await Promise.allSettled([
          api.getStatus(),
          api.getNetworkStats() // Fetch new stats
        ]);

        // Call the new load functions for page 1
        await loadBlocks(1);
        await loadTransactions(1);

        const statusRes = statusResult.status === 'fulfilled' ? statusResult.value : null;
        const netStatsRes = netStatsResult.status === 'fulfilled' ? netStatsResult.value : null;

        setNetworkStats(netStatsRes);



        if (statusRes) {
          setStatus({
            latestBlock: statusRes.latest_height,
            totalTransactions: statusRes.indexed_height,
            tps: 0
          });
          if (statusRes.latest_height) {
            // setPrevHeight(statusRes.latest_height);
          }
        }
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
      } finally {
        // setLoading(false);
      }
    };
    loadInitialData();
  }, []);

  // ... (Helper functions remain same)

  // Search Logic
  const handleSearch = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    const query = searchQuery.trim();

    // Simple heuristic routing
    // 1. Block Height (numeric)
    if (/^\d+$/.test(query)) {
      navigate(`/blocks/${query}`);
    }
    // 2. Transaction ID (64 chars hex)
    else if (/^[a-fA-F0-9]{64}$/.test(query)) {
      navigate(`/transactions/${query}`);
    }
    // 3. Address (18 chars with 0x) - Flow addresses are usually 16 hex chars (8 bytes) = 18 with 0x
    else if (/^0x[a-fA-F0-9]{16}$/.test(query)) {
      navigate(`/accounts/${query}`);
    }
    // Fallback based on prefix
    else if (query.startsWith('0x')) {
      navigate(`/accounts/${query}`);
    }
    else {
      // Default to transaction lookup for other hashes
      navigate(`/transactions/${query}`);
    }

    setSearching(false);
  };

  return (
    <div className="min-h-screen bg-nothing-black text-nothing-white font-mono selection:bg-nothing-green selection:text-black">
      {/* Hero Section with Search */}
      <div className="border-b border-white/5 bg-nothing-dark/50">
        <div className="container mx-auto px-4 py-12 space-y-8">
          {/* Branding */}
          <div className="text-center space-y-2 mb-8">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white uppercase italic">
                Flow<span className="text-nothing-green">Scan</span>
              </h1>
              <p className="text-xs text-gray-500 uppercase tracking-[0.4em]">Decentralized Intelligence Protocol</p>
            </motion.div>
          </div>

          {/* New Premium Stats Grid (Flow Pulse) */}
          {networkStats && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
            >
              {/* 1. Price Chart */}
              <FlowPriceChart data={networkStats} />

              {/* 2. Epoch Progress */}
              <EpochProgress epoch={networkStats.epoch} progress={networkStats.epoch_progress} />

              {/* 3. Network Stats Grid */}
              <NetworkStats totalStaked={networkStats.total_staked} activeNodes={networkStats.active_nodes} />
            </motion.div>
          )}

          {/* Search Bar */}
          <motion.form
            onSubmit={handleSearch}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="max-w-2xl mx-auto relative group"
          >
            {/* ... Search implementation unchanged ... */}
            <div className="absolute inset-0 bg-nothing-green/5 blur-xl group-hover:bg-nothing-green/10 transition-colors duration-500" />
            <div className="relative flex items-center bg-nothing-dark border border-white/10 p-1 group-focus-within:border-nothing-green transition-all duration-300">
              <Search className="h-5 w-5 ml-4 text-gray-500 group-focus-within:text-nothing-green" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Address / Tx ID / Block / Public Key..."
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-3 px-4 text-white placeholder:text-gray-600 uppercase tracking-widest outline-none"
              />
              <button
                type="submit"
                disabled={searching}
                className="bg-nothing-green text-black text-[10px] font-bold uppercase tracking-widest px-8 py-3 hover:bg-white transition-colors duration-300 disabled:opacity-50"
              >
                {searching ? 'Processing...' : 'Execute Search'}
              </button>
            </div>
          </motion.form>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Basic Stats Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="group bg-nothing-dark border border-white/10 p-6 hover:border-nothing-green/50 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 border border-white/10 rounded-sm">
                <Box className="h-5 w-5 text-nothing-green" />
              </div>
              <div className={`flex items-center space-x-2 px-3 py-1 border rounded-sm ${isConnected ? 'bg-nothing-green/10 border-nothing-green/30' : 'bg-white/5 border-white/10'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-nothing-green animate-pulse' : 'bg-gray-500'}`}></div>
                <span className={`text-[10px] uppercase tracking-wider ${isConnected ? 'text-nothing-green' : 'text-gray-500'}`}>
                  {isConnected ? 'System Online' : 'Offline'}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Latest Block</p>
              <p className="text-3xl font-bold font-mono text-white group-hover:text-nothing-green transition-colors">
                <NumberFlow
                  value={status?.latestBlock || 0}
                  format={{ useGrouping: true }}
                />
              </p>
            </div>
          </div>

          <div className="group bg-nothing-dark border border-white/10 p-6 hover:border-white/30 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 border border-white/10 rounded-sm">
                <Activity className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Total TXs</p>
              <p className="text-3xl font-bold font-mono text-white">
                <NumberFlow
                  value={status?.totalTransactions || 0}
                  format={{ useGrouping: true }}
                />
              </p>
            </div>
          </div>

          <div className="group bg-nothing-dark border border-white/10 p-6 hover:border-white/30 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 border border-white/10 rounded-sm">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Network TPS</p>
              <p className="text-3xl font-bold font-mono text-white">
                <NumberFlow
                  value={status?.tps || 0}
                  format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                />
              </p>
            </div>
          </div>
        </div>

        {/* Indexing Progress Bar */}
        {status && status.start_height && status.latest_height && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-nothing-dark border border-white/10 p-6"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Database className="h-5 w-5 text-nothing-green" />
                  <h3 className="text-sm uppercase tracking-widest text-white">Blockchain Indexing Progress</h3>
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wider">
                  {status.progress || '0%'} Complete
                </span>
              </div>

              {/* Visual Progress Bar */}
              <div className="relative h-12 bg-black/50 border border-white/10 rounded-sm overflow-hidden">
                {(() => {
                  const start = status.start_height || 0;
                  const indexed = status.indexed_height || start;
                  const latest = status.latest_height || indexed;
                  const totalRange = latest - start;
                  const indexedRange = indexed - start;
                  const indexedPercent = totalRange > 0 ? (indexedRange / totalRange) * 100 : 0;

                  return (
                    <>
                      {/* Indexed portion (colored) */}
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${indexedPercent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="absolute left-0 top-0 h-full bg-gradient-to-r from-nothing-green/20 via-nothing-green/40 to-nothing-green/30 border-r-2 border-nothing-green/50"
                      >
                        <div className="absolute inset-0 bg-nothing-green/10 animate-pulse"></div>
                      </motion.div>

                      {/* Labels */}
                      <div className="absolute inset-0 flex items-center justify-between px-4 text-xs font-mono">
                        <span className="text-gray-400">
                          Start: <span className="text-white">{start.toLocaleString()}</span>
                        </span>
                        <span className="text-nothing-green font-bold">
                          Indexed: <span className="text-white">{indexed.toLocaleString()}</span>
                        </span>
                        <span className="text-gray-500">
                          Latest: <span className="text-white">{latest.toLocaleString()}</span>
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Additional Stats */}
              <div className="grid grid-cols-3 gap-4 text-center pt-2">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Blocks Behind</p>
                  <p className="text-sm font-mono text-white">{status.behind?.toLocaleString() || '0'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Blocks Indexed</p>
                  <p className="text-sm font-mono text-nothing-green">
                    {((status.indexed_height || 0) - (status.start_height || 0)).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Range</p>
                  <p className="text-sm font-mono text-white">
                    {((status.latest_height || 0) - (status.start_height || 0)).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Charts Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <DailyStatsChart />
        </motion.div>

        {/* Blocks & Transactions Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Blocks */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-nothing-dark border border-white/10 p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Box className="h-5 w-5 text-nothing-green" />
                <h2 className="text-lg font-bold text-white uppercase tracking-widest">Recent Blocks</h2>
              </div>
            </div>

            <div className="space-y-2">
              <AnimatePresence mode='popLayout'>
                {(blocks || []).map((block) => {
                  const isNew = newBlockIds.has(block.height);
                  return (
                    <motion.div
                      layout
                      key={block.height}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    >
                      <Link
                        to={`/blocks/${block.height}`}
                        className={`block border p-3 transition-colors duration-200 hover:bg-white/5 hover:border-white/20 relative overflow-hidden ${isNew
                          ? 'bg-nothing-green/10 border-nothing-green/50'
                          : 'bg-black/20 border-white/5'
                          }`}
                      >
                        {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-nothing-green animate-ping" />}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <span className="text-xs text-nothing-green font-mono">#{block.height.toLocaleString()}</span>
                            <span className="text-xs text-gray-500 font-mono hidden sm:inline-block">Id: {block.id?.slice(0, 8)}...</span>
                          </div>
                          <div className="flex items-center space-x-4">
                            <div className="text-xs text-gray-400 font-mono bg-white/5 px-2 py-0.5 rounded-sm">
                              {block.txCount || 0} TXs
                            </div>
                            <span className="text-[10px] text-gray-600 font-mono uppercase">
                              {block.timestamp ? new Date(block.timestamp).toLocaleTimeString() : ''}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            <Pagination
              currentPage={blockPage}
              onPageChange={handleBlockPageChange}
              hasNext={blocks.length >= 10}
            />
          </motion.div>

          {/* Recent Transactions */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-nothing-dark border border-white/10 p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Activity className="h-5 w-5 text-white" />
                <h2 className="text-lg font-bold text-white uppercase tracking-widest">Recent TXs</h2>
              </div>
            </div>

            <div className="space-y-2">
              <AnimatePresence mode='popLayout'>
                {(transactions || []).map((tx) => {
                  const isNew = newTxIds.has(tx.id);
                  const isSealed = tx.status === 'SEALED';
                  const isError = !isSealed && tx.status !== 'PENDING'; // Assume anything else is error for list

                  // Helper to determine Transaction Type & Details
                  const getTxMetadata = (tx) => {
                    let type = 'Interaction';
                    let transferInfo = null;

                    // Check Events for type inference
                    if (tx.events && Array.isArray(tx.events)) {
                      for (const evt of tx.events) {
                        if (evt.type.includes('TokensDeposited')) {
                          type = 'Transfer';
                          if (evt.values?.value?.fields) {
                            const amount = evt.values.value.fields.find(f => f.name === 'amount')?.value?.value;
                            if (amount) transferInfo = `${parseFloat(amount).toFixed(2)} FLOW`;
                          }
                        } else if (evt.type.includes('AccountCreated')) {
                          type = 'Create Account';
                        } else if (evt.type.includes('AccountContractAdded')) {
                          type = 'Deploy Contract';
                        } else if (evt.type.includes('Mint')) {
                          type = 'Mint';
                        }
                      }
                    }

                    // Fallback to script/backend provided type
                    if (type === 'Interaction' && tx.type && tx.type !== 'PENDING' && tx.type !== 'TRANSFER') {
                      type = tx.type;
                    }

                    return { type, transferInfo };
                  };

                  const { type: txType, transferInfo } = getTxMetadata(tx);

                  return (
                    <motion.div
                      layout
                      key={tx.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    >
                      <Link
                        to={`/transactions/${tx.id}`}
                        className={`block border p-3 transition-colors duration-200 hover:bg-white/5 hover:border-white/20 relative overflow-hidden ${isNew
                          ? 'bg-white/10 border-white/40'
                          : 'bg-black/20 border-white/5'
                          }`}
                      >
                        {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-white animate-ping" />}
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <span className="text-xs text-gray-400 font-mono truncate w-24 sm:w-32">
                                {tx.id}
                              </span>
                              <span className="text-[10px] text-gray-500 font-mono">
                                {new Date(tx.created_at || Date.now()).toLocaleTimeString()}
                              </span>
                            </div>
                            {(isSealed || isError) && (
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm border ${isSealed ? 'border-nothing-green/50 text-nothing-green bg-nothing-green/10' : 'border-red-500/50 text-red-500 bg-red-500/10'
                                }`}>
                                {isSealed ? 'Sealed' : 'Error'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 border rounded-sm tracking-wider ${txType === 'Transfer' ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5' :
                                txType === 'Mint' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5' :
                                  'border-white/20 text-gray-300 bg-white/5'
                                }`}>
                                {txType}
                              </span>
                              {transferInfo && (
                                <span className="text-xs text-white font-mono flex items-center space-x-1">
                                  <ArrowRightLeft className="w-3 h-3 text-gray-500" />
                                  <span>{transferInfo}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {tx.error_message && (
                            <div className="text-[10px] text-red-400 font-mono truncate bg-red-900/10 px-2 py-1 border border-red-500/20">
                              Error: {tx.error_message}
                            </div>
                          )}
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            <Pagination
              currentPage={txPage}
              onPageChange={handleTxPageChange}
              hasNext={transactions.length >= 10}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default Home;
