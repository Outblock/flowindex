import { Sparkles } from 'lucide-react';

export default function AI() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-wallet-accent/10 flex items-center justify-center mb-5">
        <Sparkles className="w-8 h-8 text-wallet-accent" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">AI Assistant</h2>
      <p className="text-sm text-wallet-muted max-w-xs leading-relaxed">
        Chat with AI to explore your wallet, understand transactions, and get help with Flow blockchain.
      </p>
      <div className="mt-6 px-5 py-2.5 rounded-2xl bg-wallet-surface border border-wallet-border text-sm text-wallet-muted">
        Coming soon
      </div>
    </div>
  );
}
