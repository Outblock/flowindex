import { NavLink } from 'react-router-dom';
import {
  Wallet,
  Image,
  Sparkles,
  Clock,
  Settings,
  ArrowUpRight,
  ArrowDownLeft,
  Link2,
} from 'lucide-react';
import { cn } from '@flowindex/flow-ui';
import NetworkBadge from './NetworkBadge';

const NAV_ITEMS = [
  { to: '/', label: 'Tokens', icon: Wallet },
  { to: '/nfts', label: 'NFTs', icon: Image },
  { to: '/ai', label: 'AI', icon: Sparkles },
  { to: '/activity', label: 'Activity', icon: Clock },
  { to: '/connect', label: 'Connect', icon: Link2 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

const ACTION_ITEMS = [
  { to: '/send', label: 'Send', icon: ArrowUpRight },
  { to: '/receive', label: 'Receive', icon: ArrowDownLeft },
] as const;

/** Desktop icon-only sidebar (Coinbase style) */
export function DesktopSidebar() {
  return (
    <aside className="hidden md:flex md:flex-col md:w-[72px] md:fixed md:inset-y-0 bg-wallet-bg border-r border-wallet-border items-center py-5 gap-1">
      {/* Logo */}
      <div className="w-10 h-10 rounded-xl bg-wallet-accent/15 flex items-center justify-center mb-6">
        <span className="text-wallet-accent font-extrabold text-sm">FI</span>
      </div>

      {/* Main nav icons */}
      <nav className="flex flex-col items-center gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200',
                isActive
                  ? 'bg-wallet-accent/15 text-wallet-accent'
                  : 'text-wallet-muted hover:text-white hover:bg-wallet-surface',
              )
            }
            title={label}
          >
            <Icon className="w-5 h-5" />
          </NavLink>
        ))}
      </nav>

      {/* Divider */}
      <div className="w-6 h-px bg-wallet-border my-3" />

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-1">
        {ACTION_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200',
                isActive
                  ? 'bg-wallet-accent/15 text-wallet-accent'
                  : 'text-wallet-muted hover:text-white hover:bg-wallet-surface',
              )
            }
            title={label}
          >
            <Icon className="w-5 h-5" />
          </NavLink>
        ))}
      </div>

      {/* Network badge at bottom */}
      <div className="mt-auto">
        <NetworkBadge compact />
      </div>
    </aside>
  );
}

/** Mobile bottom tab bar */
export function MobileBottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-wallet-bg/95 backdrop-blur-xl border-t border-wallet-border safe-bottom">
      <div className="flex items-center justify-around px-2 pt-2 pb-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl text-[11px] font-medium transition-all duration-200 min-w-[52px]',
                isActive
                  ? 'text-wallet-accent'
                  : 'text-wallet-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                <div
                  className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200',
                    isActive && 'bg-wallet-accent/12',
                  )}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
