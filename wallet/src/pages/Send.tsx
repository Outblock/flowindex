import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TokenIcon,
  UsdValue,
  Button,
  Input,
  cn,
  formatShort,
} from '@flowindex/flow-ui';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ExternalLink,
  Fingerprint,
  Loader2,
  Send as SendIcon,
  Wallet,
  X,
} from 'lucide-react';
import * as fcl from '@onflow/fcl';
import { createPasskeyAuthz } from '@flowindex/flow-passkey';

import { useWallet } from '@/hooks/useWallet';
import {
  getAccount,
  getTokenPrices,
} from '@/api/flow';
import type { AccountData, VaultInfo } from '@/api/flow';
import { FLOW_TRANSFER_TX, MAINNET_ALIASES, TESTNET_ALIASES } from '@/cadence/scripts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RP_ID = import.meta.env.VITE_RP_ID || 'flowindex.io';
const MIN_STORAGE_RESERVE = 0.001;
const FLOW_ADDRESS_RE = /^0x[0-9a-fA-F]{16}$/;

type Step = 'form' | 'review' | 'signing' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TokenOption {
  id: string;
  name: string;
  symbol: string;
  logo?: string;
  balance: number;
  path?: string;
}

function isValidFlowAddress(addr: string): boolean {
  return FLOW_ADDRESS_RE.test(addr);
}

function formatUFix64(n: number): string {
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0');
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-wallet-surface', className)} />
  );
}

// ---------------------------------------------------------------------------
// Token Selector
// ---------------------------------------------------------------------------

