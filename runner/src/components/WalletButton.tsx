import { useState, useEffect } from 'react';
import { fcl } from '../flow/fclConfig';
import { Wallet, LogOut } from 'lucide-react';

export default function WalletButton() {
  const [user, setUser] = useState<{ addr?: string | null }>({});

  useEffect(() => {
    const unsub = fcl.currentUser.subscribe(setUser);
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const connected = !!user?.addr;

  if (connected) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-emerald-400 font-mono">
          {user.addr!.slice(0, 6)}...{user.addr!.slice(-4)}
        </span>
        <button
          onClick={() => fcl.unauthenticate()}
          className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
          title="Disconnect wallet"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => fcl.authenticate()}
      className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2.5 py-1 transition-colors"
    >
      <Wallet className="w-3.5 h-3.5" />
      Connect Wallet
    </button>
  );
}
