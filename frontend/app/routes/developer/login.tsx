import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Mail, ArrowRight, Loader2, Sparkles, Wallet } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export const Route = createFileRoute('/developer/login')({
  component: DeveloperLoginPage,
})

function DeveloperLoginPage() {
  const { user, loading: authLoading, sendMagicLink, verifyOtp } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [verifying, setVerifying] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: '/developer' })
    }
  }, [authLoading, user, navigate])

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await sendMagicLink(email)
      setOtpSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link')
    } finally {
      setLoading(false)
    }
  }

  function handleOtpChange(index: number, value: string) {
    if (value.length > 1) {
      // Handle paste of full OTP
      const digits = value.replace(/\D/g, '').slice(0, 6).split('')
      const newOtp = [...otp]
      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d
      })
      setOtp(newOtp)
      const nextIndex = Math.min(index + digits.length, 5)
      otpRefs.current[nextIndex]?.focus()
      // Auto-submit if all filled
      if (newOtp.every(d => d !== '')) {
        submitOtp(newOtp.join(''))
      }
      return
    }

    const newOtp = [...otp]
    newOtp[index] = value.replace(/\D/g, '')
    setOtp(newOtp)

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all 6 digits entered
    if (value && newOtp.every(d => d !== '')) {
      submitOtp(newOtp.join(''))
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  async function submitOtp(code: string) {
    setError(null)
    setVerifying(true)
    try {
      await verifyOtp(email, code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.')
      setOtp(['', '', '', '', '', ''])
      otpRefs.current[0]?.focus()
    } finally {
      setVerifying(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
      </div>
    )
  }

  // OTP verification screen
  if (otpSent) {
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
            <p className="text-neutral-400 mb-2">
              We sent a sign-in link and code to
            </p>
            <p className="text-white font-medium mb-6">{email}</p>

            {/* OTP Input */}
            <p className="text-sm text-neutral-400 mb-4">Enter the 6-digit code:</p>

            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
              >
                {error}
              </motion.div>
            )}

            <div className="flex justify-center gap-2 mb-6">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  disabled={verifying}
                  className="w-11 h-13 text-center text-xl font-bold bg-neutral-800 border border-neutral-700 rounded-lg text-[#00ef8b] focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/20 transition-colors disabled:opacity-50"
                  autoFocus={i === 0}
                />
              ))}
            </div>

            {verifying && (
              <div className="flex items-center justify-center gap-2 text-neutral-400 text-sm mb-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-neutral-500">Or click the magic link in your email</p>
              <div className="flex items-center justify-center gap-4 text-sm">
                <button
                  onClick={() => { setOtpSent(false); setOtp(['', '', '', '', '', '']); setError(null) }}
                  className="text-[#00ef8b] hover:text-[#00ef8b]/80 transition-colors"
                >
                  Use a different email
                </button>
                <span className="text-neutral-700">|</span>
                <button
                  onClick={async () => {
                    setError(null)
                    setLoading(true)
                    try {
                      await sendMagicLink(email)
                      setOtp(['', '', '', '', '', ''])
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to resend')
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? 'Sending...' : 'Resend code'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    )
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
            <h1 className="text-2xl font-bold text-white">Developer Portal</h1>
            <p className="text-sm text-neutral-400 mt-1">Sign in to manage your webhooks and API keys</p>
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
          <form onSubmit={handleSendLink} className="space-y-4">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#00ef8b] hover:bg-[#00ef8b]/90 text-black font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  Continue with Email
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 border-t border-neutral-800" />
            <span className="text-xs text-neutral-500 uppercase tracking-wider">or</span>
            <div className="flex-1 border-t border-neutral-800" />
          </div>

          {/* Wallet login - coming soon */}
          <button
            disabled
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-neutral-800 border border-neutral-700 text-neutral-500 font-semibold rounded-lg text-sm cursor-not-allowed relative"
          >
            <Wallet className="w-4 h-4" />
            Continue with Wallet
            <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wider bg-neutral-700 text-neutral-400 px-1.5 py-0.5 rounded">
              Coming Soon
            </span>
          </button>

          <p className="mt-6 text-center text-xs text-neutral-500">
            We&apos;ll send you a magic link and verification code
          </p>
        </div>
      </motion.div>
    </div>
  )
}
