import { useState, useEffect } from 'react';
import { fcl } from '../flow/fclConfig';
import { Wallet, LogOut, AlertTriangle } from 'lucide-react';

interface WalletButtonProps {
  evmAddress?: string | null;
  evmChainId?: number | null;
  evmCorrectChain?: boolean;
  onEvmConnect?: () => void;
  onEvmDisconnect?: () => void;
  onEvmSwitchChain?: () => void;
  hasMetaMask?: boolean;
}

export default function WalletButton({
  evmAddress,
  evmCorrectChain,
  onEvmConnect,
  onEvmDisconnect,
  onEvmSwitchChain,
  hasMetaMask,
}: WalletButtonProps) {
  const [user, setUser] = useState<{ addr?: string | null }>({});

  useEffect(() => {
    const unsub = fcl.currentUser.subscribe(setUser);
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const fclConnected = !!user?.addr;
  const evmConnected = !!evmAddress;

  return (
    <div className="flex items-center gap-2">
      {/* ── FCL / Flow Wallet ── */}
      {fclConnected ? (
        <div className="flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-1.5 py-0.5">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Flow</span>
          <span className="text-xs text-emerald-400 font-mono">
            {user.addr!.slice(0, 6)}...{user.addr!.slice(-4)}
          </span>
          <button
            onClick={() => fcl.unauthenticate()}
            className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Disconnect Flow wallet"
          >
            <LogOut className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => fcl.authenticate()}
          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors"
          title="Connect Flow wallet"
        >
          <Wallet className="w-3 h-3" />
          <span>Flow</span>
        </button>
      )}

      {/* ── MetaMask / EVM Wallet ── */}
      {evmConnected ? (
        <div className="flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-1.5 py-0.5">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">EVM</span>
          {evmCorrectChain === false && (
            <button
              onClick={onEvmSwitchChain}
              className="flex items-center gap-0.5 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
              title="Switch to correct chain"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Switch</span>
            </button>
          )}
          <span className="text-xs text-orange-400 font-mono">
            {evmAddress!.slice(0, 6)}...{evmAddress!.slice(-4)}
          </span>
          <button
            onClick={onEvmDisconnect}
            className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Disconnect EVM wallet"
          >
            <LogOut className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={onEvmConnect}
          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors"
          title={hasMetaMask ? 'Connect MetaMask' : 'Install MetaMask'}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.28 1L13.37 7.62l1.65-3.92L22.28 1zM1.72 1l8.82 6.69L8.98 3.7 1.72 1zM19.05 16.37l-2.37 3.63 5.07 1.4 1.46-4.94-4.16-.09zM.8 16.46l1.45 4.94 5.07-1.4-2.37-3.63-4.15.09z"/>
          </svg>
          <span>EVM</span>
        </button>
      )}
    </div>
  );
}
