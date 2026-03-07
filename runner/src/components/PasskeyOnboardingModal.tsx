import { Loader2, ShieldCheck, Wallet, KeyRound } from 'lucide-react';

interface PasskeyOnboardingModalProps {
  open: boolean;
  email?: string;
  loading?: boolean;
  error?: string | null;
  onCreate: () => void;
  onSkip: () => void;
}

export default function PasskeyOnboardingModal({
  open,
  email,
  loading = false,
  error,
  onCreate,
  onSkip,
}: PasskeyOnboardingModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onSkip} />

      <div className="relative z-10 w-full max-w-[460px] mx-4 border border-zinc-700 bg-zinc-900 shadow-2xl">
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
          <div className="mx-6 mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-mono">
            {error}
          </div>
        )}

        <div className="px-6 pb-6 flex items-center gap-2">
          <button
            onClick={onSkip}
            disabled={loading}
            className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium border border-zinc-700 transition-colors disabled:opacity-50"
          >
            Not now
          </button>
          <button
            onClick={onCreate}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {loading ? 'Creating...' : 'Create Passkey Wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}
