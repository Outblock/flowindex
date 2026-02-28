import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Key,
  Globe,
  GitBranch,
  FileText,
  LogOut,
  Loader2,
  ChevronDown,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/developer', icon: LayoutDashboard },
  { label: 'API Keys', path: '/developer/keys', icon: Key },
  { label: 'Endpoints', path: '/developer/endpoints', icon: Globe },
  { label: 'Workflows', path: '/developer/subscriptions', icon: GitBranch },
  { label: 'Delivery Logs', path: '/developer/logs', icon: FileText },
]

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/developer/login' })
    }
  }, [loading, user, navigate])

  // Close menus on route change
  useEffect(() => {
    setMobileMenuOpen(false)
    setUserMenuOpen(false)
  }, [currentPath])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top tab bar */}
      <div className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm sticky top-0 z-30 shrink-0">
        <div className="flex items-center justify-between px-4 h-11">
          {/* Left: portal label + tabs */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mr-3 shrink-0 hidden sm:block">
              Dev Portal
            </span>

            {/* Desktop tabs */}
            <nav className="hidden md:flex items-center gap-0.5">
              {navItems.map((item) => {
                const isActive = currentPath === item.path || (item.path !== '/developer' && currentPath.startsWith(item.path))
                const Icon = item.icon
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      isActive
                        ? 'text-[#00ef8b] bg-[#00ef8b]/10'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            {/* Mobile: current page + dropdown trigger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-white hover:bg-neutral-800 transition-colors"
            >
              {(() => {
                const active = navItems.find((item) =>
                  currentPath === item.path || (item.path !== '/developer' && currentPath.startsWith(item.path))
                ) ?? navItems[0]
                const Icon = active.icon
                return (
                  <>
                    <Icon className="w-3.5 h-3.5" />
                    {active.label}
                    <ChevronDown className={`w-3 h-3 text-neutral-500 transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`} />
                  </>
                )
              })()}
            </button>
          </div>

          {/* Right: user menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <span className="truncate max-w-[120px]">{user.email}</span>
              <ChevronDown className={`w-3 h-3 text-neutral-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 z-50 w-44 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden"
                  >
                    <div className="px-3 py-2 border-b border-neutral-800">
                      <p className="text-xs text-neutral-500 truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        signOut()
                        navigate({ to: '/developer/login' })
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign out
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Mobile dropdown nav */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="md:hidden overflow-hidden border-t border-neutral-800"
            >
              <div className="p-2 space-y-0.5">
                {navItems.map((item) => {
                  const isActive = currentPath === item.path || (item.path !== '/developer' && currentPath.startsWith(item.path))
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'text-[#00ef8b] bg-[#00ef8b]/10'
                          : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      {/* Main content — full width, no padding (children manage their own) */}
      <main className="flex-1 flex flex-col min-h-0">
        {children}
      </main>
    </div>
  )
}
