import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';
import { Search, Activity, Box, TrendingUp, Database, Zap, ArrowRightLeft, User, Coins, Image as ImageIcon } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { motion, AnimatePresence } from 'framer-motion';
import { DailyStatsChart } from '../components/DailyStatsChart';

function Home() {
  const [blocks, setBlocks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [prevHeight, setPrevHeight] = useState(0);
  const [newBlockIds, setNewBlockIds] = useState(new Set());
  const [newTxIds, setNewTxIds] = useState(new Set());
  const prevBlocksRef = useRef([]);
  const prevTxRef = useRef([]);

  const { isConnected, lastMessage } = useWebSocket();

  // Handle WebSocket messages (Real-time updates)
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'new_block') {
      const newBlock = lastMessage.payload;
      // Add new block to the top of the list
      setBlocks(prev => [newBlock, ...(prev || []).slice(0, 9)]);

      // Trigger animation
      setNewBlockIds(prev => new Set(prev).add(newBlock.height));
      setTimeout(() => setNewBlockIds(prev => {
        const next = new Set(prev);
        next.delete(newBlock.height);
        return next;
      }), 3000);
    } else if (lastMessage.type === 'new_transaction') {
      const rawTx = lastMessage.payload;
      // Transform API response to match frontend expectations
      const newTx = {
        ...rawTx,
        type: rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
        payer: rawTx.payer_address || rawTx.proposer_address,
        blockHeight: rawTx.block_height
      };
      // Add new tx to the top of the list
      setTransactions(prev => [newTx, ...(prev || []).slice(0, 9)]);

      // Trigger animation
      setNewTxIds(prev => new Set(prev).add(newTx.id));
      setTimeout(() => setNewTxIds(prev => {
        const next = new Set(prev);
        next.delete(newTx.id);
        return next;
      }), 3000);
    }
  }, [lastMessage]);

  // Initial data load
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [blocksRes, txRes, statusRes] = await Promise.all([
          api.getBlocks(),
          api.getTransactions(),
          api.getStatus()
        ]);

        // Transform API response to match frontend expectations
        const transformedTxs = (txRes || []).map(tx => ({
          ...tx,
          type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING', // Default type
          payer: tx.payer_address || tx.proposer_address,
          blockHeight: tx.block_height
        }));

        setBlocks(blocksRes);
        setTransactions(transformedTxs);
        setStatus({
          latestBlock: statusRes?.latest_height,
          totalTransactions: statusRes?.indexed_height,
          tps: 0
        });

        if (statusRes?.latest_height) {
          setPrevHeight(statusRes.latest_height);
        }
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        setLoading(false);
      }
    };
    loadInitialData();
  }, []);

  const getTypeIcon = (type) => {
    const iconClass = "h-4 w-4";
    switch (type) {
      case 'TRANSFER': return <ArrowRightLeft className={iconClass} />;
      case 'CREATE_ACCOUNT': return <User className={iconClass} />;
      case 'TOKEN_MINT': return <Coins className={iconClass} />;
      case 'NFT_MINT': return <ImageIcon className={iconClass} />;
      default: return <Activity className={iconClass} />;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'TRANSFER': return 'border-cyan-500/50 text-cyan-400';
      case 'CREATE_ACCOUNT': return 'border-purple-500/50 text-purple-400';
      case 'TOKEN_MINT': return 'border-yellow-500/50 text-yellow-400';
      case 'NFT_MINT': return 'border-pink-500/50 text-pink-400';
      default: return 'border-slate-500/50 text-slate-400';
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="flex flex-col items-center space-y-4">
          <div className="relative">
            {/* Dotted Spinner */}
            <div className="w-16 h-16 border-4 border-dashed border-nothing-dark border-t-nothing-green rounded-full animate-spin"></div>
            <Zap className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-6 w-6 text-nothing-green" />
          </div>
          <p className="text-nothing-white text-xs uppercase tracking-[0.2em] animate-pulse">Initializing System...</p>
        </div>
      </div>
    );
  }

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim();
    setSearching(true);

    try {
      // 1. Check if it's a block height (number)
      if (/^\d+$/.test(query)) {
        window.location.href = `/blocks/${query}`;
        return;
      }

      // 2. Check if it's an address (0x followed by hex)
      if (/^0x[a-fA-F0-9]{16}$/.test(query) || /^[a-fA-F0-9]{16}$/.test(query)) {
        const addr = query.startsWith('0x') ? query.slice(2) : query;
        window.location.href = `/accounts/${addr}`;
        return;
      }

      // 3. Check if it's a Tx ID
      if (/^[a-fA-F0-9]{64}$/.test(query)) {
        window.location.href = `/transactions/${query}`;
        return;
      }

      // 4. Try resolving as Public Key
      try {
        const res = await api.client.get(`/keys/${query}`);
        if (res.data && res.data.address) {
          window.location.href = `/accounts/${res.data.address}`;
          return;
        }
      } catch (err) {
        // Not a public key or not found
      }

      alert('No results found for your query.');
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-nothing-black text-nothing-white font-mono selection:bg-nothing-green selection:text-black">
      {/* Hero Section with Search */}
      <div className="border-b border-white/5 bg-nothing-dark/50">
        <div className="container mx-auto px-4 py-16 text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white uppercase italic">
              Flow<span className="text-nothing-green">Scan</span>
            </h1>
            <p className="text-xs text-gray-500 uppercase tracking-[0.4em]">Decentralized Intelligence Protocol</p>
          </motion.div>

          <motion.form
            onSubmit={handleSearch}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="max-w-2xl mx-auto relative group"
          >
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
        {/* Stats Section */}
        {/* Stats Section */}
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
                {status?.latestBlock?.toLocaleString() || '---'}
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
                {status?.totalTransactions?.toLocaleString() || '---'}
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
                {status?.tps?.toFixed(2) || '0.00'}
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
                {(blocks || []).slice(0, 10).map((block) => {
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
                {(transactions || []).slice(0, 10).map((tx) => {
                  const isNew = newTxIds.has(tx.id);
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
                          ? 'bg-white/10 border-white/40' // Txs flash white/grey
                          : 'bg-black/20 border-white/5'
                          }`}
                      >
                        {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-white animate-ping" />}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              {/* Type Badge */}
                              <span className="text-[10px] px-1.5 py-0.5 border border-white/20 bg-white/5 text-gray-300 uppercase tracking-wider rounded-sm">
                                {tx.type}
                              </span>
                              <span className="text-xs text-gray-400 font-mono truncate w-24 sm:w-auto">
                                {tx.id?.slice(0, 16)}...
                              </span>
                            </div>
                            <span className={`text-[10px] uppercase font-bold tracking-wider ${tx.status === 'SEALED' ? 'text-nothing-green' : 'text-yellow-500'
                              }`}>
                              [{tx.status}]
                            </span>
                          </div>

                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default Home;
