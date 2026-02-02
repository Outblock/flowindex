import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, User, Activity, Box, Wallet, Key, Code, ArrowRightLeft, Coins, Image as ImageIcon } from 'lucide-react';

function AccountDetail() {
  const { address } = useParams();
  const [account, setAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadAccountData = async () => {
      try {
        // For now, we'll create a mock account page since the API might not have this endpoint yet
        // In production, you'd call: api.getAccount(address)
        setAccount({
          address: address,
          balance: '1000.00000000',
          createdAt: new Date().toISOString(),
          contracts: [],
          keys: []
        });

        // Get transactions involving this account
        const txRes = await api.getTransactions();
        const accountTxs = (txRes.data || [])
          .map(tx => ({
            ...tx,
            type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
            payer: tx.payer_address || tx.proposer_address,
            proposer: tx.proposer_address,
            blockHeight: tx.block_height
          }))
          .filter(tx =>
            tx.payer === address ||
            tx.proposer === address ||
            (tx.authorizers && tx.authorizers.includes(address))
          );
        setTransactions(accountTxs);
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch account:', err);
        setError('Account not found');
        setLoading(false);
      }
    };
    loadAccountData();
  }, [address]);

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
            <p className="text-2xl font-bold text-white overflow-hidden text-ellipsis">{account.balance} <span className="text-sm text-nothing-green">FLOW</span></p>
          </div>
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Transactions</p>
            <p className="text-2xl font-bold text-white">{transactions.length}</p>
          </div>
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Contracts</p>
            <p className="text-2xl font-bold text-white">{account.contracts?.length || 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Info */}
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
              Account Info
            </h2>
            <div className="space-y-4">
              <div className="group">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Created At</p>
                <p className="text-sm text-white font-mono">
                  {account.createdAt ? new Date(account.createdAt).toLocaleString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          {/* Keys */}
          <div className="border border-white/10 p-6 bg-nothing-dark">
            <h2 className="text-white text-sm uppercase tracking-widest mb-6 border-b border-white/5 pb-2">
              Public Keys
            </h2>
            {account.keys && account.keys.length > 0 ? (
              <div className="space-y-2">
                {account.keys.map((key, idx) => (
                  <div key={idx} className="bg-black/50 border border-white/5 p-2 text-xs text-zinc-400 break-all font-mono">
                    {key.publicKey}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic">No keys found</p>
            )}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="border border-white/10 bg-nothing-dark">
          <div className="p-6 border-b border-white/10 flex justify-between items-center">
            <h2 className="text-white text-sm uppercase tracking-widest">Recent Activity</h2>
            <span className="text-xs text-zinc-500">{transactions.length} Found</span>
          </div>

          <div className="overflow-x-auto">
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
                  {transactions.slice(0, 20).map((tx) => {
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
              <div className="p-8 text-center text-zinc-500 italic">No transactions found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccountDetail;
