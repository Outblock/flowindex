import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Loader2, ArrowLeft, ArrowRight, X, KeyRound } from 'lucide-react';
import { useAuth } from './useAuth';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './InputOTP';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  redirectTo?: string;
  showPasskey?: boolean;
  className?: string;
}

export default function LoginModal({ open, onClose, redirectTo: redirectToProp, showPasskey, className }: LoginModalProps) {
  const { signInWithProvider, sendMagicLink, verifyOtp, passkey } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const redirectTo = redirectToProp ?? (typeof window !== 'undefined' ? window.location.href : '/');

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendMagicLink(email, redirectTo);
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link');
    } finally {
      setLoading(false);
    }
  }

  const submitOtp = useCallback(async (code: string) => {
    setError(null);
    setVerifying(true);
    try {
      await verifyOtp(email, code);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
      setOtpValue('');
    } finally {
      setVerifying(false);
    }
  }, [email, verifyOtp, onClose]);

  function handleOtpChange(value: string) {
    setOtpValue(value);
    if (value.length === 6) {
      submitOtp(value);
    }
  }

  function handleClose() {
    setEmail('');
    setError(null);
    setOtpSent(false);
    setOtpValue('');
    setShowEmailForm(false);
    onClose();
  }

  async function handlePasskeyLogin() {
    if (!passkey) return;
    setError(null);
    setLoading(true);
    try {
      await passkey.login();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey sign in failed');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${className || ''}`}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <AnimatePresence mode="wait">
        {otpSent ? (
          /* OTP verification */
          <motion.div
            key="otp"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-[400px] mx-4 border border-[var(--auth-border,#3f3f46)] bg-[var(--auth-bg,#18181b)] rounded-lg shadow-2xl"
          >
            {/* Close */}
            <button onClick={handleClose} className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="w-4 h-4" />
            </button>

            <div className="p-6">
              <button
                onClick={() => { setOtpSent(false); setOtpValue(''); setError(null); }}
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors mb-5 group font-mono uppercase tracking-wider"
              >
                <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                Back
              </button>

              <div className="text-center">
                <Mail className="w-5 h-5 text-[var(--auth-accent,#10b981)] mx-auto mb-4" />
                <h2 className="text-sm font-semibold text-white mb-1">Check your email</h2>
                <p className="text-[11px] text-zinc-500 mb-0.5">We sent a 6-digit code to</p>
                <p className="text-[11px] text-white font-medium font-mono mb-5">{email}</p>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[11px] font-mono">
                  {error}
                </div>
              )}

              <div className="flex justify-center mb-5">
                <InputOTP maxLength={6} value={otpValue} onChange={handleOtpChange} disabled={verifying} autoFocus>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map(i => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-10 w-9 text-base font-bold font-mono bg-zinc-950 border-[var(--auth-border,#3f3f46)] text-[var(--auth-accent,#10b981)]"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {verifying && (
                <div className="flex items-center justify-center gap-2 text-zinc-400 text-[11px] mb-3 font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Verifying...
                </div>
              )}

              <div className="text-center space-y-2">
                <p className="text-[10px] text-zinc-600 font-mono">Or click the magic link in your email</p>
                <button
                  onClick={async () => {
                    setError(null);
                    setLoading(true);
                    try {
                      await sendMagicLink(email, redirectTo);
                      setOtpValue('');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to resend');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="text-[10px] text-zinc-500 hover:text-[var(--auth-accent,#10b981)] transition-colors disabled:opacity-50 font-mono uppercase tracking-wider"
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
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-[400px] mx-4 border border-[var(--auth-border,#3f3f46)] bg-[var(--auth-bg,#18181b)] rounded-lg shadow-2xl"
          >
            {/* Close */}
            <button onClick={handleClose} className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="px-6 pt-8 pb-4 text-center">
              <h1 className="text-base font-semibold text-white tracking-tight">Sign in</h1>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                Save projects, create{' '}
                <a
                  href="https://developers.flow.com/build/cadence/advanced-concepts/passkeys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--auth-accent,#10b981)] hover:opacity-80 transition-colors"
                >
                  passkey
                </a>
                <span className="text-zinc-600">(self-custody)</span> wallet
              </p>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-6"
                >
                  <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[11px] font-mono mb-3">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">
                {!showEmailForm ? (
                  /* Provider buttons */
                  <motion.div
                    key="providers"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-2"
                  >
                    {/* Passkey */}
                    {showPasskey && passkey && passkey.hasSupport && (
                      <button
                        type="button"
                        onClick={handlePasskeyLogin}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-[var(--auth-accent,#10b981)] hover:opacity-90 text-white font-medium rounded-lg transition-all text-xs group active:scale-[0.98] disabled:opacity-50"
                      >
                        <KeyRound className="w-4 h-4 shrink-0" />
                        <span className="flex-1 text-left">Sign in with Passkey</span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </button>
                    )}

                    {/* GitHub */}
                    <button
                      type="button"
                      onClick={() => signInWithProvider('github', redirectTo)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-lg transition-all text-xs group active:scale-[0.98]"
                    >
                      <GitHubIcon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">Continue with GitHub</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </button>

                    {/* Google */}
                    <button
                      type="button"
                      onClick={() => signInWithProvider('google', redirectTo)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 border border-[var(--auth-border,#3f3f46)] hover:border-zinc-600 text-zinc-200 font-medium rounded-lg transition-all text-xs group active:scale-[0.98]"
                    >
                      <GoogleIcon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">Continue with Google</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </button>

                    {/* Email */}
                    <button
                      type="button"
                      onClick={() => { setShowEmailForm(true); setError(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 border border-[var(--auth-border,#3f3f46)] hover:border-zinc-600 text-zinc-200 font-medium rounded-lg transition-all text-xs group active:scale-[0.98]"
                    >
                      <Mail className="w-4 h-4 shrink-0 text-zinc-400" />
                      <span className="flex-1 text-left">Continue with Email</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </button>
                  </motion.div>
                ) : (
                  /* Email form */
                  <motion.div
                    key="email"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={{ duration: 0.15 }}
                  >
                    <button
                      onClick={() => { setShowEmailForm(false); setError(null); }}
                      className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors mb-4 group font-mono uppercase tracking-wider"
                    >
                      <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                      All sign-in options
                    </button>

                    <form onSubmit={handleSendLink} className="space-y-3">
                      <div>
                        <label htmlFor="login-email" className="block text-[10px] font-medium text-zinc-400 mb-1.5 uppercase tracking-wider font-mono">
                          Email address
                        </label>
                        <input
                          id="login-email"
                          type="email"
                          required
                          autoFocus
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full px-3 py-2.5 bg-zinc-950 border border-[var(--auth-border,#3f3f46)] rounded-lg text-white placeholder:text-zinc-600 focus:outline-none focus:border-[var(--auth-accent,#10b981)]/40 focus:ring-1 focus:ring-[var(--auth-accent,#10b981)]/10 transition-all text-xs font-mono"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-[var(--auth-accent,#10b981)] hover:opacity-90 rounded-lg text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs active:scale-[0.98]"
                      >
                        {loading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            Send magic link
                            <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </form>

                    <p className="mt-3 text-center text-[10px] text-zinc-600 font-mono">
                      We'll send a 6-digit code and magic link to your inbox
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
