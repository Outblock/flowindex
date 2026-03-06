import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
}

type OAuthProvider = 'github' | 'google';

export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  signInWithProvider: (provider: OAuthProvider, redirectTo?: string) => void;
  sendMagicLink: (email: string, redirectTo?: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  applyTokenData: (data: { access_token: string; refresh_token: string }) => void;
  signOut: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'flowindex_dev_auth';
const GOTRUE_URL = import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999';

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.exp === 'string') {
      const n = Number(parsed.exp);
      if (Number.isFinite(n)) parsed.exp = n;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isExpired(token: string): boolean {
  const payload = parseJwt(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0;
  if (!exp) return true;
  return Date.now() >= exp * 1000 - 5_000;
}

function secondsUntilExpiry(token: string): number {
  const payload = parseJwt(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0;
  if (!exp) return 0;
  return Math.max(0, exp - Date.now() / 1000);
}

function userFromToken(token: string): AuthUser | null {
  const payload = parseJwt(token);
  const sub = typeof payload?.sub === 'string' ? payload.sub : '';
  if (!sub) return null;
  return {
    id: sub,
    email: typeof payload?.email === 'string' ? payload.email : '',
  };
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

function loadTokensFromCookie(): StoredTokens | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(/(?:^|;\s*)fi_auth=([^;]*)/);
    if (!match) return null;
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (parsed?.access_token && parsed?.refresh_token) {
      return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token };
    }
    return null;
  } catch {
    return null;
  }
}

function loadStoredTokens(): StoredTokens | null {
  if (typeof window === 'undefined') return null;

  // Cookie is the cross-subdomain source of truth.
  // If the cookie is gone (main site logged out), clear localStorage too.
  const fromCookie = loadTokensFromCookie();

  if (fromCookie) {
    // Cookie present — sync to localStorage and use it
    persistTokens(fromCookie.accessToken, fromCookie.refreshToken);
    return fromCookie;
  }

  // No cookie — main site is logged out. Clear any stale localStorage tokens.
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  return null;
}

function persistTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
  try {
    const value = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken });
    document.cookie = `fi_auth=${encodeURIComponent(value)}; domain=.flowindex.io; path=/; max-age=${60 * 60 * 24 * 30}; secure; samesite=lax`;
  } catch {
    /* ignore */
  }
}

function clearTokens() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    document.cookie = 'fi_auth=; domain=.flowindex.io; path=/; max-age=0; secure; samesite=lax';
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// GoTrue helpers
// ---------------------------------------------------------------------------

async function gotruePost(path: string, body?: Record<string, unknown>) {
  const res = await fetch(`${GOTRUE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ msg: res.statusText }));
    throw new Error(err.msg || err.error_description || err.error || 'Auth request failed');
  }

  return res.json();
}

async function refreshAccessToken(
  token: string,
): Promise<{ access_token: string; refresh_token: string }> {
  return gotruePost('/token?grant_type=refresh_token', { refresh_token: token });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(
    (aToken: string, rToken: string) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

      const secs = secondsUntilExpiry(aToken);
      const delayMs = Math.max((secs - 60) * 1000, 5_000);

      refreshTimerRef.current = setTimeout(async () => {
        try {
          const data = await refreshAccessToken(rToken);
          const u = userFromToken(data.access_token);
          persistTokens(data.access_token, data.refresh_token);
          setUser(u);
          setAccessToken(data.access_token);
          refreshTokenRef.current = data.refresh_token;
          scheduleRefresh(data.access_token, data.refresh_token);
        } catch {
          clearTokens();
          setUser(null);
          setAccessToken(null);
          refreshTokenRef.current = null;
        }
      }, delayMs);
    },
    [],
  );

  // Restore session from cookie/localStorage on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadStoredTokens();
      if (!stored) {
        setLoading(false);
        return;
      }

      if (!isExpired(stored.accessToken)) {
        if (!cancelled) {
          const u = userFromToken(stored.accessToken);
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
        const data = await refreshAccessToken(stored.refreshToken);
        if (!cancelled) {
          const u = userFromToken(data.access_token);
          persistTokens(data.access_token, data.refresh_token);
          setUser(u);
          setAccessToken(data.access_token);
          refreshTokenRef.current = data.refresh_token;
          scheduleRefresh(data.access_token, data.refresh_token);
        }
      } catch {
        if (!cancelled) {
          clearTokens();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

  // Detect logout from main site: when user switches back to this tab,
  // check if the fi_auth cookie was cleared (main site sign-out).
  useEffect(() => {
    const checkCookieSync = () => {
      // Only act if we think we're logged in
      if (!refreshTokenRef.current) return;
      const cookieTokens = loadTokensFromCookie();
      if (!cookieTokens) {
        // Cookie gone — main site logged out. Clear Runner session.
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        clearTokens();
        setUser(null);
        setAccessToken(null);
        refreshTokenRef.current = null;
      }
    };

    // Check when tab becomes visible (user switches back from main site)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkCookieSync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Also poll every 30s as fallback (e.g. side-by-side windows)
    const interval = setInterval(checkCookieSync, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, []);

  const applyTokenResponse = useCallback(
    (data: { access_token: string; refresh_token: string }) => {
      const u = userFromToken(data.access_token);
      persistTokens(data.access_token, data.refresh_token);
      setUser(u);
      setAccessToken(data.access_token);
      refreshTokenRef.current = data.refresh_token;
      scheduleRefresh(data.access_token, data.refresh_token);
    },
    [scheduleRefresh],
  );

  const signInWithProvider = useCallback((provider: OAuthProvider, redirectTo?: string) => {
    // Route through the main frontend's callback which is already in GoTrue's allow list.
    // The fi_auth cookie on .flowindex.io will be set there, then it redirects back to us.
    const runnerUrl = redirectTo || (typeof window !== 'undefined' ? window.location.href : '/');
    const FRONTEND_ORIGIN = import.meta.env.VITE_FRONTEND_ORIGIN || 'https://flowindex.io';
    const callbackUrl = `${FRONTEND_ORIGIN}/developer/callback?redirect=${encodeURIComponent(runnerUrl)}`;
    window.location.href = `${GOTRUE_URL}/authorize?provider=${provider}&redirect_to=${encodeURIComponent(callbackUrl)}`;
  }, []);

  const sendMagicLink = useCallback(async (email: string, redirectTo?: string) => {
    const payload: Record<string, unknown> = { email };
    if (redirectTo) {
      payload.redirect_to = redirectTo;
    }
    await gotruePost('/magiclink', payload);
  }, []);

  const verifyOtp = useCallback(
    async (email: string, token: string) => {
      const data = await gotruePost('/verify', { type: 'email', token, email });
      applyTokenResponse(data);
    },
    [applyTokenResponse],
  );

  const signOut = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    clearTokens();
    setUser(null);
    setAccessToken(null);
    refreshTokenRef.current = null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, signInWithProvider, sendMagicLink, verifyOtp, applyTokenData: applyTokenResponse, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
