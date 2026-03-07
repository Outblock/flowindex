import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Loader2, ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './InputOTP';

const ADJECTIVES = ['Swift', 'Bright', 'Coral', 'Jade', 'Amber', 'Frost', 'Lunar', 'Solar', 'Neon', 'Azure', 'Crimson', 'Golden', 'Silver', 'Violet', 'Copper'];
const NOUNS = ['Fox', 'Owl', 'Wolf', 'Bear', 'Hawk', 'Lynx', 'Puma', 'Orca', 'Crab', 'Dove', 'Frog', 'Hare', 'Seal', 'Wren', 'Elk'];

function randomWalletName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

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
  onPasskeyLogin?: () => Promise<void>;
  onPasskeyRegister?: (walletName?: string) => Promise<void>;
  hasPasskeySupport?: boolean;
}

export default function LoginModal({ open, onClose, onPasskeyLogin, onPasskeyRegister, hasPasskeySupport }: LoginModalProps) {
  const { signInWithProvider, sendMagicLink, verifyOtp } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [showPasskeySetup, setShowPasskeySetup] = useState(false);
  const [walletName, setWalletName] = useState(() => randomWalletName());

  const redirectTo = typeof window !== 'undefined' ? window.location.href : '/';

  const FRONTEND_ORIGIN = import.meta.env.VITE_FRONTEND_ORIGIN || 'https://flowindex.io';

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Route magic link through frontend's callback (already in GoTrue allow list)
      const callbackUrl = `${FRONTEND_ORIGIN}/developer/callback?redirect=${encodeURIComponent(redirectTo)}`;
      await sendMagicLink(email, callbackUrl);
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

  async function handlePasskey() {
    setError(null);
    setPasskeyLoading(true);
    try {
      if (onPasskeyLogin) {
        await onPasskeyLogin();
        onClose();
        return;
      }
    } catch (err) {
      // Login failed or user cancelled — show register form
      console.log('[passkey] login failed, showing register:', err instanceof Error ? err.message : err);
    }
    setPasskeyLoading(false);
    setShowPasskeySetup(true);
  }

  async function handlePasskeyCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPasskeyLoading(true);
    try {
      if (onPasskeyRegister) {
        await onPasskeyRegister(walletName || undefined);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey creation failed');
    } finally {
      setPasskeyLoading(false);
    }
  }

  function handleClose() {
    setEmail('');
    setError(null);
    setOtpSent(false);
    setOtpValue('');
    setShowEmailForm(false);
    setPasskeyLoading(false);
    setShowPasskeySetup(false);
    setWalletName('My Wallet');
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
            className="relative z-10 w-full max-w-[400px] mx-4 border border-zinc-700 bg-zinc-900 shadow-2xl"
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
                <Mail className="w-5 h-5 text-emerald-400 mx-auto mb-4" />
                <h2 className="text-sm font-semibold text-white mb-1">Check your email</h2>
                <p className="text-[11px] text-zinc-500 mb-0.5">We sent a 6-digit code to</p>
                <p className="text-[11px] text-white font-medium font-mono mb-5">{email}</p>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-mono">
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
                        className="h-10 w-9 text-base font-bold font-mono bg-zinc-950 border-zinc-700 text-emerald-400"
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
                      const callbackUrl = `${FRONTEND_ORIGIN}/developer/callback?redirect=${encodeURIComponent(redirectTo)}`;
                      await sendMagicLink(email, callbackUrl);
                      setOtpValue('');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to resend');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="text-[10px] text-zinc-500 hover:text-emerald-400 transition-colors disabled:opacity-50 font-mono uppercase tracking-wider"
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
            className="relative z-10 w-full max-w-[400px] mx-4 border border-zinc-700 bg-zinc-900 shadow-2xl"
          >
            {/* Close */}
            <button onClick={handleClose} className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="px-6 pt-8 pb-4 text-center">
              <h1 className="text-base font-semibold text-white tracking-tight">Sign in</h1>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                Save projects, sync across devices
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
                  <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-mono mb-3">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">
                {showPasskeySetup ? (
                  /* Passkey wallet name input */
                  <motion.div
                    key="passkey-setup"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={{ duration: 0.15 }}
                  >
                    <button
                      onClick={() => { setShowPasskeySetup(false); setError(null); }}
                      className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors mb-4 group font-mono uppercase tracking-wider"
                    >
                      <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                      All sign-in options
                    </button>

                    <form onSubmit={handlePasskeyCreate} className="space-y-3">
                      <div>
                        <label htmlFor="wallet-name" className="block text-[10px] font-medium text-zinc-400 mb-1.5 uppercase tracking-wider font-mono">
                          Wallet name
                        </label>
                        <input
                          id="wallet-name"
                          type="text"
                          autoFocus
                          value={walletName}
                          onChange={(e) => setWalletName(e.target.value)}
                          placeholder="My Wallet"
                          className="w-full px-3 py-2.5 bg-zinc-950 border border-zinc-700 text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 transition-all text-xs font-mono"
                        />
                        <p className="mt-1.5 text-[10px] text-zinc-600 font-mono">This name appears in your passkey manager</p>
                      </div>

                      <button
                        type="submit"
                        disabled={passkeyLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs active:scale-[0.98]"
                      >
                        {passkeyLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            Create Passkey Wallet
                            <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </form>
                  </motion.div>
                ) : !showEmailForm ? (
                  /* Provider buttons */
                  <motion.div
                    key="providers"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-2"
                  >
                    {/* Passkey — highlighted like GitHub */}
                    {hasPasskeySupport && (
                      <button
                        type="button"
                        onClick={handlePasskey}
                        disabled={passkeyLoading}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-zinc-100 text-zinc-900 font-medium transition-all text-xs group active:scale-[0.98] disabled:opacity-50"
                      >
                        <svg className="w-4 h-4 shrink-0 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
                          <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
                        </svg>
                        <span className="flex-1 text-left">
                          {passkeyLoading ? 'Authenticating...' : 'Continue with Passkey'}
                        </span>
                        {!passkeyLoading && (
                          <ArrowRight className="w-3.5 h-3.5 text-zinc-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        )}
                      </button>
                    )}

                    {/* GitHub */}
                    <button
                      type="button"
                      onClick={() => signInWithProvider('github', redirectTo)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-zinc-100 text-zinc-900 font-medium transition-all text-xs group active:scale-[0.98]"
                    >
                      <GitHubIcon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">Continue with GitHub</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </button>

                    {/* Google */}
                    <button
                      type="button"
                      onClick={() => signInWithProvider('google', redirectTo)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-200 font-medium transition-all text-xs group active:scale-[0.98]"
                    >
                      <GoogleIcon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">Continue with Google</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </button>

                    {/* Email */}
                    <button
                      type="button"
                      onClick={() => { setShowEmailForm(true); setError(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-200 font-medium transition-all text-xs group active:scale-[0.98]"
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
                          className="w-full px-3 py-2.5 bg-zinc-950 border border-zinc-700 text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 transition-all text-xs font-mono"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs active:scale-[0.98]"
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
