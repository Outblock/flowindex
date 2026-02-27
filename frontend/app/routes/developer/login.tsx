import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight, Loader2, Sparkles, UserPlus, LogIn } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export const Route = createFileRoute('/developer/login')({
  component: DeveloperLoginPage,
})

type AuthMode = 'login' | 'register' | 'magic'

function DeveloperLoginPage() {
  const { user, loading: authLoading, signIn, signUp, sendMagicLink } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: '/developer' })
    }
  }, [authLoading, user, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'magic') {
        await sendMagicLink(email)
        setMagicLinkSent(true)
      } else if (mode === 'register') {
        await signUp(email, password)
        // After signup, try to sign in (if auto-confirmed)
        try {
          await signIn(email, password)
        } catch {
          // If sign-in fails, user may need to confirm email
          setError('Account created. Please check your email to confirm, then sign in.')
        }
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
      </div>
    )
  }

  // Magic link sent confirmation
  if (magicLinkSent) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[#00ef8b]/10 flex items-center justify-center mx-auto mb-6">
              <Mail className="w-8 h-8 text-[#00ef8b]" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
            <p className="text-neutral-400 mb-6">
              We sent a magic link to <span className="text-white font-medium">{email}</span>.
              Click the link in the email to sign in.
            </p>
            <button
              onClick={() => { setMagicLinkSent(false); setMode('login') }}
              className="text-sm text-[#00ef8b] hover:text-[#00ef8b]/80 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  const titles: Record<AuthMode, string> = {
    login: 'Sign in',
    register: 'Create account',
    magic: 'Magic link',
  }

  const descriptions: Record<AuthMode, string> = {
    login: 'Sign in to your developer portal',
    register: 'Create a new developer account',
    magic: 'Sign in with a link sent to your email',
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-lg bg-[#00ef8b]/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-6 h-6 text-[#00ef8b]" />
            </div>
            <h1 className="text-2xl font-bold text-white">{titles[mode]}</h1>
            <p className="text-sm text-neutral-400 mt-1">{descriptions[mode]}</p>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              {error}
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-300 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/20 transition-colors text-sm"
                />
              </div>
            </div>

            {/* Password (hidden in magic link mode) */}
            {mode !== 'magic' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label htmlFor="password" className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                  <input
                    id="password"
                    type="password"
                    required={mode !== 'magic'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/20 transition-colors text-sm"
                  />
                </div>
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#00ef8b] hover:bg-[#00ef8b]/90 text-black font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'login' ? (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign in
                </>
              ) : mode === 'register' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create account
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  Send magic link
                </>
              )}
            </button>
          </form>

          {/* Mode toggles */}
          <div className="mt-6 pt-6 border-t border-neutral-800 text-center space-y-2 text-sm">
            {mode === 'login' && (
              <>
                <p className="text-neutral-400">
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={() => { setMode('register'); setError(null) }}
                    className="text-[#00ef8b] hover:text-[#00ef8b]/80 transition-colors font-medium"
                  >
                    Register
                  </button>
                </p>
                <p className="text-neutral-500">
                  or{' '}
                  <button
                    onClick={() => { setMode('magic'); setError(null) }}
                    className="text-neutral-300 hover:text-white transition-colors"
                  >
                    sign in with magic link
                  </button>
                </p>
              </>
            )}
            {mode === 'register' && (
              <p className="text-neutral-400">
                Already have an account?{' '}
                <button
                  onClick={() => { setMode('login'); setError(null) }}
                  className="text-[#00ef8b] hover:text-[#00ef8b]/80 transition-colors font-medium"
                >
                  Sign in
                </button>
              </p>
            )}
            {mode === 'magic' && (
              <p className="text-neutral-400">
                <button
                  onClick={() => { setMode('login'); setError(null) }}
                  className="text-[#00ef8b] hover:text-[#00ef8b]/80 transition-colors font-medium"
                >
                  Back to sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
