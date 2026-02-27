# Developer Portal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Developer Portal to the FlowScan frontend where developers can sign up, manage API keys, webhook endpoints, subscriptions, and view delivery logs.

**Architecture:** Integrated into `frontend/app/routes/developer/*` using TanStack Router file-based routing. Auth via GoTrue (Supabase self-hosted) with JWT stored in localStorage via AuthContext. API calls to backend `/api/v1/*` endpoints with Bearer token auth.

**Tech Stack:** React 19, TanStack Router, Shadcn/UI, Tailwind CSS, GoTrue API, existing backend webhook API

**Design Reference:** `docs/plans/2026-02-28-developer-portal-design.md`

---

### Task 1: Install Missing Shadcn/UI Components

We need table, input, label, select, tabs, badge, dropdown-menu, separator, switch, and textarea components that aren't in the project yet.

**Files:**
- Modify: `frontend/app/components/ui/` (new component files added by shadcn CLI)

**Step 1: Check which components already exist**

```bash
cd frontend && ls app/components/ui/
```

**Step 2: Install missing components via shadcn CLI**

```bash
cd frontend
npx shadcn@latest add table input label select tabs badge dropdown-menu separator switch textarea -y
```

**Step 3: Verify installation**

```bash
ls app/components/ui/table* app/components/ui/input* app/components/ui/label* app/components/ui/select* app/components/ui/tabs* app/components/ui/badge* app/components/ui/dropdown-menu* app/components/ui/separator* app/components/ui/switch* app/components/ui/textarea*
```

**Step 4: Commit**

```bash
git add app/components/ui/
git commit -m "feat(developer): add shadcn UI components for developer portal"
```

---

### Task 2: Create AuthContext and webhookApi

Auth foundation: AuthContext manages JWT lifecycle, webhookApi wraps all API calls.

**Files:**
- Create: `frontend/app/contexts/AuthContext.tsx`
- Create: `frontend/app/lib/webhookApi.ts`

**Step 1: Create AuthContext.tsx**

```tsx
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: { id: string; email: string } | null
  loading: boolean
}

interface AuthContextType extends AuthState {
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  sendMagicLink: (email: string) => Promise<void>
  handleCallback: (hash: string) => void
  signOut: () => void
}

const STORAGE_KEY = 'flowindex_dev_auth'
const GOTRUE_URL = import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999'

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    refreshToken: null,
    user: null,
    loading: true,
  })

  // Load stored tokens on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const { accessToken, refreshToken } = JSON.parse(stored)
        if (accessToken) {
          const payload = JSON.parse(atob(accessToken.split('.')[1]))
          if (payload.exp * 1000 > Date.now()) {
            setState({
              accessToken,
              refreshToken,
              user: { id: payload.sub, email: payload.email },
              loading: false,
            })
            return
          }
          // Token expired — try refresh
          if (refreshToken) {
            doRefresh(refreshToken)
            return
          }
        }
      }
    } catch {}
    setState(s => ({ ...s, loading: false }))
  }, [])

  async function gotruePost(path: string, body: Record<string, string>) {
    const res = await fetch(`${GOTRUE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ msg: res.statusText }))
      throw new Error(err.msg || err.error_description || 'Auth error')
    }
    return res.json()
  }

  function setTokens(data: { access_token: string; refresh_token: string }) {
    const payload = JSON.parse(atob(data.access_token.split('.')[1]))
    const auth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: { id: payload.sub, email: payload.email },
      loading: false,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    }))
    setState(auth)
  }

  async function doRefresh(token: string) {
    try {
      const data = await gotruePost('/token?grant_type=refresh_token', { refresh_token: token })
      setTokens(data)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
      setState({ accessToken: null, refreshToken: null, user: null, loading: false })
    }
  }

  const signUp = useCallback(async (email: string, password: string) => {
    const data = await gotruePost('/signup', { email, password })
    if (data.access_token) setTokens(data)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await gotruePost('/token?grant_type=password', { email, password })
    setTokens(data)
  }, [])

  const sendMagicLink = useCallback(async (email: string) => {
    await gotruePost('/magiclink', { email })
  }, [])

  const handleCallback = useCallback((hash: string) => {
    const params = new URLSearchParams(hash.replace('#', ''))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (accessToken && refreshToken) {
      setTokens({ access_token: accessToken, refresh_token: refreshToken })
    }
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setState({ accessToken: null, refreshToken: null, user: null, loading: false })
  }, [])

  // Auto-refresh before expiry
  useEffect(() => {
    if (!state.accessToken) return
    try {
      const payload = JSON.parse(atob(state.accessToken.split('.')[1]))
      const expiresIn = payload.exp * 1000 - Date.now()
      const refreshAt = expiresIn - 60_000 // 1 minute before expiry
      if (refreshAt <= 0) {
        if (state.refreshToken) doRefresh(state.refreshToken)
        return
      }
      const timer = setTimeout(() => {
        if (state.refreshToken) doRefresh(state.refreshToken)
      }, refreshAt)
      return () => clearTimeout(timer)
    } catch {}
  }, [state.accessToken, state.refreshToken])

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, sendMagicLink, handleCallback, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

