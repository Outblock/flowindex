import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { KeyRound, Mail, Loader2, Wallet, ArrowLeft, ArrowRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { FlowIndexLogo } from '../../components/FlowIndexLogo'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../../components/ui/input-otp'

const GridScan = lazy(() => import('../../components/GridScan'))

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export const Route = createFileRoute('/developer/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = typeof search.redirect === 'string' ? search.redirect : undefined
    return { redirect }
  },
  component: DeveloperLoginPage,
})

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
}

function DeveloperLoginPage() {
  const { user, loading: authLoading, sendMagicLink, verifyOtp, signInWithProvider } = useAuth()
  const { redirect } = Route.useSearch()
  const redirectTo = redirect && redirect.startsWith('/') ? redirect : '/developer'

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState(false)
  const [otpValue, setOtpValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [showEmailForm, setShowEmailForm] = useState(false)

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      window.location.assign(redirectTo)
    }
  }, [authLoading, user, redirectTo])

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await sendMagicLink(
        email,
        typeof window !== 'undefined'
          ? `${window.location.origin}/developer/callback?redirect=${encodeURIComponent(redirectTo)}`
          : undefined,
      )
      setOtpSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link')
    } finally {
      setLoading(false)
    }
  }

  const submitOtp = useCallback(async (code: string) => {
    setError(null)
    setVerifying(true)
    try {
      await verifyOtp(email, code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.')
      setOtpValue('')
    } finally {
      setVerifying(false)
    }
  }, [email, verifyOtp])

  function handleOtpChange(value: string) {
    setOtpValue(value)
    if (value.length === 6) {
      submitOtp(value)
    }
  }

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-600" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative min-h-0 bg-black overflow-hidden isolate">
      {/* GridScan background */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={null}>
          <GridScan scanColor="#9effe2" className="w-full h-full" />
        </Suspense>
      </div>

      <AnimatePresence mode="wait">
        {/* OTP verification screen */}
        {otpSent ? (
          <motion.div
            key="otp"
            {...fadeUp}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[420px] relative z-10"
          >
            <div className="border border-neutral-800 bg-black/60 backdrop-blur-xl border-white/[0.06] p-8">
              {/* Back button */}
              <button
                onClick={() => { setOtpSent(false); setOtpValue(''); setError(null) }}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors mb-6 group font-mono uppercase tracking-wider"
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Back
              </button>

              <div className="text-center">
                <Mail className="w-6 h-6 text-[#00ef8b] mx-auto mb-5" />
                <h2 className="text-lg font-semibold text-white mb-1 tracking-tight">Check your email</h2>
                <p className="text-sm text-neutral-500 mb-1">We sent a 6-digit code to</p>
                <p className="text-sm text-white font-medium font-mono mb-6">{email}</p>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mb-4 px-3 py-2.5 bg-red-500/8 border border-red-500/15 text-red-400 text-xs font-mono"
                >
                  {error}
                </motion.div>
              )}

              <div className="flex justify-center mb-6">
                <InputOTP
                  maxLength={6}
                  value={otpValue}
                  onChange={handleOtpChange}
                  disabled={verifying}
                  autoFocus
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map(i => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 w-11 text-lg font-bold font-mono bg-neutral-950 border-neutral-800 text-[#00ef8b] ring-[#00ef8b]/20 rounded-none"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {verifying && (
                <div className="flex items-center justify-center gap-2 text-neutral-400 text-xs mb-4 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Verifying...
                </div>
              )}

              <div className="text-center space-y-3">
                <p className="text-[11px] text-neutral-600 font-mono">Or click the magic link in your email</p>
                <button
                  onClick={async () => {
                    setError(null)
                    setLoading(true)
                    try {
                      await sendMagicLink(
                        email,
                        typeof window !== 'undefined'
                          ? `${window.location.origin}/developer/callback?redirect=${encodeURIComponent(redirectTo)}`
                          : undefined,
                      )
                      setOtpValue('')
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to resend')
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  className="text-xs text-neutral-500 hover:text-[#00ef8b] transition-colors disabled:opacity-50 font-mono uppercase tracking-wider"
                >
                  {loading ? 'Sending...' : 'Resend code'}
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Main login screen */
          <motion.div
            key="main"
            {...fadeUp}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[420px] relative z-10"
          >
            <div className="border border-neutral-800 bg-black/60 backdrop-blur-xl border-white/[0.06] overflow-hidden">
              {/* Header */}
              <div className="px-8 pt-10 pb-6 text-center">
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.05, type: 'spring', stiffness: 200, damping: 20 }}
                  className="mb-5"
                >
                  <FlowIndexLogo size={36} className="text-[#00ef8b] mx-auto" />
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-xl font-semibold text-white tracking-tight"
                >
                  Sign in to FlowIndex
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="text-sm text-neutral-500 mt-1.5 font-mono"
                >
                  Webhooks, API keys, and developer tools
                </motion.p>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-8"
                  >
                    <div className="px-3 py-2.5 bg-red-500/8 border border-red-500/15 text-red-400 text-xs font-mono mb-4">
                      {error}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="px-8 pb-8">
                <AnimatePresence mode="wait">
                  {!showEmailForm ? (
                    /* Provider buttons */
                    <motion.div
                      key="providers"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-2.5"
                    >
                      {/* GitHub */}
                      <button
                        type="button"
                        onClick={() => signInWithProvider('github', redirectTo)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-neutral-100 text-neutral-900 font-medium transition-all text-sm group active:scale-[0.98]"
                      >
                        <GitHubIcon className="w-5 h-5 shrink-0" />
                        <span className="flex-1 text-left">Continue with GitHub</span>
                        <ArrowRight className="w-4 h-4 text-neutral-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </button>

                      {/* Google */}
                      <button
                        type="button"
                        onClick={() => signInWithProvider('google', redirectTo)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-200 font-medium transition-all text-sm group active:scale-[0.98]"
                      >
                        <GoogleIcon className="w-5 h-5 shrink-0" />
                        <span className="flex-1 text-left">Continue with Google</span>
                        <ArrowRight className="w-4 h-4 text-neutral-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </button>

                      {/* Email */}
                      <button
                        type="button"
                        onClick={() => { setShowEmailForm(true); setError(null) }}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-200 font-medium transition-all text-sm group active:scale-[0.98]"
                      >
                        <Mail className="w-5 h-5 shrink-0 text-neutral-400" />
                        <span className="flex-1 text-left">Continue with Email</span>
                        <ArrowRight className="w-4 h-4 text-neutral-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </button>

                      {/* Divider */}
                      <div className="flex items-center gap-3 py-2">
                        <div className="flex-1 border-t border-neutral-800/60" />
                        <span className="text-[10px] text-neutral-600 uppercase tracking-[0.15em] font-mono">coming soon</span>
                        <div className="flex-1 border-t border-neutral-800/60" />
                      </div>

                      {/* Coming soon — Passkey */}
                      <div className="w-full flex items-center gap-3 px-4 py-3 border border-dashed border-neutral-800/60 text-neutral-600 text-sm cursor-default select-none">
                        <KeyRound className="w-5 h-5 shrink-0 opacity-50" />
                        <span className="flex-1 text-left">Passkey</span>
                      </div>

                      {/* Coming soon — Wallet */}
                      <div className="w-full flex items-center gap-3 px-4 py-3 border border-dashed border-neutral-800/60 text-neutral-600 text-sm cursor-default select-none">
                        <Wallet className="w-5 h-5 shrink-0 opacity-50" />
                        <span className="flex-1 text-left">Flow Wallet</span>
                      </div>
                    </motion.div>
                  ) : (
                    /* Email form */
                    <motion.div
                      key="email"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <button
                        onClick={() => { setShowEmailForm(false); setError(null) }}
                        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors mb-5 group font-mono uppercase tracking-wider"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                        All sign-in options
                      </button>

                      <form onSubmit={handleSendLink} className="space-y-4">
                        <div>
                          <label htmlFor="email" className="block text-xs font-medium text-neutral-400 mb-2 uppercase tracking-wider font-mono">
                            Email address
                          </label>
                          <input
                            id="email"
                            type="email"
                            required
                            autoFocus
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#00ef8b]/40 focus:ring-1 focus:ring-[#00ef8b]/10 transition-all text-sm font-mono"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full flex items-center justify-center gap-2 py-3 bg-[#00ef8b] hover:bg-[#00ef8b]/90 text-black font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm active:scale-[0.98]"
                        >
                          {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              Send magic link
                              <ArrowRight className="w-4 h-4" />
                            </>
                          )}
                        </button>
                      </form>

                      <p className="mt-4 text-center text-[11px] text-neutral-600 font-mono">
                        We&apos;ll send a 6-digit code and magic link to your inbox
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-center text-[11px] text-neutral-700 mt-6 font-mono"
            >
              By signing in, you agree to the FlowIndex Terms of Service
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
