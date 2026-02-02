import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Activity, User, Box, Clock, CheckCircle, XCircle, Hash, ArrowRightLeft, Coins, Image as ImageIcon } from 'lucide-react';

function TransactionDetail() {
  const { txId } = useParams();
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadTransaction = async () => {
      try {
        const response = await api.getTransaction(txId);
        const rawTx = response.data;
        // Transform API response
        const transformedTx = {
          ...rawTx,
          type: rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
          payer: rawTx.payer_address || rawTx.proposer_address,
          proposer: rawTx.proposer_address,
          blockHeight: rawTx.block_height,
          gasLimit: rawTx.gas_limit,
          gasUsed: rawTx.gas_used
        };
        setTransaction(transformedTx);
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch transaction:', err);
        setError('Transaction not found');
        setLoading(false);
      }
    };
    loadTransaction();
  }, [txId]);

  const getTypeIcon = (type) => {
    const iconClass = "h-5 w-5";
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
      case 'TRANSFER': return 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/50';
      case 'CREATE_ACCOUNT': return 'from-purple-500/20 to-purple-600/10 border-purple-500/50';
      case 'TOKEN_MINT': return 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/50';
      case 'NFT_MINT': return 'from-pink-500/20 to-pink-600/10 border-pink-500/50';
      default: return 'from-slate-500/20 to-slate-600/10 border-slate-500/50';
    }
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
        <div className="border border-red-500/30 bg-nothing-dark p-8 max-w-md text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white uppercase tracking-widest mb-2">Transaction Not Found</h2>
          <p className="text-zinc-500 text-xs mb-6">The requested transaction could not be located in the current index.</p>
          <Link to="/" className="inline-block w-full border border-white/20 hover:bg-white/10 text-white text-xs uppercase tracking-widest py-3 transition-all">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  var typeColor = 'from-zinc-500/20 to-zinc-600/10 border-zinc-500/50';
  if (transaction && transaction.type) {
    typeColor = getTypeColor(transaction.type);
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* General Info */}
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
              General Information
            </h2>

            <div className="space-y-6">
              {transaction.is_evm && (
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Flow Transaction ID</p>
                  <code className="text-sm text-zinc-300 break-all">{transaction.id}</code>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Block Height</p>
                  <Link
                    to={`/blocks/${transaction.blockHeight}`}
                    className="text-sm text-white hover:text-nothing-green transition-colors decoration-slice"
                  >
                    {transaction.blockHeight.toLocaleString()}
                  </Link>
                </div>
                <div className="group">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Gas Used</p>
                  <span className="text-sm text-zinc-300">{transaction.gasUsed?.toLocaleString() || 0}</span>
                </div>
              </div>

              <div className="group">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Timestamp</p>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-zinc-300">
                    {transaction.timestamp ? new Date(transaction.timestamp).toLocaleString() : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Account / EVM Info */}
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
              {transaction.is_evm ? 'EVM Execution' : 'Flow Accounts'}
            </h2>

            <div className="space-y-6">
              {transaction.is_evm ? (
                <>
                  <div className="group">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">From (EVM)</p>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <code className="text-sm text-zinc-300 break-all">{transaction.evm_from || 'N/A'}</code>
                    </div>
                  </div>
                  <div className="group">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">To (EVM)</p>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                      <code className="text-sm text-zinc-300 break-all">{transaction.evm_to || 'Contract Creation'}</code>
                    </div>
                  </div>
                  <div className="group">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Value</p>
                    <code className="text-sm text-white">{transaction.evm_value ? `${parseInt(transaction.evm_value, 16) / 1e18} Flow` : '0'}</code>
                  </div>
                </>
              ) : (
                <>
                  <div className="group">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Payer</p>
                    <Link to={`/accounts/${transaction.payer}`} className="text-sm text-nothing-green hover:underline break-all">
                      {transaction.payer}
                    </Link>
                  </div>
                  <div className="group">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Proposer</p>
                    <Link to={`/accounts/${transaction.proposer}`} className="text-sm text-zinc-300 hover:text-white break-all">
                      {transaction.proposer}
                    </Link>
                  </div>
                  {transaction.authorizers && transaction.authorizers.length > 0 && (
                    <div className="group">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Authorizers</p>
                      <div className="flex flex-col gap-1">
                        {transaction.authorizers.map(auth => (
                          <Link key={auth} to={`/accounts/${auth}`} className="text-sm text-zinc-400 hover:text-white break-all">
                            {auth}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Script / Events (Collapsible or Standard) */}
        {!transaction.is_evm && transaction.script && (
          <div className="border border-white/10 p-6 mt-8 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-4">Cadence Script</h2>
            <pre className="bg-black border border-white/5 p-4 overflow-x-auto text-[10px] text-zinc-400 rounded-sm">
              <code>{transaction.script}</code>
            </pre>
          </div>
        )}

        {/* Events */}
        {transaction.events && transaction.events.length > 0 && (
          <div className="border border-white/10 p-6 mt-8 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-4">Events ({transaction.events.length})</h2>
            <div className="space-y-4">
              {transaction.events.map((event, idx) => (
                <div key={idx} className="bg-black border border-white/5 p-4 hover:border-nothing-green/30 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-xs font-bold text-nothing-green break-all">{event.type}</p>
                    <span className="text-[10px] text-zinc-600">Idx: {event.event_index}</span>
                  </div>
                  <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap break-all font-mono">
                    {JSON.stringify(event.payload || event.data, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransactionDetail;