**Step 2: Create webhookApi.ts**

```typescript
const API_BASE = (import.meta.env.VITE_API_URL || '/api') + '/v1'

function getToken(): string | null {
  try {
    const stored = localStorage.getItem('flowindex_dev_auth')
    if (stored) return JSON.parse(stored).accessToken
  } catch {}
  return null
}

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || err.message || `API error ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Event Types (public, no auth)
export function listEventTypes() {
  return apiFetch<{ event_types: { name: string; description: string; condition_fields: string[] }[] }>('/event-types')
}

// API Keys
export function listAPIKeys() {
  return apiFetch<{ api_keys: { id: string; key_prefix: string; name: string; created_at: string; last_used: string | null; is_active: boolean }[] }>('/api-keys')
}

export function createAPIKey(name: string) {
  return apiFetch<{ id: string; key: string; key_prefix: string; name: string }>('/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function deleteAPIKey(id: string) {
  return apiFetch(`/api-keys/${id}`, { method: 'DELETE' })
}

// Endpoints
export function listEndpoints() {
  return apiFetch<{ endpoints: { id: string; url: string; description: string; is_active: boolean; created_at: string }[] }>('/endpoints')
}

export function createEndpoint(url: string, description: string) {
  return apiFetch<{ id: string; url: string; description: string }>('/endpoints', {
    method: 'POST',
    body: JSON.stringify({ url, description }),
  })
}

export function updateEndpoint(id: string, data: { url?: string; description?: string; is_active?: boolean }) {
  return apiFetch(`/endpoints/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteEndpoint(id: string) {
  return apiFetch(`/endpoints/${id}`, { method: 'DELETE' })
}

// Subscriptions
export function listSubscriptions() {
  return apiFetch<{ subscriptions: { id: string; endpoint_id: string; event_type: string; conditions: Record<string, unknown>; is_enabled: boolean; created_at: string }[] }>('/subscriptions')
}

export function createSubscription(endpointId: string, eventType: string, conditions: Record<string, unknown>) {
  return apiFetch<{ id: string }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ endpoint_id: endpointId, event_type: eventType, conditions }),
  })
}

export function updateSubscription(id: string, data: { is_enabled?: boolean; conditions?: Record<string, unknown> }) {
  return apiFetch(`/subscriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteSubscription(id: string) {
  return apiFetch(`/subscriptions/${id}`, { method: 'DELETE' })
}

// Delivery Logs
export function listDeliveryLogs(params: { page?: number; per_page?: number; event_type?: string; status_min?: number; status_max?: number }) {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.per_page) qs.set('per_page', String(params.per_page))
  if (params.event_type) qs.set('event_type', params.event_type)
  if (params.status_min) qs.set('status_min', String(params.status_min))
  if (params.status_max) qs.set('status_max', String(params.status_max))
  return apiFetch<{ logs: { id: string; event_type: string; endpoint_id: string; status_code: number; payload: unknown; delivered_at: string }[]; total: number }>(`/logs?${qs}`)
}

// Dashboard stats
export function getDashboardStats() {
  return Promise.all([listAPIKeys(), listEndpoints(), listSubscriptions(), listDeliveryLogs({ per_page: 5 })])
}
```

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit app/contexts/AuthContext.tsx app/lib/webhookApi.ts 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add app/contexts/AuthContext.tsx app/lib/webhookApi.ts
git commit -m "feat(developer): add AuthContext and webhook API client"
```

---

### Task 3: Create Login and Callback Pages

Login page with email/password form (fallback) and magic link option. Callback page extracts tokens from URL hash.

**Files:**
- Create: `frontend/app/routes/developer/login.tsx`
- Create: `frontend/app/routes/developer/callback.tsx`

**Step 1: Create the developer routes directory**

```bash
mkdir -p frontend/app/routes/developer
```

**Step 2: Create login.tsx**

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { motion } from 'framer-motion'

export const Route = createFileRoute('/developer/login')({
  component: DeveloperLogin,
})

function DeveloperLogin() {
  const { signIn, signUp, sendMagicLink, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register' | 'magic'>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  // Redirect if already logged in
  if (user) {
    navigate({ to: '/developer' })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'magic') {
        await sendMagicLink(email)
        setMagicSent(true)
      } else if (mode === 'register') {
        await signUp(email, password)
        navigate({ to: '/developer' })
      } else {
        await signIn(email, password)
        navigate({ to: '/developer' })
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-8 border border-neutral-800 rounded-lg bg-nothing-dark"
      >
        <h1 className="text-2xl font-bold text-white mb-2 font-geist">Developer Portal</h1>
        <p className="text-neutral-400 mb-6 text-sm">
          {mode === 'magic' ? 'Sign in with a magic link sent to your email' :
           mode === 'register' ? 'Create a developer account' : 'Sign in to your account'}
        </p>

        {magicSent ? (
          <div className="text-center py-8">
            <div className="text-nothing-green text-4xl mb-4">&#x2709;</div>
            <p className="text-white mb-2">Check your email</p>
            <p className="text-neutral-400 text-sm">We sent a magic link to <strong>{email}</strong></p>
            <button onClick={() => setMagicSent(false)} className="text-nothing-green text-sm mt-4 hover:underline">
              Try again
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green"
                placeholder="dev@example.com"
              />
            </div>

            {mode !== 'magic' && (
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green"
                  placeholder="Min 6 characters"
                />
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-nothing-green text-black font-medium rounded hover:bg-nothing-green/90 transition disabled:opacity-50"
            >
              {loading ? '...' : mode === 'magic' ? 'Send Magic Link' : mode === 'register' ? 'Create Account' : 'Sign In'}
            </button>

            <div className="flex justify-between text-xs text-neutral-500 pt-2">
              {mode === 'login' && (
                <>
                  <button type="button" onClick={() => setMode('register')} className="hover:text-nothing-green">Create account</button>
                  <button type="button" onClick={() => setMode('magic')} className="hover:text-nothing-green">Magic link</button>
                </>
              )}
              {mode === 'register' && (
                <button type="button" onClick={() => setMode('login')} className="hover:text-nothing-green">Already have an account? Sign in</button>
              )}
              {mode === 'magic' && (
                <button type="button" onClick={() => setMode('login')} className="hover:text-nothing-green">Sign in with password</button>
              )}
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}
```

**Step 3: Create callback.tsx**

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'

export const Route = createFileRoute('/developer/callback')({
  component: DeveloperCallback,
})

function DeveloperCallback() {
  const { handleCallback } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      handleCallback(window.location.hash)
      navigate({ to: '/developer' })
    }
  }, [])

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <p className="text-neutral-400">Signing you in...</p>
    </div>
  )
}
```

**Step 4: Regenerate route tree**

```bash
cd frontend && npx tsr generate
```

**Step 5: Verify build**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

**Step 6: Commit**

```bash
git add app/routes/developer/
git commit -m "feat(developer): add login and callback pages"
```

---

### Task 4: Create DeveloperLayout and ProtectedRoute

Shared layout with sidebar navigation for all `/developer/*` pages. Redirects to login if not authenticated.

**Files:**
- Create: `frontend/app/components/developer/DeveloperLayout.tsx`
- Create: `frontend/app/routes/developer/index.tsx` (dashboard)

**Step 1: Create DeveloperLayout.tsx**

```tsx
import { Link, useLocation } from '@tanstack/react-router'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { Key, Globe, Bell, FileText, LayoutDashboard, LogOut } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/developer', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/developer/keys', label: 'API Keys', icon: Key },
  { to: '/developer/endpoints', label: 'Endpoints', icon: Globe },
  { to: '/developer/subscriptions', label: 'Subscriptions', icon: Bell },
  { to: '/developer/logs', label: 'Delivery Logs', icon: FileText },
]

export function DeveloperLayout({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/developer/login' })
    }
  }, [loading, user])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <p className="text-neutral-400">Loading...</p>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex gap-6 max-w-7xl mx-auto px-4 py-6">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 hidden md:block">
        <div className="sticky top-20 space-y-1">
          <div className="px-3 py-2 mb-4">
            <p className="text-xs text-neutral-500 truncate">{user.email}</p>
          </div>
          {NAV_ITEMS.map(item => {
            const active = location.pathname === item.to ||
              (item.to !== '/developer' && location.pathname.startsWith(item.to))
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition ${
                  active
                    ? 'text-nothing-green bg-nothing-green/10'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                }`}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            )
          })}
          <button
            onClick={() => { signOut(); navigate({ to: '/developer/login' }) }}
            className="flex items-center gap-3 px-3 py-2 rounded text-sm text-neutral-500 hover:text-red-400 hover:bg-neutral-800/50 w-full transition mt-4"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  )
}
```

**Step 2: Create developer dashboard (index.tsx)**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { DeveloperLayout } from '../../components/developer/DeveloperLayout'
import { listAPIKeys, listEndpoints, listSubscriptions, listDeliveryLogs } from '../../lib/webhookApi'
import { Key, Globe, Bell, FileText } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/developer/')({
  component: DeveloperDashboard,
})

function DeveloperDashboard() {
  const [stats, setStats] = useState({ keys: 0, endpoints: 0, subscriptions: 0, logs: [] as any[] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listAPIKeys().catch(() => ({ api_keys: [] })),
      listEndpoints().catch(() => ({ endpoints: [] })),
      listSubscriptions().catch(() => ({ subscriptions: [] })),
      listDeliveryLogs({ per_page: 5 }).catch(() => ({ logs: [] })),
    ]).then(([keys, eps, subs, logs]) => {
      setStats({
        keys: keys.api_keys?.length || 0,
        endpoints: eps.endpoints?.length || 0,
        subscriptions: subs.subscriptions?.length || 0,
        logs: logs.logs || [],
      })
      setLoading(false)
    })
  }, [])

  const cards = [
    { label: 'API Keys', value: stats.keys, icon: Key, to: '/developer/keys', color: 'text-blue-400' },
    { label: 'Endpoints', value: stats.endpoints, icon: Globe, to: '/developer/endpoints', color: 'text-purple-400' },
    { label: 'Subscriptions', value: stats.subscriptions, icon: Bell, to: '/developer/subscriptions', color: 'text-nothing-green' },
  ]

  return (
    <DeveloperLayout>
      <h1 className="text-xl font-bold text-white mb-6">Dashboard</h1>

      {loading ? (
        <div className="text-neutral-400">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {cards.map(c => (
              <Link key={c.to} to={c.to} className="border border-neutral-800 rounded-lg p-4 hover:border-neutral-700 transition bg-nothing-dark">
                <div className="flex items-center gap-3 mb-2">
                  <c.icon size={18} className={c.color} />
                  <span className="text-sm text-neutral-400">{c.label}</span>
                </div>
                <p className="text-2xl font-bold text-white">{c.value}</p>
              </Link>
            ))}
          </div>

          <div className="border border-neutral-800 rounded-lg p-4 bg-nothing-dark">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-white">Recent Deliveries</h2>
              <Link to="/developer/logs" className="text-xs text-nothing-green hover:underline">View all</Link>
            </div>
            {stats.logs.length === 0 ? (
              <p className="text-neutral-500 text-sm">No deliveries yet</p>
            ) : (
              <div className="space-y-2">
                {stats.logs.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between text-sm py-1 border-b border-neutral-800/50 last:border-0">
                    <span className="text-neutral-300 font-mono text-xs">{log.event_type}</span>
                    <span className={`text-xs ${log.status_code < 300 ? 'text-nothing-green' : 'text-red-400'}`}>
                      {log.status_code || 'pending'}
                    </span>
                    <span className="text-neutral-500 text-xs">{new Date(log.delivered_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </DeveloperLayout>
  )
}
```

**Step 3: Regenerate route tree and verify**

```bash
cd frontend && npx tsr generate && npx tsc --noEmit 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add app/components/developer/ app/routes/developer/index.tsx
git commit -m "feat(developer): add DeveloperLayout and dashboard page"
```

---

### Task 5: Add AuthProvider to Root Layout

Wrap the app in AuthProvider so all developer routes can access auth state.

**Files:**
- Modify: `frontend/app/routes/__root.tsx`

**Step 1: Read current __root.tsx**

Read `frontend/app/routes/__root.tsx` to understand current provider structure.

**Step 2: Add AuthProvider import and wrap**

Add import:
```tsx
import { AuthProvider } from '../contexts/AuthContext'
```

Wrap inside the existing provider chain (inside ThemeProvider, alongside WebSocketProvider):
```tsx
<ThemeProvider>
  <AuthProvider>
    <WebSocketProvider>
      ...existing content...
    </WebSocketProvider>
  </AuthProvider>
</ThemeProvider>
```

**Step 3: Verify build**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add app/routes/__root.tsx
git commit -m "feat(developer): add AuthProvider to root layout"
```

---

### Task 6: API Keys Page

Manage API keys: list, create (modal shows key once), delete with confirmation.

**Files:**
- Create: `frontend/app/routes/developer/keys.tsx`

**Step 1: Create keys.tsx**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { DeveloperLayout } from '../../components/developer/DeveloperLayout'
import { listAPIKeys, createAPIKey, deleteAPIKey } from '../../lib/webhookApi'
import { Plus, Trash2, Copy, Check } from 'lucide-react'

export const Route = createFileRoute('/developer/keys')({
  component: DeveloperKeys,
})

function DeveloperKeys() {
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function loadKeys() {
    try {
      const data = await listAPIKeys()
      setKeys(data.api_keys || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadKeys() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError('')
    try {
      const data = await createAPIKey(newKeyName)
      setCreatedKey(data.key)
      setNewKeyName('')
      loadKeys()
    } catch (err: any) {
      setError(err.message)
    }
    setCreating(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this API key? This cannot be undone.')) return
    try {
      await deleteAPIKey(id)
      loadKeys()
    } catch {}
  }

  function copyKey() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <DeveloperLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">API Keys</h1>
        <button onClick={() => { setShowCreate(true); setCreatedKey(null) }}
          className="flex items-center gap-2 px-3 py-1.5 bg-nothing-green text-black text-sm font-medium rounded hover:bg-nothing-green/90 transition">
          <Plus size={14} /> Create Key
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => !createdKey && setShowCreate(false)}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            {createdKey ? (
              <div>
                <h2 className="text-white font-medium mb-2">API Key Created</h2>
                <p className="text-neutral-400 text-xs mb-3">Copy this key now. You won't be able to see it again.</p>
                <div className="flex items-center gap-2 bg-neutral-800 p-3 rounded font-mono text-sm text-nothing-green break-all">
                  {createdKey}
                  <button onClick={copyKey} className="shrink-0 text-neutral-400 hover:text-white">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <button onClick={() => setShowCreate(false)} className="mt-4 w-full py-2 bg-neutral-800 text-white rounded text-sm hover:bg-neutral-700">Done</button>
              </div>
            ) : (
              <form onSubmit={handleCreate}>
                <h2 className="text-white font-medium mb-4">Create API Key</h2>
                <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g. Production)" required
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green mb-3" />
                {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-neutral-800 text-white rounded text-sm hover:bg-neutral-700">Cancel</button>
                  <button type="submit" disabled={creating} className="flex-1 py-2 bg-nothing-green text-black rounded text-sm font-medium hover:bg-nothing-green/90 disabled:opacity-50">
                    {creating ? '...' : 'Create'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Keys table */}
      {loading ? (
        <div className="text-neutral-400 text-sm">Loading...</div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-sm">No API keys yet. Create one to get started.</div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500 text-xs">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Key Prefix</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-left px-4 py-3 font-medium">Last Used</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  <td className="px-4 py-3 text-white">{k.name}</td>
                  <td className="px-4 py-3 text-neutral-400 font-mono text-xs">{k.key_prefix}...</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{k.last_used ? new Date(k.last_used).toLocaleDateString() : 'Never'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(k.id)} className="text-neutral-500 hover:text-red-400 transition">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DeveloperLayout>
  )
}
```

**Step 2: Regenerate route tree and verify**

```bash
cd frontend && npx tsr generate && npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/routes/developer/keys.tsx
git commit -m "feat(developer): add API keys management page"
```

---

### Task 7: Endpoints Page

Manage webhook endpoints: list, create, edit, delete.

**Files:**
- Create: `frontend/app/routes/developer/endpoints.tsx`

**Step 1: Create endpoints.tsx**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { DeveloperLayout } from '../../components/developer/DeveloperLayout'
import { listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint } from '../../lib/webhookApi'
import { Plus, Trash2, Edit2, Globe } from 'lucide-react'

export const Route = createFileRoute('/developer/endpoints')({
  component: DeveloperEndpoints,
})

function DeveloperEndpoints() {
  const [endpoints, setEndpoints] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const data = await listEndpoints()
      setEndpoints(data.endpoints || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditId(null); setUrl(''); setDescription(''); setError(''); setShowForm(true)
  }

  function openEdit(ep: any) {
    setEditId(ep.id); setUrl(ep.url); setDescription(ep.description || ''); setError(''); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (editId) {
        await updateEndpoint(editId, { url, description })
      } else {
        await createEndpoint(url, description)
      }
      setShowForm(false)
      load()
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this endpoint? Active subscriptions will also be removed.')) return
    try { await deleteEndpoint(id); load() } catch {}
  }

  return (
    <DeveloperLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Webhook Endpoints</h1>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-3 py-1.5 bg-nothing-green text-black text-sm font-medium rounded hover:bg-nothing-green/90 transition">
          <Plus size={14} /> Add Endpoint
        </button>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-medium mb-4">{editId ? 'Edit Endpoint' : 'Add Endpoint'}</h2>
            <div className="space-y-3">
              <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-app.com/webhook"
                required className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green" />
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green" />
            </div>
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 bg-neutral-800 text-white rounded text-sm hover:bg-neutral-700">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 bg-nothing-green text-black rounded text-sm font-medium hover:bg-nothing-green/90 disabled:opacity-50">
                {saving ? '...' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-neutral-400 text-sm">Loading...</div>
      ) : endpoints.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-sm">No endpoints yet. Add one to start receiving webhooks.</div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500 text-xs">
                <th className="text-left px-4 py-3 font-medium">URL</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map(ep => (
                <tr key={ep.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  <td className="px-4 py-3 text-white font-mono text-xs max-w-xs truncate">
                    <Globe size={12} className="inline mr-2 text-neutral-500" />{ep.url}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">{ep.description || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${ep.is_active ? 'bg-nothing-green/10 text-nothing-green' : 'bg-red-400/10 text-red-400'}`}>
                      {ep.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{new Date(ep.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => openEdit(ep)} className="text-neutral-500 hover:text-white transition"><Edit2 size={14} /></button>
                    <button onClick={() => handleDelete(ep.id)} className="text-neutral-500 hover:text-red-400 transition"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DeveloperLayout>
  )
}
```

**Step 2: Regenerate route tree and verify**

```bash
cd frontend && npx tsr generate && npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/routes/developer/endpoints.tsx
git commit -m "feat(developer): add webhook endpoints management page"
```

---

### Task 8: Subscriptions Page

Manage subscriptions: list, create (with event type dropdown + endpoint selector + conditions editor), toggle enable/disable, delete.

**Files:**
- Create: `frontend/app/routes/developer/subscriptions.tsx`

**Step 1: Create subscriptions.tsx**

This is the most complex page. It needs:
- List subscriptions in a table
- Create subscription form with:
  - Event type dropdown (from `/api/v1/event-types`)
  - Endpoint selector (from user's endpoints)
  - Conditions editor (key-value pairs based on event type)
- Toggle enable/disable
- Delete with confirmation

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { DeveloperLayout } from '../../components/developer/DeveloperLayout'
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription, listEndpoints, listEventTypes } from '../../lib/webhookApi'
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

export const Route = createFileRoute('/developer/subscriptions')({
  component: DeveloperSubscriptions,
})

// Condition field definitions per event type
const CONDITION_FIELDS: Record<string, { key: string; label: string; type: 'text' | 'array' | 'number' | 'select'; options?: string[] }[]> = {
  'ft.transfer': [
    { key: 'addresses', label: 'Addresses (comma-separated)', type: 'array' },
    { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
    { key: 'token_contract', label: 'Token Contract', type: 'text' },
    { key: 'min_amount', label: 'Min Amount', type: 'number' },
  ],
  'ft.large_transfer': [
    { key: 'token_contract', label: 'Token Contract', type: 'text' },
    { key: 'min_amount', label: 'Min Amount (required)', type: 'number' },
  ],
  'nft.transfer': [
    { key: 'addresses', label: 'Addresses (comma-separated)', type: 'array' },
    { key: 'collection', label: 'Collection', type: 'text' },
    { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
  ],
  'contract.event': [
    { key: 'contract_address', label: 'Contract Address', type: 'text' },
    { key: 'event_names', label: 'Event Names (comma-separated)', type: 'array' },
  ],
  'address.activity': [
    { key: 'addresses', label: 'Addresses (comma-separated)', type: 'array' },
    { key: 'roles', label: 'Roles (comma-separated: PROPOSER,PAYER,AUTHORIZER)', type: 'array' },
  ],
  'staking.event': [
    { key: 'event_types', label: 'Event Types (comma-separated)', type: 'array' },
    { key: 'node_id', label: 'Node ID', type: 'text' },
    { key: 'min_amount', label: 'Min Amount', type: 'number' },
  ],
  'defi.swap': [
    { key: 'pair_id', label: 'Pair ID', type: 'text' },
    { key: 'min_amount', label: 'Min Amount', type: 'number' },
    { key: 'addresses', label: 'Addresses (comma-separated)', type: 'array' },
  ],
  'defi.liquidity': [
    { key: 'pair_id', label: 'Pair ID', type: 'text' },
    { key: 'event_type', label: 'Event Type', type: 'select', options: ['add', 'remove'] },
  ],
  'account.key_change': [
    { key: 'addresses', label: 'Addresses (comma-separated)', type: 'array' },
  ],
  'evm.transaction': [
    { key: 'from', label: 'From Address', type: 'text' },
    { key: 'to', label: 'To Address', type: 'text' },
    { key: 'min_value', label: 'Min Value', type: 'number' },
  ],
}

function DeveloperSubscriptions() {
  const [subs, setSubs] = useState<any[]>([])
  const [endpoints, setEndpoints] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [eventType, setEventType] = useState('')
  const [endpointId, setEndpointId] = useState('')
  const [conditions, setConditions] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const [subsData, epsData] = await Promise.all([listSubscriptions(), listEndpoints()])
      setSubs(subsData.subscriptions || [])
      setEndpoints(epsData.endpoints || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEventType(''); setEndpointId(''); setConditions({}); setError(''); setShowForm(true)
  }

  function handleConditionChange(key: string, value: string) {
    setConditions(prev => ({ ...prev, [key]: value }))
  }

  function buildConditions() {
    const result: Record<string, any> = {}
    const fields = CONDITION_FIELDS[eventType] || []
    for (const field of fields) {
      const val = conditions[field.key]
      if (!val) continue
      if (field.type === 'array') {
        result[field.key] = val.split(',').map(s => s.trim()).filter(Boolean)
      } else if (field.type === 'number') {
        result[field.key] = val
      } else {
        result[field.key] = val
      }
    }
    return result
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await createSubscription(endpointId, eventType, buildConditions())
      setShowForm(false)
      load()
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function handleToggle(sub: any) {
    try {
      await updateSubscription(sub.id, { is_enabled: !sub.is_enabled })
      load()
    } catch {}
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this subscription?')) return
    try { await deleteSubscription(id); load() } catch {}
  }

  const fields = CONDITION_FIELDS[eventType] || []

  return (
    <DeveloperLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Subscriptions</h1>
        <button onClick={openCreate} disabled={endpoints.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 bg-nothing-green text-black text-sm font-medium rounded hover:bg-nothing-green/90 transition disabled:opacity-50"
          title={endpoints.length === 0 ? 'Create an endpoint first' : ''}>
          <Plus size={14} /> New Subscription
        </button>
      </div>

      {endpoints.length === 0 && !loading && (
        <div className="mb-4 px-4 py-3 bg-yellow-400/10 border border-yellow-400/20 rounded text-yellow-400 text-sm">
          You need at least one endpoint before creating subscriptions.
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <form onSubmit={handleCreate} className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-medium mb-4">New Subscription</h2>
            <div className="space-y-3">
              {/* Event type */}
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Event Type</label>
                <select value={eventType} onChange={e => { setEventType(e.target.value); setConditions({}) }} required
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green">
                  <option value="">Select event type...</option>
                  {Object.keys(CONDITION_FIELDS).map(et => (
                    <option key={et} value={et}>{et}</option>
                  ))}
                </select>
              </div>
              {/* Endpoint */}
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Endpoint</label>
                <select value={endpointId} onChange={e => setEndpointId(e.target.value)} required
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green">
                  <option value="">Select endpoint...</option>
                  {endpoints.map(ep => (
                    <option key={ep.id} value={ep.id}>{ep.url}</option>
                  ))}
                </select>
              </div>
              {/* Condition fields */}
              {fields.length > 0 && (
                <div className="pt-2 border-t border-neutral-800">
                  <label className="block text-xs text-neutral-400 mb-2">Conditions</label>
                  {fields.map(f => (
                    <div key={f.key} className="mb-2">
                      <label className="block text-xs text-neutral-500 mb-1">{f.label}</label>
                      {f.type === 'select' ? (
                        <select value={conditions[f.key] || ''} onChange={e => handleConditionChange(f.key, e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green">
                          <option value="">Any</option>
                          {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={f.type === 'number' ? 'number' : 'text'} value={conditions[f.key] || ''}
                          onChange={e => handleConditionChange(f.key, e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-nothing-green"
                          step={f.type === 'number' ? 'any' : undefined} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 bg-neutral-800 text-white rounded text-sm hover:bg-neutral-700">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 bg-nothing-green text-black rounded text-sm font-medium hover:bg-nothing-green/90 disabled:opacity-50">
                {saving ? '...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Subscriptions table */}
      {loading ? (
        <div className="text-neutral-400 text-sm">Loading...</div>
      ) : subs.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-sm">No subscriptions yet.</div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500 text-xs">
                <th className="text-left px-4 py-3 font-medium">Event Type</th>
                <th className="text-left px-4 py-3 font-medium">Endpoint</th>
                <th className="text-left px-4 py-3 font-medium">Conditions</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map(sub => {
                const ep = endpoints.find(e => e.id === sub.endpoint_id)
                return (
                  <tr key={sub.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="px-4 py-3 text-nothing-green font-mono text-xs">{sub.event_type}</td>
                    <td className="px-4 py-3 text-neutral-400 text-xs max-w-xs truncate">{ep?.url || sub.endpoint_id}</td>
                    <td className="px-4 py-3 text-neutral-500 text-xs font-mono max-w-xs truncate">
                      {Object.keys(sub.conditions || {}).length > 0 ? JSON.stringify(sub.conditions) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleToggle(sub)} className="transition">
                        {sub.is_enabled ? (
                          <ToggleRight size={20} className="text-nothing-green" />
                        ) : (
                          <ToggleLeft size={20} className="text-neutral-500" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleDelete(sub.id)} className="text-neutral-500 hover:text-red-400 transition">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </DeveloperLayout>
  )
}
```

**Step 2: Regenerate route tree and verify**

```bash
cd frontend && npx tsr generate && npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/routes/developer/subscriptions.tsx
git commit -m "feat(developer): add subscriptions management page"
```

---

### Task 9: Delivery Logs Page

View delivery logs with pagination and filtering.

**Files:**
- Create: `frontend/app/routes/developer/logs.tsx`

**Step 1: Create logs.tsx**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { DeveloperLayout } from '../../components/developer/DeveloperLayout'
import { listDeliveryLogs } from '../../lib/webhookApi'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'

export const Route = createFileRoute('/developer/logs')({
  component: DeveloperLogs,
})

function DeveloperLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [eventFilter, setEventFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'success' | 'error'>('')
  const perPage = 50

  async function load() {
    setLoading(true)
    try {
      const params: any = { page, per_page: perPage }
      if (eventFilter) params.event_type = eventFilter
      if (statusFilter === 'success') { params.status_min = 200; params.status_max = 299 }
      if (statusFilter === 'error') { params.status_min = 400; params.status_max = 599 }
      const data = await listDeliveryLogs(params)
      setLogs(data.logs || [])
      setTotal(data.total || 0)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [page, eventFilter, statusFilter])

  const totalPages = Math.ceil(total / perPage) || 1

  return (
    <DeveloperLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Delivery Logs</h1>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-neutral-500" />
          <input type="text" value={eventFilter} onChange={e => { setEventFilter(e.target.value); setPage(1) }}
            placeholder="Filter by event type" className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-white text-xs w-40 focus:outline-none focus:ring-1 focus:ring-nothing-green" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setPage(1) }}
            className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-nothing-green">
            <option value="">All status</option>
            <option value="success">2xx Success</option>
            <option value="error">4xx/5xx Error</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-neutral-400 text-sm">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-sm">No delivery logs yet.</div>
      ) : (
        <>
          <div className="border border-neutral-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-500 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium">Event Type</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">{new Date(log.delivered_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-nothing-green font-mono text-xs">{log.event_type}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        log.status_code && log.status_code < 300 ? 'bg-nothing-green/10 text-nothing-green' :
                        log.status_code ? 'bg-red-400/10 text-red-400' : 'bg-neutral-700 text-neutral-400'
                      }`}>
                        {log.status_code || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 text-xs font-mono max-w-sm truncate">
                      {typeof log.payload === 'object' ? JSON.stringify(log.payload) : String(log.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-neutral-500 text-xs">{total} total logs</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1 text-neutral-400 hover:text-white disabled:opacity-30"><ChevronLeft size={16} /></button>
              <span className="text-neutral-400 text-xs">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1 text-neutral-400 hover:text-white disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
          </div>
        </>
      )}
    </DeveloperLayout>
  )
}
```

**Step 2: Regenerate route tree and verify**

```bash
cd frontend && npx tsr generate && npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/routes/developer/logs.tsx
git commit -m "feat(developer): add delivery logs page"
```

---

### Task 10: Add Developer Portal Link to Sidebar

Add a link to the developer portal in the main site sidebar/header.

**Files:**
- Modify: `frontend/app/components/Sidebar.tsx`

**Step 1: Read Sidebar.tsx**

Read the file to understand the current navigation structure.

**Step 2: Add Developer Portal link**

Add a new nav item linking to `/developer`:
```tsx
{ to: '/developer', label: 'Developer', icon: Code2 }
```

Import `Code2` from lucide-react.

**Step 3: Verify build**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add app/components/Sidebar.tsx
git commit -m "feat(developer): add developer portal link to sidebar"
```

---

### Task 11: Configure Resend SMTP on GoTrue

Enable magic link emails by configuring Resend SMTP on both GCP and Railway GoTrue instances.

**Files:**
- Modify: GCP GoTrue container environment
- Modify: Railway supabase-auth service environment

**Step 1: Update GCP GoTrue**

SSH into GCP VM and recreate GoTrue container with SMTP env vars:

```bash
# On GCP VM
docker stop supabase-auth && docker rm supabase-auth

docker run -d --name supabase-auth \
  --network host \
  -e GOTRUE_API_HOST=0.0.0.0 \
  -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL=http://localhost:9999 \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:supabase-secret-prod-2026@localhost:5433/supabase" \
  -e GOTRUE_SITE_URL=https://flowindex.io \
  -e GOTRUE_JWT_SECRET=FYO8sf7LzurUbgjlMVqUwgHwD6ex76bGE597AkcWucRdgRu6eQ3N/rJJbn3QU9bJ \
  -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  -e GOTRUE_MAILER_AUTOCONFIRM=false \
  -e GOTRUE_SMTP_HOST=smtp.resend.com \
  -e GOTRUE_SMTP_PORT=465 \
  -e GOTRUE_SMTP_USER=resend \
  -e GOTRUE_SMTP_PASS=re_D8V7i1NZ_K9fC2gCociLMWpnznmKZkQ19 \
  -e GOTRUE_SMTP_SENDER_NAME=FlowIndex \
  -e GOTRUE_SMTP_ADMIN_EMAIL=noreply@flowindex.io \
  -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/developer/callback \
  supabase/gotrue:v2.170.0
```

Verify: `docker logs supabase-auth 2>&1 | tail -5`

**Step 2: Update Railway GoTrue**

```bash
railway variables set \
  GOTRUE_MAILER_AUTOCONFIRM=false \
  GOTRUE_SMTP_HOST=smtp.resend.com \
  GOTRUE_SMTP_PORT=465 \
  GOTRUE_SMTP_USER=resend \
  GOTRUE_SMTP_PASS=re_D8V7i1NZ_K9fC2gCociLMWpnznmKZkQ19 \
  GOTRUE_SMTP_SENDER_NAME=FlowIndex \
  GOTRUE_SMTP_ADMIN_EMAIL=noreply@flowindex.io \
  GOTRUE_MAILER_URLPATHS_CONFIRMATION=/developer/callback \
  --service supabase-auth
```

**Step 3: Verify magic link works**

```bash
curl -s -X POST https://supabase-auth-production-073d.up.railway.app/magiclink \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}'
```

**Step 4: Update docker-compose.yml for local development**

Add SMTP env vars to the `supabase-auth` service in docker-compose.yml:

```yaml
GOTRUE_SMTP_HOST: smtp.resend.com
GOTRUE_SMTP_PORT: "465"
GOTRUE_SMTP_USER: resend
GOTRUE_SMTP_PASS: ${RESEND_API_KEY:-}
GOTRUE_SMTP_SENDER_NAME: FlowIndex
GOTRUE_SMTP_ADMIN_EMAIL: noreply@flowindex.io
GOTRUE_MAILER_URLPATHS_CONFIRMATION: /developer/callback
```

**Step 5: Add VITE_GOTRUE_URL to docker-compose frontend**

```yaml
frontend:
  environment:
    - VITE_GOTRUE_URL=http://supabase-auth:9999
```

**Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(developer): configure GoTrue SMTP for magic link emails"
```

---

### Task 12: Verify Frontend Build

Final verification that everything compiles and the dev server starts.

**Step 1: Install dependencies**

```bash
cd frontend && npm ci
```

**Step 2: Type check**

```bash
npx tsc --noEmit
```

**Step 3: Build**

```bash
npm run build
```

**Step 4: Verify all routes registered**

Check `app/routeTree.gen.ts` contains developer routes:
- `/developer/`
- `/developer/login`
- `/developer/callback`
- `/developer/keys`
- `/developer/endpoints`
- `/developer/subscriptions`
- `/developer/logs`

**Step 5: Commit any remaining changes**

```bash
git add -A && git status
git commit -m "feat(developer): developer portal complete"
```
