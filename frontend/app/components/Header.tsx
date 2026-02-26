import { useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Search, Menu, X } from 'lucide-react';
import { useWebSocketStatus } from '../hooks/useWebSocket';
import { useMobileMenu } from '../contexts/MobileMenuContext';
import { resolveApiBaseUrl } from '../api';

function Header() {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { isConnected } = useWebSocketStatus();
  const isNavigating = useRouterState({ select: (s) => s.status === 'pending' });
  const { isOpen: isMobileOpen, toggle: toggleMobileMenu } = useMobileMenu();

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
      // EVM tx hash (with 0x prefix) -> resolve to Cadence tx via /txs/evm route
      navigate({ to: '/txs/evm/$txId', params: { txId: query } } as any);
    } else if (/^[a-fA-F0-9]{64}$/.test(query)) {
      // 64 hex chars: try Cadence tx first, fall back to EVM tx
      try {
        const baseUrl = await resolveApiBaseUrl();
        const res = await fetch(`${baseUrl}/flow/v1/transaction/${query}`, { method: 'HEAD' });
        if (res.ok) {
          navigate({ to: '/txs/$txId', params: { txId: query }, search: { tab: undefined } });
        } else {
          navigate({ to: '/txs/evm/$txId', params: { txId: `0x${query}` } } as any);
        }
      } catch {
        navigate({ to: '/txs/$txId', params: { txId: query }, search: { tab: undefined } });
      }
    } else if (/^(0x)?[a-fA-F0-9]{40}$/.test(query)) {
      // COA (EVM) address (with or without 0x prefix)
      const coaAddress = query.startsWith('0x') ? query : `0x${query}`;
      // COA (EVM) address -> resolve to Flow address via /flow/coa/{address}
      try {
        const baseUrl = await resolveApiBaseUrl();
        const res = await fetch(`${baseUrl}/flow/coa/${encodeURIComponent(coaAddress)}`);
        if (res.ok) {
          const payload = await res.json();
          const items = payload?.data ?? (Array.isArray(payload) ? payload : []);
          const flowAddress = items?.[0]?.flow_address;
          if (flowAddress) {
            navigate({ to: '/accounts/$address', params: { address: flowAddress } });
          } else {
            navigate({ to: '/accounts/$address', params: { address: coaAddress } });
          }
        } else {
          navigate({ to: '/accounts/$address', params: { address: coaAddress } });
        }
      } catch {
        navigate({ to: '/accounts/$address', params: { address: coaAddress } });
      }
    } else if (/^(0x)?[a-fA-F0-9]{16}$/.test(query)) {
      const address = query.startsWith('0x') ? query : `0x${query}`;
      navigate({ to: '/accounts/$address', params: { address } });
    } else if (query.startsWith('0x')) {
      navigate({ to: '/accounts/$address', params: { address: query } });
    } else {
      navigate({ to: '/txs/$txId', params: { txId: query }, search: { tab: undefined } });
    }
    setSearchQuery('');
  };

  return (
    <header className="sticky top-0 z-40 relative bg-zinc-50/80 dark:bg-black/80 backdrop-blur-md border-b border-zinc-200 dark:border-white/5 py-3 px-3 md:py-4 md:px-8 transition-colors duration-300 overflow-hidden">
      {isNavigating && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-nothing-green to-transparent animate-pulse" />
      )}
      <div className="flex items-center justify-between gap-3 md:gap-4">

        {/* Mobile hamburger - inline in header for perfect alignment */}
        <button
          onClick={toggleMobileMenu}
          className="md:hidden p-2.5 rounded-sm bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-white/10 shrink-0"
          aria-label="Toggle menu"
        >
          {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Search Bar */}
        <form
          onSubmit={handleSearch}
          className="flex-1 md:max-w-xl relative"
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
        <div className="hidden md:flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-zinc-500">
            <div className="flex items-center gap-2">
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