function TokenSelector({
  tokens,
  selected,
  onSelect,
}: {
  tokens: TokenOption[];
  selected: TokenOption | null;
  onSelect: (t: TokenOption) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!selected) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl border border-wallet-border bg-wallet-surface hover:bg-wallet-surface-hover transition-colors text-left"
      >
        <TokenIcon
          logoUrl={selected.logo}
          name={selected.name}
          symbol={selected.symbol}
          size={32}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{selected.name}</p>
          <p className="text-xs text-wallet-muted">{selected.symbol}</p>
        </div>
        <div className="text-right mr-2">
          <p className="text-sm font-mono text-zinc-300">
            {selected.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-wallet-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-2xl border border-wallet-border bg-wallet-surface shadow-lg">
          {tokens.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onSelect(t);
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-3 w-full px-4 py-3 hover:bg-wallet-surface-hover transition-colors text-left',
                t.id === selected.id && 'bg-wallet-accent/5',
              )}
            >
              <TokenIcon
                logoUrl={t.logo}
                name={t.name}
                symbol={t.symbol}
                size={28}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{t.name}</p>
              </div>
              <p className="text-sm font-mono text-wallet-muted">
                {t.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </p>
              {t.id === selected.id && (
                <Check className="w-4 h-4 text-wallet-accent flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Send Page
// ---------------------------------------------------------------------------

export default function Send() {
  const { activeAccount, network, loading: walletLoading } = useWallet();

  const [account, setAccount] = useState<AccountData | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [dataLoading, setDataLoading] = useState(false);

  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address =
    network === 'testnet'
      ? activeAccount?.flowAddressTestnet
      : activeAccount?.flowAddress;

  const fetchData = useCallback(async () => {
    if (!address) return;
    setDataLoading(true);
    try {
      const [acct, tokenPrices] = await Promise.allSettled([
        getAccount(address),
        getTokenPrices(),
      ]);
      if (acct.status === 'fulfilled') setAccount(acct.value);
      if (tokenPrices.status === 'fulfilled') setPrices(tokenPrices.value);
    } finally {
      setDataLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const tokens: TokenOption[] = useMemo(() => {
    const result: TokenOption[] = [];
    const flowBalance = account?.flowBalance ?? 0;
    result.push({
      id: 'FLOW',
      name: 'Flow',
      symbol: 'FLOW',
      logo: undefined,
      balance: flowBalance,
    });

    const vaults = account?.vaults;
    if (vaults) {
      for (const [, v] of Object.entries(vaults) as [string, VaultInfo][]) {
        if (v.symbol === 'FLOW') continue;
        const balance = v.balance ?? 0;
        if (balance <= 0) continue;
        result.push({
          id: v.token ?? v.path ?? v.symbol ?? '',
          name: v.name ?? v.symbol ?? '',
          symbol: v.symbol ?? '',
          logo: v.logo,
          balance,
          path: v.path,
        });
      }
    }

    return result;
  }, [account]);

  useEffect(() => {
    if (tokens.length > 0 && !selectedToken) {
      setSelectedToken(tokens[0]);
    }
  }, [tokens, selectedToken]);

  const parsedAmount = parseFloat(amount);
  const isFlowToken = selectedToken?.id === 'FLOW';
  const maxBalance = selectedToken?.balance ?? 0;
  const maxSendable = isFlowToken
    ? Math.max(0, maxBalance - MIN_STORAGE_RESERVE)
    : maxBalance;

  const tokenPrice =
    prices[selectedToken?.symbol ?? ''] ??
    prices[(selectedToken?.symbol ?? '').toUpperCase()] ??
    0;
  const usdAmount = !isNaN(parsedAmount) ? parsedAmount * tokenPrice : 0;

  const recipientError = useMemo(() => {
    if (!recipient) return null;
    if (!isValidFlowAddress(recipient)) {
      return 'Invalid Flow address (expected 0x followed by 16 hex characters)';
    }
    if (address && recipient.toLowerCase() === `0x${address}`.toLowerCase()) {
      return 'Cannot send to yourself';
    }
    return null;
  }, [recipient, address]);

  const amountError = useMemo(() => {
    if (!amount) return null;
    if (isNaN(parsedAmount) || parsedAmount <= 0) return 'Enter a valid amount';
    if (parsedAmount > maxSendable) {
      return isFlowToken
        ? `Exceeds max sendable (${maxSendable.toLocaleString()} FLOW, reserving ${MIN_STORAGE_RESERVE} for storage)`
        : `Exceeds available balance (${maxSendable.toLocaleString()})`;
    }
    return null;
  }, [amount, parsedAmount, maxSendable, isFlowToken]);

  const canReview =
    !!recipient &&
    !recipientError &&
    !!amount &&
    !amountError &&
    parsedAmount > 0 &&
    !!selectedToken;

  const handleSend = useCallback(async () => {
    if (!activeAccount || !address || !selectedToken) return;

    if (!isFlowToken) {
      setError('Only FLOW transfers are supported in this version.');
      setStep('error');
      return;
    }

    setStep('signing');
    setError(null);

    try {
      const accessNode =
        network === 'testnet'
          ? 'https://rest-testnet.onflow.org'
          : 'https://rest-mainnet.onflow.org';

      const aliases = network === 'testnet' ? TESTNET_ALIASES : MAINNET_ALIASES;

      fcl.config().put('accessNode.api', accessNode);
      for (const [alias, addr] of Object.entries(aliases)) {
        fcl.config().put(alias, addr);
      }

      const authz = createPasskeyAuthz({
        address: `0x${address}`,
        keyIndex: 0,
        credentialId: activeAccount.credentialId,
        rpId: RP_ID,
      });

      const txResult = await fcl.mutate({
        cadence: FLOW_TRANSFER_TX,
        args: (arg: typeof fcl.arg, t: typeof fcl.t) => [
          arg(formatUFix64(parsedAmount), t.UFix64),
          arg(recipient, t.Address),
        ],
        proposer: authz,
        payer: authz,
        authorizations: [authz],
        limit: 9999,
      });

      setTxId(txResult);
      setStep('success');

      fcl.tx(txResult).onceSealed().catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      if (message.includes('cancelled') || message.includes('canceled')) {
        setStep('review');
        return;
      }
      setError(message);
      setStep('error');
    }
  }, [activeAccount, address, selectedToken, isFlowToken, network, parsedAmount, recipient]);

  const reset = useCallback(() => {
    setRecipient('');
    setAmount('');
    setTxId(null);
    setError(null);
    setStep('form');
  }, []);

  const explorerBase =
    network === 'testnet'
      ? 'https://testnet.flowindex.io'
      : 'https://flowindex.io';

  // No account
  if (!walletLoading && !address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-wallet-surface flex items-center justify-center mb-5">
          <Wallet className="w-8 h-8 text-wallet-muted" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">No Account Found</h2>
        <p className="text-sm text-wallet-muted max-w-xs">
          Create or connect a Flow account to send tokens.
        </p>
      </div>
    );
  }

  const loading = walletLoading || dataLoading;

  // Success view
  if (step === 'success') {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-wallet-accent/10 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-wallet-accent" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Transaction Submitted</h2>
          <p className="text-sm text-wallet-muted mb-6">
            Your transfer of{' '}
            <span className="font-mono text-white">
              {parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
              {selectedToken?.symbol}
            </span>{' '}
            to{' '}
            <span className="font-mono text-white">
              {formatShort(recipient, 6, 4)}
            </span>{' '}
            has been submitted to the network.
          </p>

          {txId && (
            <a
              href={`${explorerBase}/tx/${txId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-wallet-accent hover:text-wallet-accent/80 transition-colors font-mono mb-6"
            >
              {formatShort(txId, 8, 6)}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={reset}
              className="rounded-2xl border-wallet-border text-wallet-muted hover:text-white hover:bg-wallet-surface-hover"
            >
              Send Another
            </Button>
            {txId && (
              <Button
                asChild
                className="rounded-2xl bg-wallet-accent hover:bg-wallet-accent/90 text-black font-semibold"
              >
                <a
                  href={`${explorerBase}/tx/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on Explorer
                  <ExternalLink className="w-4 h-4 ml-2" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Error view
  if (step === 'error') {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Transaction Failed</h2>
          <p className="text-sm text-red-400 font-mono mb-6 max-w-md mx-auto break-all">
            {error}
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={reset}
              className="rounded-2xl border-wallet-border text-wallet-muted hover:text-white hover:bg-wallet-surface-hover"
            >
              Start Over
            </Button>
            <Button
              onClick={() => setStep('review')}
              className="rounded-2xl bg-wallet-accent hover:bg-wallet-accent/90 text-black font-semibold"
            >
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Review view
  if (step === 'review') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep('form')}
            className="text-wallet-muted hover:text-white transition-colors w-10 h-10 rounded-2xl hover:bg-wallet-surface flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold text-white">Review Transaction</h1>
        </div>

        <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-6 space-y-4">
          <div className="text-center py-4">
            <div className="flex items-center justify-center gap-3 mb-3">
              <TokenIcon
                logoUrl={selectedToken?.logo}
                name={selectedToken?.name ?? ''}
                symbol={selectedToken?.symbol ?? ''}
                size={40}
              />
            </div>
            <p className="text-3xl font-bold text-white font-mono">
              {parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
              <span className="text-lg text-wallet-muted font-normal">
                {selectedToken?.symbol}
              </span>
            </p>
            {usdAmount > 0 && (
              <UsdValue value={usdAmount} className="text-base mt-1" />
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2.5 border-b border-wallet-border/50">
              <span className="text-sm text-wallet-muted">From</span>
              <span className="text-sm font-mono text-white">
                0x{formatShort(address ?? '', 6, 4)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-wallet-border/50">
              <span className="text-sm text-wallet-muted">To</span>
              <span className="text-sm font-mono text-white">
                {formatShort(recipient, 6, 4)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-wallet-border/50">
              <span className="text-sm text-wallet-muted">Network</span>
              <span className="text-sm text-white capitalize">{network}</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-wallet-muted">Estimated Fee</span>
              <span className="text-sm font-mono text-zinc-300">&lt; 0.001 FLOW</span>
            </div>
          </div>
        </div>

        <Button
          onClick={handleSend}
          className="w-full h-12 rounded-2xl bg-wallet-accent hover:bg-wallet-accent/90 text-black font-semibold text-base"
        >
          <Fingerprint className="w-5 h-5 mr-2" />
          Sign &amp; Send
        </Button>
      </div>
    );
  }

  // Signing overlay
  if (step === 'signing') {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-wallet-accent/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Fingerprint className="w-8 h-8 text-wallet-accent" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Confirm with Passkey</h2>
          <p className="text-sm text-wallet-muted mb-4">
            Use your passkey to sign this transaction.
          </p>
          <Loader2 className="w-6 h-6 animate-spin text-wallet-accent mx-auto" />
        </div>
      </div>
    );
  }

  // Form view (default)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-wallet-accent/12 flex items-center justify-center">
          <SendIcon className="w-4 h-4 text-wallet-accent" />
        </div>
        <h1 className="text-lg font-semibold text-white">Send Tokens</h1>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-6 space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-6 space-y-5">
          {/* Token selector */}
          <div>
            <label className="block text-sm text-wallet-muted mb-2 font-medium">Token</label>
            <TokenSelector
              tokens={tokens}
              selected={selectedToken}
              onSelect={setSelectedToken}
            />
          </div>

          {/* Recipient */}
          <div>
            <label className="block text-sm text-wallet-muted mb-2 font-medium">Recipient</label>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x0000000000000000"
              className={cn(
                'bg-wallet-bg border-wallet-border text-white font-mono placeholder:text-wallet-muted/50 h-12 rounded-2xl',
                recipientError && recipient && 'border-red-500/50',
              )}
              spellCheck={false}
              autoComplete="off"
            />
            {recipientError && recipient && (
              <p className="text-xs text-red-400 mt-1.5">{recipientError}</p>
            )}
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-wallet-muted font-medium">Amount</label>
              <button
                type="button"
                onClick={() => setAmount(String(maxSendable))}
                className="text-xs text-wallet-accent hover:text-wallet-accent/80 transition-colors font-mono"
              >
                Max: {maxSendable.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </button>
            </div>
            <div className="relative">
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="any"
                className={cn(
                  'bg-wallet-bg border-wallet-border text-white font-mono placeholder:text-wallet-muted/50 h-12 rounded-2xl pr-20',
                  amountError && amount && 'border-red-500/50',
                )}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-wallet-muted font-mono">
                {selectedToken?.symbol}
              </span>
            </div>
            {amountError && amount && (
              <p className="text-xs text-red-400 mt-1.5">{amountError}</p>
            )}
            {usdAmount > 0 && !amountError && (
              <UsdValue value={usdAmount} className="text-xs mt-1.5" />
            )}
          </div>

          {/* Only FLOW supported notice */}
          {selectedToken && !isFlowToken && (
            <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
              <p className="text-xs text-amber-400">
                Only FLOW transfers are currently supported. Support for other tokens is coming soon.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Review button */}
      <Button
        onClick={() => setStep('review')}
        disabled={!canReview || !isFlowToken || loading}
        className="w-full h-12 rounded-2xl bg-wallet-accent hover:bg-wallet-accent/90 text-black font-semibold text-base disabled:opacity-40"
      >
        <ArrowUpRight className="w-5 h-5 mr-2" />
        Review Transaction
      </Button>
    </div>
  );
}
