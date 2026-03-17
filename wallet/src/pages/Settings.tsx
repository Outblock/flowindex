import { useCallback, useState } from 'react';
import { useAuth } from '@flowindex/auth-ui';
import {
  Button,
  Badge,
  Switch,
  Input,
  Separator,
  cn,
  formatShort,
} from '@flowindex/flow-ui';
import {
  Fingerprint,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Shield,
  Globe,
  User,
  LogOut,
  Laptop,
  Smartphone,
  Cloud,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import type { PasskeyInfo, PasskeyAccount } from '@flowindex/auth-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso?: string): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function deviceIcon(deviceType?: string) {
  if (!deviceType) return Fingerprint;
  const lower = deviceType.toLowerCase();
  if (lower.includes('phone') || lower.includes('mobile')) return Smartphone;
  if (lower.includes('laptop') || lower.includes('desktop')) return Laptop;
  return Fingerprint;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-wallet-surface', className)} />
  );
}

// ---------------------------------------------------------------------------
// Passkey Row
// ---------------------------------------------------------------------------

function PasskeyRow({
  passkey,
  onRename,
  onRemove,
}: {
  passkey: PasskeyInfo;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(passkey.authenticatorName ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const DeviceIcon = deviceIcon(passkey.deviceType);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await onRename(passkey.id, editName.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemove(passkey.id);
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-wallet-border/50 last:border-0">
      <div className="w-10 h-10 rounded-2xl bg-wallet-surface flex items-center justify-center flex-shrink-0 mt-0.5">
        <DeviceIcon className="w-5 h-5 text-wallet-muted" />
      </div>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-7 text-sm bg-wallet-surface border-wallet-border text-white rounded-xl"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') {
                  setEditing(false);
                  setEditName(passkey.authenticatorName ?? '');
                }
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-wallet-accent hover:text-wallet-accent/80 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditName(passkey.authenticatorName ?? '');
              }}
              className="text-wallet-muted hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white truncate">
              {passkey.authenticatorName || 'Unnamed Passkey'}
            </p>
            <button
              onClick={() => {
                setEditName(passkey.authenticatorName ?? '');
                setEditing(true);
              }}
              className="text-wallet-muted hover:text-white transition-colors"
              title="Rename"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mt-1">
          {passkey.deviceType && (
            <span className="text-xs text-wallet-muted">{passkey.deviceType}</span>
          )}
          {passkey.backedUp && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 text-sky-400 border-sky-400/30 bg-sky-400/10 rounded-lg"
            >
              <Cloud className="w-2.5 h-2.5 mr-0.5" />
              Synced
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-4 mt-1.5 text-[11px] text-wallet-muted">
          <span>Created {formatDate(passkey.createdAt)}</span>
          {passkey.lastUsedAt && (
            <span>Last used {formatDate(passkey.lastUsedAt)}</span>
          )}
        </div>
      </div>

      <div className="flex-shrink-0">
        {confirmRemove ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs px-2 rounded-xl"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                'Confirm'
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2 text-wallet-muted rounded-xl"
              onClick={() => setConfirmRemove(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRemove(true)}
            className="text-wallet-muted hover:text-red-400 transition-colors p-1"
            title="Remove passkey"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Row
// ---------------------------------------------------------------------------

function AccountRow({
  account,
  network,
}: {
  account: PasskeyAccount;
  network: 'mainnet' | 'testnet';
}) {
  const address =
    network === 'testnet' ? account.flowAddressTestnet : account.flowAddress;

  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-wallet-border/50 last:border-0">
      <div className="w-10 h-10 rounded-2xl bg-wallet-surface flex items-center justify-center flex-shrink-0">
        <User className="w-5 h-5 text-wallet-muted" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {address ? (
            <p className="text-sm font-mono text-white">
              0x{formatShort(address, 6, 4)}
            </p>
          ) : (
            <p className="text-sm text-wallet-muted italic">Not provisioned</p>
          )}
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 h-4 rounded-lg',
              network === 'mainnet'
                ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
                : 'text-amber-400 border-amber-400/30 bg-amber-400/10',
            )}
          >
            {network}
          </Badge>
        </div>
        {account.evmAddress && (
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 rounded-lg text-violet-400 border-violet-400/30 bg-violet-400/10"
            >
              EVM
            </Badge>
            <p className="text-[11px] font-mono text-wallet-muted truncate">
              {formatShort(account.evmAddress, 6, 4)}
            </p>
          </div>
        )}
        <p className="text-[11px] text-wallet-muted mt-1 font-mono truncate">
          Key: {formatShort(account.publicKeySec1Hex, 8, 6)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export default function Settings() {
  const { user, passkey, signOut } = useAuth();
  const { accounts, network, switchNetwork, refreshAccounts } = useWallet();

  const [registerLoading, setRegisterLoading] = useState(false);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = useCallback(async () => {
    if (!passkey) return;
    setRegisterLoading(true);
    setError(null);
    try {
      await passkey.register();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register passkey');
    } finally {
      setRegisterLoading(false);
    }
  }, [passkey]);

  const handleRename = useCallback(
    async (credentialId: string, name: string) => {
      if (!passkey) return;
      setError(null);
      try {
        void credentialId;
        void name;
        // TODO: Add updatePasskey/removePasskey to PasskeyState interface
        await passkey.refreshState();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename passkey');
      }
    },
    [passkey],
  );

  const handleRemove = useCallback(
    async (credentialId: string) => {
      if (!passkey) return;
      setError(null);
      try {
        void credentialId;
        // TODO: Add removePasskey to PasskeyState interface
        await passkey.refreshState();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove passkey');
      }
    },
    [passkey],
  );

  const handleProvision = useCallback(async () => {
    if (!passkey || !passkey.selectedAccount) return;
    setProvisionLoading(true);
    setError(null);
    try {
      const result = await passkey.provisionAccounts(
        passkey.selectedAccount.credentialId,
      );

      for (const [net, info] of Object.entries(result.networks)) {
        if (info.txId && !info.address) {
          try {
            const addr = await passkey.pollProvisionTx(
              info.txId,
              net as 'mainnet' | 'testnet',
            );
            await passkey.saveProvisionedAddress(
              passkey.selectedAccount!.credentialId,
              net,
              addr,
            );
          } catch {
            // Individual network failure -- continue
          }
        }
      }

      await passkey.refreshState();
      await refreshAccounts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to provision account',
      );
    } finally {
      setProvisionLoading(false);
    }
  }, [passkey, refreshAccounts]);

  const passkeys = passkey?.passkeys ?? [];
  const passkeyLoading = passkey?.loading ?? false;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p>{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400/60 hover:text-red-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Passkeys Section */}
      <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-wallet-accent/12 flex items-center justify-center">
              <Fingerprint className="w-4 h-4 text-wallet-accent" />
            </div>
            <h2 className="text-base font-semibold text-white">Passkeys</h2>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 rounded-xl bg-wallet-accent hover:bg-wallet-accent/90 text-black font-semibold"
            onClick={handleRegister}
            disabled={registerLoading || passkeyLoading || !passkey}
          >
            {registerLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Add Passkey
          </Button>
        </div>

        {passkeyLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="w-10 h-10 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 rounded-xl" />
                  <Skeleton className="h-3 w-48 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : passkeys.length === 0 ? (
          <div className="text-center py-8">
            <Fingerprint className="w-10 h-10 text-wallet-muted mx-auto mb-3" />
            <p className="text-sm text-wallet-muted">No passkeys registered yet.</p>
            <p className="text-xs text-wallet-muted/70 mt-1">
              Add a passkey to enable passwordless authentication.
            </p>
          </div>
        ) : (
          <div>
            {passkeys.map((pk) => (
              <PasskeyRow
                key={pk.id}
                passkey={pk}
                onRename={handleRename}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Flow Accounts Section */}
      <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-wallet-accent/12 flex items-center justify-center">
              <User className="w-4 h-4 text-wallet-accent" />
            </div>
            <h2 className="text-base font-semibold text-white">Flow Accounts</h2>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 rounded-xl bg-wallet-accent hover:bg-wallet-accent/90 text-black font-semibold"
            onClick={handleProvision}
            disabled={provisionLoading || !passkey?.selectedAccount}
          >
            {provisionLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Create New Account
          </Button>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-8">
            <User className="w-10 h-10 text-wallet-muted mx-auto mb-3" />
            <p className="text-sm text-wallet-muted">No accounts found.</p>
            <p className="text-xs text-wallet-muted/70 mt-1">
              Register a passkey first, then create a Flow account.
            </p>
          </div>
        ) : (
          <div>
            {accounts.map((acct) => (
              <AccountRow
                key={acct.credentialId}
                account={acct}
                network={network}
              />
            ))}
          </div>
        )}
      </div>

      {/* Network Section */}
      <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-xl bg-wallet-accent/12 flex items-center justify-center">
            <Globe className="w-4 h-4 text-wallet-accent" />
          </div>
          <h2 className="text-base font-semibold text-white">Network</h2>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-3 h-3 rounded-full',
                network === 'mainnet' ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
            <div>
              <p className="text-sm font-medium text-white">
                {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
              </p>
              <p className="text-xs text-wallet-muted">
                {network === 'mainnet'
                  ? 'Production network'
                  : 'Test network for development'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-xs font-medium',
                network === 'mainnet' ? 'text-wallet-muted' : 'text-amber-400',
              )}
            >
              Testnet
            </span>
            <Switch
              checked={network === 'mainnet'}
              onCheckedChange={(checked) =>
                switchNetwork(checked ? 'mainnet' : 'testnet')
              }
            />
            <span
              className={cn(
                'text-xs font-medium',
                network === 'mainnet' ? 'text-emerald-400' : 'text-wallet-muted',
              )}
            >
              Mainnet
            </span>
          </div>
        </div>
      </div>

      {/* Security Section */}
      <div className="rounded-3xl bg-wallet-surface border border-wallet-border p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-xl bg-wallet-accent/12 flex items-center justify-center">
            <Shield className="w-4 h-4 text-wallet-accent" />
          </div>
          <h2 className="text-base font-semibold text-white">Security</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-wallet-muted">Email</p>
              <p className="text-sm font-medium text-white">
                {user?.email ?? '--'}
              </p>
            </div>
          </div>

          <Separator className="bg-wallet-border" />

          <Button
            variant="destructive"
            size="sm"
            className="gap-2 rounded-xl"
            onClick={signOut}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
