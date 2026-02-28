import { useEffect } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Key,
  Globe,
  Bell,
  FileText,
  LogOut,
  Loader2,
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
  { label: 'Subscriptions', path: '/developer/subscriptions', icon: Bell },
  { label: 'Delivery Logs', path: '/developer/logs', icon: FileText },
]

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/developer/login' })
    }
  }, [loading, user, navigate])

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
    <div className="flex-1 flex min-h-0">
      {/* Sidebar */}
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="w-64 border-r border-neutral-800 bg-neutral-900/50 flex flex-col shrink-0"
      >
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
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  )
}
