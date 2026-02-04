import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Activity, TrendingUp, Database } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import { FlowPriceChart } from '../components/FlowPriceChart';
import { EpochProgress } from '../components/EpochProgress';
import { NetworkStats } from '../components/NetworkStats';
import { Pagination } from '../components/Pagination';
import { DailyStatsChart } from '../components/DailyStatsChart';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/time';
import { useTimeTicker } from '../hooks/useTimeTicker';

function Home() {
  const [blocks, setBlocks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  // const [loading, setLoading] = useState(true); // Unused
  const [statusRaw, setStatusRaw] = useState(null);
  const [networkStats, setNetworkStats] = useState(null); // New state
  const [tps, setTps] = useState(0);

  // Pagination State
  const [blockPage, setBlockPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [blockCursors, setBlockCursors] = useState({ 1: '' });
  const [txCursors, setTxCursors] = useState({ 1: '' });
  const [blockHasNext, setBlockHasNext] = useState(false);
  const [txHasNext, setTxHasNext] = useState(false);

  const [newBlockIds, setNewBlockIds] = useState(new Set());
  const [newTxIds, setNewTxIds] = useState(new Set());
  // Removed unused refs and state

  const { isConnected, lastMessage } = useWebSocket();
  const nowTick = useTimeTicker(20000);

  const normalizeHex = (value) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  const formatMiddle = (value, head = 12, tail = 8) => {
    if (!value) return '';
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}...${value.slice(-tail)}`;
  };

  // Load Blocks for Page
  const loadBlocks = async (page) => {
    try {
      const cursor = blockCursors[page] ?? '';
      const res = await api.getBlocks(cursor, 10);
      const items = res?.items ?? (Array.isArray(res) ? res : []);
      const nextCursor = res?.next_cursor ?? '';
      setBlocks(items);
      setBlockHasNext(Boolean(nextCursor));
      if (nextCursor) {
        setBlockCursors(prev => ({ ...prev, [page + 1]: nextCursor }));
      }
    } catch (err) {
      console.error("Failed to load blocks", err);
    }
  };

  // Load Txs for Page
  const loadTransactions = async (page) => {
    try {
      const cursor = txCursors[page] ?? '';
      const res = await api.getTransactions(cursor, 10);
      const items = res?.items ?? (Array.isArray(res) ? res : []);
      const nextCursor = res?.next_cursor ?? '';
      const transformedTxs = Array.isArray(items) ? items.map(tx => ({
        ...tx,
        type: tx.type || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
        payer: tx.payer_address || tx.proposer_address,
        blockHeight: tx.block_height
      })) : [];
      setTransactions(transformedTxs);
      setTxHasNext(Boolean(nextCursor));
      if (nextCursor) {
        setTxCursors(prev => ({ ...prev, [page + 1]: nextCursor }));
      }
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

  const computeTpsFromBlocks = (items) => {
    const withTime = (items || []).filter(b => b?.timestamp);
    if (withTime.length < 2) return 0;
    const sorted = [...withTime].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const newest = new Date(sorted[0].timestamp).getTime();
    const oldest = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const durationSec = Math.max(1, (newest - oldest) / 1000);
    const totalTxs = sorted.reduce((sum, b) => sum + (b.tx_count ?? b.txCount ?? 0), 0);
    return totalTxs / durationSec;
  };

  const computeAvgBlockTime = (items) => {
    const withTime = (items || []).filter(b => b?.timestamp);
    if (withTime.length < 2) return 0;
    const sorted = [...withTime].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const newest = new Date(sorted[0].timestamp).getTime();
    const oldest = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const durationSec = Math.max(1, (newest - oldest) / 1000);
    return durationSec / (sorted.length - 1);
  };

  const [avgBlockTime, setAvgBlockTime] = useState(0);

  useEffect(() => {
    setTps(computeTpsFromBlocks(blocks));
    setAvgBlockTime(computeAvgBlockTime(blocks));
  }, [blocks]);

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
      setStatusRaw(prev => prev ? {
        ...prev,
        latest_height: Math.max(prev.latest_height || 0, newBlock.height),
        max_height: Math.max(prev.max_height || 0, newBlock.height)
      } : prev);
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
      setStatusRaw(prev => prev ? {
        ...prev,
        total_transactions: (prev.total_transactions || 0) + 1
      } : prev);
    }
  }, [lastMessage, blockPage, txPage]);

  // Initial data load + periodic refresh
  useEffect(() => {
    let active = true;

    const refreshStatus = async () => {
      try {
        const statusRes = await api.getStatus();
        if (!active || !statusRes) return;
        setStatusRaw(statusRes);
      } catch (error) {
        console.error('Failed to fetch status:', error);
      }
    };

    const refreshNetworkStats = async () => {
      try {
        const netStatsRes = await api.getNetworkStats();
        if (!active) return;
        setNetworkStats(netStatsRes);
      } catch (error) {
        console.error('Failed to fetch network stats:', error);
      }
    };

    const loadInitialData = async () => {
      try {
        await Promise.allSettled([refreshStatus(), refreshNetworkStats()]);
        await loadBlocks(1);
        await loadTransactions(1);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
      } finally {
        // setLoading(false);
      }
    };

    loadInitialData();

    const statusTimer = setInterval(refreshStatus, 10000);
    const netStatsTimer = setInterval(refreshNetworkStats, 300000);

    return () => {
      active = false;
      clearInterval(statusTimer);
      clearInterval(netStatsTimer);
    };
  }, []);

  const latestHeight = statusRaw?.latest_height || 0;
  const minHeight = statusRaw?.min_height || 0;
  const maxHeight = statusRaw?.max_height || 0;
  const coveredRange = maxHeight >= minHeight && maxHeight > 0 ? (maxHeight - minHeight + 1) : 0;
  const totalHistory = latestHeight > 0 ? (latestHeight + 1) : 0;
  const historyPercent = totalHistory > 0 ? (coveredRange / totalHistory) * 100 : 0;
  const maxTpsEstimate = 3900;
  const utilization = maxTpsEstimate > 0 ? (tps / maxTpsEstimate) * 100 : 0;
  const isHistoryComplete = historyPercent >= 99.99;

  return (
    <div className="min-h-screen bg-nothing-black text-nothing-white font-mono selection:bg-nothing-green selection:text-black">
      <div className="border-b border-white/5 bg-nothing-dark/50">
        <div className="container mx-auto px-4 py-12 space-y-8">
          {/* Branding / Hero Text */}
          <div className="text-center space-y-2 mb-8">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white uppercase italic">
                Flow<span className="text-nothing-green">Scan</span>
              </h1>
              <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em]">Decentralized Intelligence Protocol</p>
            </motion.div>
          </div>

          {/* Indexing Progress Banner */}
          <Link
            to="/stats"
            className="block border border-white/10 bg-nothing-dark/80 hover:border-nothing-green/40 transition-colors"
          >
            <div className="p-4 md:p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 border border-white/10 rounded-sm">
                    <Database className="h-4 w-4 text-nothing-green" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Indexing Progress</p>
                    <p className="text-sm text-white">
                      {totalHistory > 0 ? `${historyPercent.toFixed(2)}% of full history` : 'Initializing...'}
                    </p>
                    {totalHistory > 0 && (
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">
                        Range: {minHeight.toLocaleString()} → {maxHeight.toLocaleString()} (Latest {latestHeight.toLocaleString()})
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-48 bg-black/50 border border-white/10 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-nothing-green"
                      style={{ width: `${Math.min(100, historyPercent).toFixed(2)}%` }}
                    />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-nothing-green">View Details →</span>
                </div>
              </div>
            </div>
          </Link>

          {/* New Premium Stats Grid (Flow Pulse) */}
          {networkStats && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              {/* 1. Price Chart */}
              <FlowPriceChart data={networkStats} />

              {/* 2. Epoch Progress */}
              <EpochProgress
                epoch={networkStats.epoch}
                progress={networkStats.epoch_progress}
                updatedAt={networkStats.updated_at}
              />

              {/* 3. Network Stats Grid */}
              <NetworkStats totalStaked={networkStats.total_staked} activeNodes={networkStats.active_nodes} />
            </motion.div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Basic Stats Section */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
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
                  value={statusRaw?.latest_height || 0}
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-400 uppercase tracking-widest">Total TXs</p>
                {!isHistoryComplete && (
                  <span
                    className="flex items-center space-x-2 px-2 py-1 border border-yellow-500/30 bg-yellow-500/10 rounded-sm"
                    title="Partial data: history backfill is still in progress."
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                    <span className="text-[9px] uppercase tracking-wider text-yellow-400">Partial</span>
                  </span>
                )}
              </div>
              <p className="text-3xl font-bold font-mono text-white">
                <NumberFlow
                  value={statusRaw?.total_transactions || 0}
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
                  value={tps || 0}
                  format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                />
              </p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                Utilization: {Math.min(100, utilization).toFixed(2)}% of {maxTpsEstimate.toLocaleString()} TPS (est.)
              </p>
            </div>
          </div>

          <div className="group bg-nothing-dark border border-white/10 p-6 hover:border-white/30 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 border border-white/10 rounded-sm">
                <Box className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Average Block Time</p>
              <p className="text-3xl font-bold font-mono text-white">
                {avgBlockTime > 0 ? `${avgBlockTime.toFixed(2)}s` : 'N/A'}
              </p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                Based on recent blocks
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-400 uppercase tracking-widest">Total Addresses</p>
                {!isHistoryComplete && (
                  <span
                    className="flex items-center space-x-2 px-2 py-1 border border-yellow-500/30 bg-yellow-500/10 rounded-sm"
                    title="Partial data: history backfill is still in progress."
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                    <span className="text-[9px] uppercase tracking-wider text-yellow-400">Partial</span>
                  </span>
                )}
              </div>
              <p className="text-3xl font-bold font-mono text-white">
                <NumberFlow
                  value={statusRaw?.total_addresses || 0}
                  format={{ useGrouping: true }}
                />
              </p>
            </div>
          </div>
        </div>

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
            className="bg-nothing-dark border border-white/10 p-6 h-[1240px] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Box className="h-5 w-5 text-nothing-green" />
                <h2 className="text-lg font-bold text-white uppercase tracking-widest">Recent Blocks</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 pr-1">
              <AnimatePresence mode='popLayout'>
                {(blocks || []).map((block) => {
                  const isNew = newBlockIds.has(block.height);
                  const blockTimeRelative = formatRelativeTime(block.timestamp, nowTick);
                  const blockTimeAbsolute = formatAbsoluteTime(block.timestamp);
                  const blockIdFull = normalizeHex(block.id || '');
                  const blockIdShort = formatMiddle(blockIdFull, 12, 8);
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
                        className={`block border p-4 h-20 transition-colors duration-200 hover:bg-white/5 hover:border-white/20 relative overflow-hidden ${isNew
                          ? 'bg-nothing-green/10 border-nothing-green/50'
                          : 'bg-black/20 border-white/5'
                          }`}
                      >
                        {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-nothing-green animate-ping" />}
                        <div className="flex items-center justify-between h-full">
                          <div className="flex flex-col">
                            <span className="text-xs text-nothing-green font-mono">#{block.height.toLocaleString()}</span>
                            <span
                              className="text-[10px] text-gray-500 font-mono hidden sm:inline-block"
                              title={blockIdFull || ''}
                            >
                              Id: {blockIdShort || 'N/A'}
                            </span>
                          </div>
                          <div className="flex flex-col items-end">
                            <div className="text-xs text-gray-300 font-mono bg-white/5 px-2 py-0.5 rounded-sm">
                              {block.tx_count ?? block.txCount ?? 0} TXs
                            </div>
                            <span
                              className="text-[10px] text-gray-600 font-mono uppercase mt-1"
                              title={blockTimeAbsolute || ''}
                            >
                              {blockTimeRelative || ''}
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
              hasNext={blockHasNext}
            />
          </motion.div>

          {/* Recent Transactions */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-nothing-dark border border-white/10 p-6 h-[1240px] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Activity className="h-5 w-5 text-white" />
                <h2 className="text-lg font-bold text-white uppercase tracking-widest">Recent TXs</h2>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 pr-1">
              <AnimatePresence mode='popLayout'>
                {(transactions || []).map((tx) => {
                  const isNew = newTxIds.has(tx.id);
                  const isSealed = tx.status === 'SEALED';
                  const isError = Boolean(tx.error_message || tx.errorMessage);
                  const txTimeSource = tx.timestamp || tx.created_at || tx.block_timestamp;
                  const txTimeRelative = formatRelativeTime(txTimeSource, nowTick);
                  const txTimeAbsolute = formatAbsoluteTime(txTimeSource);
                  const txIdFull = normalizeHex(tx.id || '');
                  const txIdShort = formatMiddle(txIdFull, 12, 8);

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
                        className={`block border p-4 h-20 transition-colors duration-200 hover:bg-white/5 hover:border-white/20 relative overflow-hidden ${isNew
                          ? 'bg-white/10 border-white/40'
                          : 'bg-black/20 border-white/5'
                          }`}
                      >
                        {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-white animate-ping" />}
                        <div className="flex items-center justify-between h-full">
                          <div className="flex flex-col min-w-0">
                            <span
                              className="text-xs text-gray-400 font-mono truncate w-52 sm:w-64"
                              title={txIdFull || ''}
                            >
                              {txIdShort || tx.id}
                            </span>
                            <div className="flex items-center space-x-2">
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 border rounded-sm tracking-wider ${txType === 'Transfer' ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5' :
                                txType === 'Mint' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5' :
                                  'border-white/20 text-gray-300 bg-white/5'
                                }`}>
                                {txType}
                              </span>
                              {transferInfo && (
                                <span className="text-[10px] text-white font-mono truncate">
                                  {transferInfo}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                            <span
                              className="text-[10px] text-gray-500 font-mono"
                              title={txTimeAbsolute || ''}
                            >
                              {txTimeRelative || ''}
                            </span>
                            <span className={`mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm border ${isError ? 'border-red-500/50 text-red-500 bg-red-500/10' : isSealed ? 'border-nothing-green/50 text-nothing-green bg-nothing-green/10' : 'border-white/20 text-gray-400 bg-white/5'
                              }`}>
                              {isError ? 'Error' : isSealed ? 'Sealed' : 'Pending'}
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
              currentPage={txPage}
              onPageChange={handleTxPageChange}
              hasNext={txHasNext}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default Home;
