import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import {
  loadStoredTokens, persistTokens, clearTokens, loadTokensFromCookie,
  userFromToken, isExpired, secondsUntilExpiry,
  gotruePost, refreshAccessToken, buildOAuthRedirectUrl,
  createPasskeyAuthClient,
} from '@flowindex/auth-core';
import { signFlowTransaction, createPasskeyAuthz } from '@flowindex/flow-passkey';
import type { AuthUser, PasskeyAccount, PasskeyInfo } from '@flowindex/auth-core';
import type { AuthConfig, AuthContextValue, PasskeyState } from './types';

export const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'flowindex_dev_auth';

export function AuthProvider({ children, config }: { children: React.ReactNode; config: AuthConfig }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Passkey state
  const [passkeyAccounts, setPasskeyAccounts] = useState<PasskeyAccount[]>([]);
  const [passkeyInfos, setPasskeyInfos] = useState<PasskeyInfo[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<PasskeyAccount | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const passkeyLoadedRef = useRef(false);

  const storageOpts = { storageKey: STORAGE_KEY, cookieDomain: config.cookieDomain };
  const userOpts = { enableRoles: config.enableRoles !== false };

  // Create passkey client once (stable across renders)
  const passkeyClientRef = useRef(
    config.passkeyAuthUrl
      ? createPasskeyAuthClient({
          passkeyAuthUrl: config.passkeyAuthUrl,
          rpId: config.rpId || 'flowindex.io',
          rpName: config.rpName || 'FlowIndex',
        })
      : null,
  );

  // -----------------------------------------------------------------------
  // Token helpers (closures over config)
  // -----------------------------------------------------------------------

  const persist = useCallback(
    (at: string, rt: string) => persistTokens(at, rt, storageOpts),
    [config.cookieDomain],
  );

  const clear = useCallback(
    () => clearTokens(storageOpts),
    [config.cookieDomain],
  );

  // -----------------------------------------------------------------------
  // Token refresh scheduling
  // -----------------------------------------------------------------------

  const scheduleRefresh = useCallback(
    (aToken: string, rToken: string) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

      const secs = secondsUntilExpiry(aToken);
      const delayMs = Math.max((secs - 60) * 1000, 5_000);

      refreshTimerRef.current = setTimeout(async () => {
        try {
          const data = await refreshAccessToken(config.gotrueUrl, rToken);
          const u = userFromToken(data.access_token, userOpts);
          persist(data.access_token, data.refresh_token);
          setUser(u);
          setAccessToken(data.access_token);
          refreshTokenRef.current = data.refresh_token;
          scheduleRefresh(data.access_token, data.refresh_token);
        } catch {
          clear();
          setUser(null);
          setAccessToken(null);
          refreshTokenRef.current = null;
        }
      }, delayMs);
    },
    [config.gotrueUrl, persist, clear],
  );

  // -----------------------------------------------------------------------
  // Apply token response (shared helper)
  // -----------------------------------------------------------------------

  const applyTokenResponse = useCallback(
    (data: { access_token: string; refresh_token: string }) => {
      const u = userFromToken(data.access_token, userOpts);
      persist(data.access_token, data.refresh_token);
      setUser(u);
      setAccessToken(data.access_token);
      refreshTokenRef.current = data.refresh_token;
      scheduleRefresh(data.access_token, data.refresh_token);
    },
    [scheduleRefresh, persist],
  );

  // -----------------------------------------------------------------------
  // Restore session on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadStoredTokens(STORAGE_KEY);
      if (!stored) {
        setLoading(false);
        return;
      }

      if (!isExpired(stored.accessToken)) {
        if (!cancelled) {
          const u = userFromToken(stored.accessToken, userOpts);
          setUser(u);
          setAccessToken(stored.accessToken);
          refreshTokenRef.current = stored.refreshToken;
          scheduleRefresh(stored.accessToken, stored.refreshToken);
          setLoading(false);
        }
        return;
      }

      // Token expired -- try refresh
      try {
        const data = await refreshAccessToken(config.gotrueUrl, stored.refreshToken);
        if (!cancelled) {
          const u = userFromToken(data.access_token, userOpts);
          persist(data.access_token, data.refresh_token);
          setUser(u);
          setAccessToken(data.access_token);
          refreshTokenRef.current = data.refresh_token;
          scheduleRefresh(data.access_token, data.refresh_token);
        }
      } catch {
        if (!cancelled) {
          clear();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh, config.gotrueUrl, persist, clear]);

  // -----------------------------------------------------------------------
  // Logout detection (cookie sync)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!config.enableLogoutDetection) return;

    const checkCookieSync = () => {
      if (!refreshTokenRef.current) return;
      const cookieTokens = loadTokensFromCookie();
      if (!cookieTokens) {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        clear();
        setUser(null);
        setAccessToken(null);
        refreshTokenRef.current = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkCookieSync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = setInterval(checkCookieSync, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, [config.enableLogoutDetection, clear]);

  // -----------------------------------------------------------------------
  // Passkey state management
  // -----------------------------------------------------------------------

  const passkeyClient = passkeyClientRef.current;
  const rpId = config.rpId || 'flowindex.io';

  const refreshPasskeyState = useCallback(async (tokenOverride?: string | null) => {
    if (!passkeyClient) return;
    const token = tokenOverride ?? accessToken;
    if (!token) {
      setPasskeyInfos([]);
      setPasskeyAccounts([]);
      setSelectedAccount(null);
      return;
    }

    try {
      const [passkeyList, accountList] = await Promise.all([
        passkeyClient.listPasskeys(token),
        passkeyClient.listAccounts(token),
      ]);

      setPasskeyInfos(passkeyList);
      setPasskeyAccounts(accountList);
      setSelectedAccount((prev) => {
        if (!accountList.length) return null;
        if (prev) {
          const matched = accountList.find((a) => a.credentialId === prev.credentialId);
          if (matched) return matched;
        }
        return accountList[0];
      });
    } catch {
      setPasskeyInfos([]);
      setPasskeyAccounts([]);
      setSelectedAccount(null);
    }
  }, [passkeyClient, accessToken]);

  // Load passkey state when user authenticates
  useEffect(() => {
    if (!passkeyClient || !user || !accessToken || passkeyLoadedRef.current) return;
    passkeyLoadedRef.current = true;
    refreshPasskeyState(accessToken);
  }, [passkeyClient, user, accessToken, refreshPasskeyState]);

  // Reset passkey state on logout
  useEffect(() => {
    if (!user) {
      setPasskeyInfos([]);
      setPasskeyAccounts([]);
      setSelectedAccount(null);
      passkeyLoadedRef.current = false;
    }
  }, [user]);

  // -----------------------------------------------------------------------
  // Auth actions
  // -----------------------------------------------------------------------

  const signInWithProvider = useCallback((provider: 'github' | 'google', redirectTo?: string) => {
    const callbackPath = config.callbackPath || '/developer/callback';
    const base = callbackPath.startsWith('http')
      ? callbackPath
      : typeof window !== 'undefined'
        ? `${window.location.origin}${callbackPath}`
        : callbackPath;
    const callbackUrl = redirectTo ? `${base}?redirect=${encodeURIComponent(redirectTo)}` : base;
    window.location.href = buildOAuthRedirectUrl(config.gotrueUrl, provider, callbackUrl);
  }, [config.gotrueUrl, config.callbackPath]);

  const sendMagicLink = useCallback(async (email: string, redirectTo?: string) => {
    const payload: Record<string, unknown> = { email };
    if (redirectTo) {
      payload.redirect_to = redirectTo;
    }
    await gotruePost(config.gotrueUrl, '/magiclink', payload);
  }, [config.gotrueUrl]);

  const verifyOtp = useCallback(async (email: string, token: string) => {
    const data = await gotruePost(config.gotrueUrl, '/verify', { type: 'email', token, email });
    applyTokenResponse(data);
  }, [config.gotrueUrl, applyTokenResponse]);

  const handleCallback = useCallback((hash: string) => {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const at = params.get('access_token');
    const rt = params.get('refresh_token');
    if (at && rt) {
      applyTokenResponse({ access_token: at, refresh_token: rt });
    }
  }, [applyTokenResponse]);

  const signOut = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    clear();
    setUser(null);
    setAccessToken(null);
    refreshTokenRef.current = null;
  }, [clear]);

  // -----------------------------------------------------------------------
  // Build passkey state object (when configured)
  // -----------------------------------------------------------------------

  const passkeyState: PasskeyState | undefined = passkeyClient ? {
    hasSupport: typeof window !== 'undefined' && !!window.PublicKeyCredential,
    hasBoundPasskey: passkeyInfos.length > 0,
    accounts: passkeyAccounts,
    passkeys: passkeyInfos,
    selectedAccount,
    loading: passkeyLoading,

    selectAccount(credentialId: string) {
      const acct = passkeyAccounts.find((a) => a.credentialId === credentialId);
      if (acct) setSelectedAccount(acct);
    },

    async register(walletName?: string) {
      if (!accessToken) throw new Error('Not authenticated');
      setPasskeyLoading(true);
      try {
        const result = await passkeyClient.register(accessToken, walletName);
        await refreshPasskeyState(accessToken);
        return result;
      } finally {
        setPasskeyLoading(false);
      }
    },

    async login() {
      setPasskeyLoading(true);
      try {
        const { tokenHash } = await passkeyClient.login();
        if (tokenHash) {
          const data = await gotruePost(config.gotrueUrl, '/verify', {
            type: 'magiclink',
            token_hash: tokenHash,
          });
          applyTokenResponse(data);
          await refreshPasskeyState(data.access_token);
        }
      } finally {
        setPasskeyLoading(false);
      }
    },

    startConditionalLogin(onSuccess?: () => void): AbortController {
      const controller = new AbortController();
      passkeyClient
        .login({ mediation: 'conditional' as CredentialMediationRequirement, signal: controller.signal })
        .then(async ({ tokenHash }) => {
          if (tokenHash) {
            const data = await gotruePost(config.gotrueUrl, '/verify', {
              type: 'magiclink',
              token_hash: tokenHash,
            });
            applyTokenResponse(data);
            await refreshPasskeyState(data.access_token);
          }
          onSuccess?.();
        })
        .catch(() => {
          // Conditional login aborted or failed — silently ignore
        });
      return controller;
    },

    async sign(messageHex: string) {
      if (!selectedAccount) throw new Error('No passkey account selected');
      return signFlowTransaction({
        messageHex,
        credentialId: selectedAccount.credentialId,
        rpId,
      });
    },

    getFlowAuthz(address: string, keyIndex: number) {
      if (!selectedAccount) throw new Error('No passkey account selected');
      return createPasskeyAuthz({
        address,
        keyIndex,
        credentialId: selectedAccount.credentialId,
        rpId,
      });
    },

    async provisionAccounts(credentialId: string) {
      if (!accessToken) throw new Error('Not authenticated');
      return passkeyClient.provisionAccounts(accessToken, credentialId);
    },

    async pollProvisionTx(txId: string, network: 'mainnet' | 'testnet') {
      return passkeyClient.pollProvisionTx(txId, network);
    },

    async saveProvisionedAddress(credentialId: string, network: string, address: string) {
      if (!accessToken) throw new Error('Not authenticated');
      await passkeyClient.saveProvisionedAddress(accessToken, credentialId, network, address);
    },

    async refreshState() {
      await refreshPasskeyState();
    },
  } : undefined;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const value: AuthContextValue = {
    user,
    accessToken,
    loading,
    signInWithProvider,
    sendMagicLink,
    verifyOtp,
    signOut,
    handleCallback,
    applyTokenData: applyTokenResponse,
    passkey: passkeyState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
