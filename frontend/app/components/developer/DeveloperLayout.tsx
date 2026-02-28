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
  Menu,
  X,
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/developer/login' })
    }
  }, [loading, user, navigate])

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
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

  const sidebarContent = (
    <>
      {/* User info */}
      <div className="p-4 border-b border-neutral-800">
        <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Developer Portal</p>
        <p className="text-sm text-white truncate" title={user.email}>
          {user.email}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = currentPath === item.path || (item.path !== '/developer' && currentPath.startsWith(item.path))
          const Icon = item.icon
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
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
      </nav>

      {/* Sign out */}
      <div className="p-2 border-t border-neutral-800">
        <button
          onClick={() => {
            signOut()
            navigate({ to: '/developer/login' })
          }}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm sticky top-0 z-30">
        <p className="text-xs text-neutral-500 uppercase tracking-wider">Developer Portal</p>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 z-40 bg-black/60"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-[280px] bg-neutral-900 border-r border-neutral-800 flex flex-col"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="hidden md:flex w-64 border-r border-neutral-800 bg-neutral-900/50 flex-col shrink-0"
      >
        {sidebarContent}
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  )
}
