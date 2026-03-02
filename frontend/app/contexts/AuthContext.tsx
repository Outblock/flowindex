import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthUser {
  id: string;
  email: string;
  role?: string;
  roles?: string[];
  team?: string;
  teams?: string[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
}

interface AuthContextValue extends AuthState {
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  sendMagicLink: (email: string, redirectTo?: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  handleCallback: (hash: string) => void;
  signOut: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'flowindex_dev_auth';
const GOTRUE_URL = import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    // Handle URL-safe base64
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
  // Consider expired if within 5 seconds of expiry
  return Date.now() >= exp * 1000 - 5_000;
}

function secondsUntilExpiry(token: string): number {
  const payload = parseJwt(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0;
  if (!exp) return 0;
  return Math.max(0, exp - Date.now() / 1000);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeClaimsList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function userFromToken(token: string): AuthUser | null {
  const payload = parseJwt(token);
  const sub = typeof payload?.sub === 'string' ? payload.sub : '';
  if (!sub) return null;

  const appMetadata = asObject(payload?.app_metadata);
  const userMetadata = asObject(payload?.user_metadata);

  const roles = unique([
    ...normalizeClaimsList(payload?.role),
    ...normalizeClaimsList(payload?.roles),
    ...normalizeClaimsList(appMetadata?.role),
    ...normalizeClaimsList(appMetadata?.roles),
    ...normalizeClaimsList(userMetadata?.role),
    ...normalizeClaimsList(userMetadata?.roles),
  ]);

  const teams = unique([
    ...normalizeClaimsList(payload?.team),
    ...normalizeClaimsList(payload?.teams),
    ...normalizeClaimsList(appMetadata?.team),
    ...normalizeClaimsList(appMetadata?.teams),
    ...normalizeClaimsList(userMetadata?.team),
    ...normalizeClaimsList(userMetadata?.teams),
  ]);

  return {
    id: sub,
    email: typeof payload?.email === 'string' ? payload.email : '',
    role: roles[0],
    roles,
    team: teams[0],
    teams,
  };
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

function loadStoredTokens(): StoredTokens | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.accessToken && parsed?.refreshToken) return parsed as StoredTokens;
    return null;
  } catch {
    return null;
  }
}

function persistTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
  // Set cross-subdomain cookie so ai.flowindex.io can share the session
  try {
    const value = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken });
    document.cookie = `fi_auth=${encodeURIComponent(value)}; domain=.flowindex.io; path=/; max-age=${60 * 60 * 24 * 30}; secure; samesite=lax`;
  } catch { /* ignore */ }
}

function clearTokens() {
  localStorage.removeItem(STORAGE_KEY);
  // Clear cross-subdomain cookie
  try {
    document.cookie = 'fi_auth=; domain=.flowindex.io; path=/; max-age=0; secure; samesite=lax';
  } catch { /* ignore */ }
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

async function refreshAccessToken(token: string): Promise<{ access_token: string; refresh_token: string }> {
  return gotruePost('/token?grant_type=refresh_token', { refresh_token: token });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    refreshToken: null,
    user: null,
  });
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule an auto-refresh 60 seconds before the token expires.
  const scheduleRefresh = useCallback((accessToken: string, rToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const secs = secondsUntilExpiry(accessToken);
    // Refresh 60s before expiry, but at least 5s from now
    const delayMs = Math.max((secs - 60) * 1000, 5_000);

    refreshTimerRef.current = setTimeout(async () => {
      try {
        const data = await refreshAccessToken(rToken);
        const user = userFromToken(data.access_token);
        persistTokens(data.access_token, data.refresh_token);
        setState({ accessToken: data.access_token, refreshToken: data.refresh_token, user });
        scheduleRefresh(data.access_token, data.refresh_token);
      } catch {
        // Refresh failed – sign out
        clearTokens();
        setState({ accessToken: null, refreshToken: null, user: null });
      }
    }, delayMs);
  }, []);

  // On mount: restore session from localStorage
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadStoredTokens();
      if (!stored) {
        setLoading(false);
        return;
      }

      // If the access token is still valid, use it directly.
      if (!isExpired(stored.accessToken)) {
        if (!cancelled) {
          const user = userFromToken(stored.accessToken);
          setState({ accessToken: stored.accessToken, refreshToken: stored.refreshToken, user });
          scheduleRefresh(stored.accessToken, stored.refreshToken);
          setLoading(false);
        }
        return;
      }

      // Token is expired – try refreshing
      try {
        const data = await refreshAccessToken(stored.refreshToken);
        if (!cancelled) {
          const user = userFromToken(data.access_token);
          persistTokens(data.access_token, data.refresh_token);
          setState({ accessToken: data.access_token, refreshToken: data.refresh_token, user });
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

  // ----------------------------------
  // Auth actions
  // ----------------------------------

  const applyTokenResponse = useCallback(
    (data: { access_token: string; refresh_token: string }) => {
      const user = userFromToken(data.access_token);
      persistTokens(data.access_token, data.refresh_token);
      setState({ accessToken: data.access_token, refreshToken: data.refresh_token, user });
      scheduleRefresh(data.access_token, data.refresh_token);
    },
    [scheduleRefresh],
  );

  const signUp = useCallback(async (email: string, password: string) => {
    await gotruePost('/signup', { email, password });
    // GoTrue signup may or may not auto-confirm. If it returns tokens, apply them.
    // Otherwise the user needs to confirm their email first.
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const data = await gotruePost('/token?grant_type=password', { email, password });
      applyTokenResponse(data);
    },
    [applyTokenResponse],
  );

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

  const handleCallback = useCallback(
    (hash: string) => {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        applyTokenResponse({ access_token: accessToken, refresh_token: refreshToken });
      }
    },
    [applyTokenResponse],
  );

  const signOut = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    clearTokens();
    setState({ accessToken: null, refreshToken: null, user: null });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        loading,
        signUp,
        signIn,
        sendMagicLink,
        verifyOtp,
        handleCallback,
        signOut,
      }}
    >
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
