import { useState } from 'react';
import { Loader2, ShieldCheck, Wallet, KeyRound } from 'lucide-react';

interface PasskeyOnboardingModalProps {
  open: boolean;
  email?: string;
  loading?: boolean;
  error?: string | null;
  onCreate: () => void;
  onSkip: () => void;
  onDontShowAgain: () => void;
}

export default function PasskeyOnboardingModal({
  open,
  email,
  loading = false,
  error,
  onCreate,
  onSkip,
  onDontShowAgain,
}: PasskeyOnboardingModalProps) {
  const [dontShow, setDontShow] = useState(false);

  if (!open) return null;

  function handleSkip() {
    if (dontShow) {
      onDontShowAgain();
    } else {
      onSkip();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={handleSkip} />

      <div className="relative z-10 w-full max-w-[460px] mx-4 border border-zinc-700 bg-zinc-900 rounded-lg shadow-2xl">
        <div className="px-6 pt-6 pb-5 border-b border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-mono">Recommended</div>
          <h2 className="mt-1.5 text-base font-semibold text-white">Create your Passkey Wallet</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {email ? `Bind passkey to ${email}` : 'Bind passkey to your account'} and use one touch to sign in and sign Flow transactions.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3 text-xs">
          <div className="flex items-start gap-2.5 text-zinc-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Self-custody security</div>
              <div className="text-zinc-500 mt-0.5">Your private key stays on your device/iCloud keychain.</div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-zinc-300">
            <Wallet className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Automatic Flow wallet</div>
              <div className="text-zinc-500 mt-0.5">FlowIndex automatically provisions a Flow account after passkey binding.</div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-zinc-300">
            <KeyRound className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Passwordless sign-in</div>
              <div className="text-zinc-500 mt-0.5">Use passkey across devices and browsers where your keychain syncs.</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[11px] font-mono">
            {error}
          </div>
        )}

        <div className="px-6 pb-4 flex items-center gap-2">
          <button
            onClick={handleSkip}
            disabled={loading}
            className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium border border-zinc-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Not now
          </button>
          <button
            onClick={onCreate}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {loading ? 'Creating...' : 'Create Passkey Wallet'}
          </button>
        </div>

        <div className="px-6 pb-5">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-[11px] text-zinc-500 group-hover:text-zinc-400 transition-colors select-none">
              Don't show this again
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
