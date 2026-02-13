import { useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useWebSocketStatus } from '../hooks/useWebSocket';
import { resolveApiBaseUrl } from '../api';

function Header() {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { isConnected } = useWebSocketStatus();
  const isNavigating = useRouterState({ select: (s) => s.status === 'pending' });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // Public key: 128 hex chars (with optional 0x prefix)
    if (/^(0x)?[a-fA-F0-9]{128}$/.test(query)) {
      const key = query.replace(/^0x/i, '');
      navigate({ to: '/key/$publicKey', params: { publicKey: key } });
      setSearchQuery('');
      return;
    }

    if (/^\d+$/.test(query)) {
      navigate({ to: '/blocks/$height', params: { height: query } });
    } else if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
      // EVM tx hash -> try Flow tx route (backend resolves if mapping exists)
      navigate({ to: '/tx/$txId', params: { txId: query } });
    } else if (/^[a-fA-F0-9]{64}$/.test(query)) {
      navigate({ to: '/tx/$txId', params: { txId: query } });
    } else if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
      // COA (EVM) address -> resolve to Flow address via /flow/coa/{address}
      try {
        const baseUrl = await resolveApiBaseUrl();
        const res = await fetch(`${baseUrl}/flow/coa/${encodeURIComponent(query)}`);
        if (res.ok) {
          const payload = await res.json();
          const items = payload?.data ?? (Array.isArray(payload) ? payload : []);
          const flowAddress = items?.[0]?.flow_address;
          if (flowAddress) {
            navigate({ to: '/accounts/$address', params: { address: flowAddress } });
          } else {
            navigate({ to: '/accounts/$address', params: { address: query } });
          }
        } else {
          navigate({ to: '/accounts/$address', params: { address: query } });
        }
      } catch {
        navigate({ to: '/accounts/$address', params: { address: query } });
      }
    } else if (/^0x[a-fA-F0-9]{16}$/.test(query)) {
      navigate({ to: '/accounts/$address', params: { address: query } });
    } else if (query.startsWith('0x')) {
      navigate({ to: '/accounts/$address', params: { address: query } });
    } else {
      navigate({ to: '/tx/$txId', params: { txId: query } });
    }
    setSearchQuery('');
  };

  return (
    <header className="sticky top-0 z-40 relative bg-zinc-50/80 dark:bg-black/80 backdrop-blur-md border-b border-zinc-200 dark:border-white/5 py-4 px-6 md:px-8 transition-colors duration-300">
      {isNavigating && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-nothing-green to-transparent animate-pulse" />
      )}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">

        {/* Search Bar - Now on the left/center as the main focus of header since sidebar handles nav */}
        <form
          onSubmit={handleSearch}
          className="w-full md:max-w-xl relative"
        >
          <div className="relative group">
            <input
              type="text"
              placeholder="Search by block / tx / address / public key"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-5 py-3 bg-zinc-200 dark:bg-white/5 border border-zinc-300 dark:border-white/10 text-zinc-900 dark:text-white text-sm placeholder-zinc-500 focus:border-nothing-green/50 focus:bg-white dark:focus:bg-black/50 focus:outline-none rounded-sm transition-all"
            />
            <button
              type="submit"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Network Status */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-zinc-500">
            <div className="hidden md:flex items-center gap-2">
              <span>Network</span>
              <span className="text-zinc-900 dark:text-white">Mainnet</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-sm ${isConnected ? 'bg-nothing-green/10 border-nothing-green/30' : 'bg-zinc-200 dark:bg-white/5 border-zinc-300 dark:border-white/10'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-nothing-green animate-pulse' : 'bg-gray-500'}`} />
              <span className={isConnected ? 'text-nothing-green' : 'text-gray-500'}>
                {isConnected ? 'System Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
