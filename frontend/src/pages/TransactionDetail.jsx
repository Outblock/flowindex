import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Activity, User, Box, Clock, CheckCircle, XCircle, Hash, ArrowRightLeft, Coins, Image as ImageIcon, Zap, Database } from 'lucide-react';

function TransactionDetail() {
  const { txId } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('script');

  useEffect(() => {
    const loadTransaction = async () => {
      try {
        const rawTx = await api.getTransaction(txId);
        // Transform API response
        // Note: Backend now returns consistent keys (snake_case) for both DB and RPC
        const transformedTx = {
          ...rawTx,
          type: rawTx.type || (rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),

          // Map consistent backend keys to our UI variable names if desired, 
          // or just ensure we use the right keys below. 
          // Let's normalize to camelCase for internal use effectively where convenient, or stick to raw.
          // Actually, kept it simple:
          payer: rawTx.payer_address || rawTx.payer || 'Unknown', // Fallback just in case, but backend should send payer_address
          proposer: rawTx.proposer_address || rawTx.proposer || 'Unknown',
          proposerKeyIndex: rawTx.proposer_key_index ?? -1,
          proposerSequenceNumber: rawTx.proposer_sequence_number ?? -1,

          blockHeight: rawTx.block_height,
          gasLimit: rawTx.gas_limit,
          gasUsed: rawTx.gas_used,

          // Ensure events array exists
          events: rawTx.events || [],
          // Ensure status exists
          status: rawTx.status || 'UNKNOWN'
        };
        setTransaction(transformedTx);

        // Default tab selection
        if (transformedTx.script) {
          setActiveTab('script');
        } else {
          setActiveTab('events');
        }
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch transaction:', err);
        setError('Transaction not found');
        setLoading(false);
      }
    };
    loadTransaction();
  }, [txId]);



  const formatAddress = (addr) => {
    if (!addr) return 'Unknown';
    // Ensure lowercase
    let formatted = addr.toLowerCase();
    // Add 0x prefix if missing
    if (!formatted.startsWith('0x')) {
      formatted = '0x' + formatted;
    }
    return formatted;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-800 border-t-nothing-green rounded-full animate-spin"></div>
          <p className="text-nothing-green text-xs uppercase tracking-[0.2em] animate-pulse">Retrieving Transaction Data...</p>
        </div>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="border border-yellow-500/30 bg-nothing-dark p-8 max-w-md text-center">
          <XCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white uppercase tracking-widest mb-2">Transaction Not Yet Indexed</h2>
          <p className="text-zinc-400 text-sm mb-4">This transaction exists on the blockchain but hasn't been indexed yet.</p>
          <p className="text-zinc-500 text-xs mb-6">
            The indexer is currently processing historical blocks. Please check back in a few minutes.
          </p>
          <div className="space-y-2">
            <Link to="/" className="inline-block w-full border border-white/20 hover:bg-white/10 text-white text-xs uppercase tracking-widest py-3 transition-all">
              Return to Dashboard
            </Link>
            <Link to="/stats" className="inline-block w-full border border-nothing-green/20 hover:bg-nothing-green/10 text-nothing-green text-xs uppercase tracking-widest py-3 transition-all">
              View Indexing Progress
            </Link>
          </div>
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
            {transaction.is_evm ? <Box className="h-32 w-32" /> : <Hash className="h-32 w-32" />}
          </div>

          <div className="relative z-10">
            <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
              <span className="text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                {transaction.type}
              </span>
              <span className={`text-xs uppercase tracking-[0.2em] border px-2 py-1 rounded-sm w-fit ${transaction.status === 'SEALED'
                ? 'text-white border-white/30'
                : 'text-yellow-500 border-yellow-500/30'
                }`}>
                {transaction.status}
              </span>
              {transaction.is_evm && (
                <span className="text-blue-400 text-xs uppercase tracking-[0.2em] border border-blue-400/30 px-2 py-1 rounded-sm w-fit">
                  EVM Transaction
                </span>
              )}
            </div>

            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 break-all">
              {transaction.is_evm ? transaction.evm_hash : transaction.id}
            </h1>
            <p className="text-zinc-500 text-xs uppercase tracking-widest">
              {transaction.is_evm ? 'EVM Hash' : 'Transaction ID'}
            </p>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Flow Information */}
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
              Cadence / Flow Information
            </h2>

            <div className="space-y-6">
              <div className="group">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Flow Transaction ID</p>
                <code className="text-sm text-zinc-300 break-all">{transaction.id}</code>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Block Height</p>
                  <Link
                    to={`/blocks/${transaction.blockHeight}`}
                    className="text-sm text-white hover:text-nothing-green transition-colors"
                  >
                    {transaction.blockHeight?.toLocaleString()}
                  </Link>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Computation Usage</p>
                  <span className="text-sm text-zinc-300">{transaction.computation_usage?.toLocaleString() || 0}</span>
                </div>
              </div>

              <div className="group">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Payer</p>
                <Link to={`/accounts/${formatAddress(transaction.payer)}`} className="text-sm text-nothing-green hover:underline break-all uppercase tracking-tight">
                  {formatAddress(transaction.payer)}
                </Link>
              </div>

              <div className="group">
                <div className="flex justify-between items-end mb-1">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Proposer</p>
                  <span className="text-[9px] text-zinc-600 uppercase tracking-tight bg-white/5 px-2 py-0.5 rounded">
                    Seq: {transaction.proposerSequenceNumber} • Key: {transaction.proposerKeyIndex}
                  </span>
                </div>
                <Link to={`/accounts/${formatAddress(transaction.proposer)}`} className="text-sm text-zinc-300 hover:text-white break-all uppercase tracking-tight block">
                  {formatAddress(transaction.proposer)}
                </Link>
              </div>

              {transaction.authorizers && transaction.authorizers.length > 0 && (
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Authorizers</p>
                  <div className="flex flex-col gap-1">
                    {transaction.authorizers.map(auth => (
                      <Link key={auth} to={`/accounts/${formatAddress(auth)}`} className="text-sm text-zinc-400 hover:text-white break-all uppercase tracking-tight">
                        {formatAddress(auth)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* EVM Execution Info (Conditional) */}
          <div className={`border p-6 bg-nothing-dark transition-all duration-500 ${transaction.is_evm ? 'border-blue-500/30' : 'border-white/10 opacity-50'}`}>
            <h2 className={`text-sm uppercase tracking-widest mb-6 border-b pb-2 ${transaction.is_evm ? 'text-blue-400 border-blue-500/20' : 'text-zinc-500 border-white/5'}`}>
              EVM Execution Details
            </h2>

            {transaction.is_evm ? (
              <div className="space-y-6">
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">EVM Hash</p>
                  <code className="text-sm text-blue-300 break-all">{transaction.evm_hash || 'N/A'}</code>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">From (EVM)</p>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <code className="text-sm text-zinc-300 break-all uppercase">{transaction.evm_from || 'N/A'}</code>
                  </div>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">To (EVM)</p>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <code className="text-sm text-zinc-300 break-all uppercase">{transaction.evm_to || 'Contract Creation'}</code>
                  </div>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Value Transferred</p>
                  <code className="text-sm text-white">{transaction.evm_value ? `${parseInt(transaction.evm_value, 16) / 1e18} Flow` : '0'}</code>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center text-zinc-700">
                <Box className="h-12 w-12 mb-2 opacity-20" />
                <p className="text-[10px] uppercase tracking-[0.2em]">No EVM MetadataDetected</p>
              </div>
            )}
          </div>
        </div>

        {/* Payload / Events Tabs */}
        <div className="mt-12">
          <div className="flex border-b border-white/10 mb-0">
            <button
              onClick={() => setActiveTab('script')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'script'
                ? 'text-white border-b-2 border-nothing-green bg-white/5'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <Zap className={`h-4 w-4 ${activeTab === 'script' ? 'text-nothing-green' : ''}`} />
                Cadence Script
              </span>
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === 'events'
                ? 'text-white border-b-2 border-nothing-green bg-white/5'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                }`}
            >
              <span className="flex items-center gap-2">
                <Database className={`h-4 w-4 ${activeTab === 'events' ? 'text-nothing-green' : ''}`} />
                Key Events ({transaction.events ? transaction.events.length : 0})
              </span>
            </button>
          </div>

          <div className="bg-nothing-dark border border-white/10 border-t-0 p-6 min-h-[300px]">
            {activeTab === 'script' && (
              <div className="font-mono">
                {transaction.script ? (
                  <pre className="bg-black/50 border border-white/5 p-4 overflow-x-auto text-[10px] text-zinc-400 rounded-sm leading-relaxed">
                    <code>{transaction.script}</code>
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                    <Zap className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-xs uppercase tracking-widest">No Script Content Available</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'events' && (
              <div className="space-y-6">
                {transaction.events && transaction.events.length > 0 ? (
                  transaction.events.map((event, idx) => (
                    <div key={idx} className="relative pl-6 border-l border-white/5 hover:border-nothing-green/30 transition-all group/event">
                      <div className="absolute left-0 top-0 -translate-x-1/2 w-2 h-2 bg-nothing-green/20 border border-nothing-green/40 rounded-full group-hover/event:bg-nothing-green group-hover/event:scale-125 transition-all"></div>

                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
                        <div className="flex flex-col">
                          <p className="text-xs font-bold text-nothing-green mb-1 uppercase tracking-wider">
                            {event.event_name || event.type.split('.').pop()}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-600 uppercase">Contract</span>
                            <Link
                              to={`/accounts/${formatAddress(event.contract_address)}`}
                              className="text-[10px] text-zinc-400 hover:text-white transition-colors underline decoration-white/10 underline-offset-2"
                            >
                              {formatAddress(event.contract_address) || 'System'} {event.contract_name ? `(${event.contract_name})` : ''}
                            </Link>
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-700 font-mono bg-white/5 px-2 py-0.5 rounded uppercase">
                          Index #{event.event_index}
                        </span>
                      </div>

                      <div className="bg-black/40 rounded-sm border border-white/5 p-4 group-hover/event:bg-black/60 transition-colors">
                        <pre className="text-[11px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-all">
                          {JSON.stringify(event.values || event.payload || event.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                    <Database className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-xs uppercase tracking-widest">No Events Emitted</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TransactionDetail;
