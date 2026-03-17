import type { StoredTokens } from './types';

const DEFAULT_STORAGE_KEY = 'flowindex_dev_auth';
const DEFAULT_COOKIE_DOMAIN = '.flowindex.io';

/**
 * Read the cross-subdomain `fi_auth` cookie and return stored tokens.
 * Returns null during SSR or if the cookie is missing/invalid.
 */
export function loadTokensFromCookie(): StoredTokens | null {
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

/**
 * Load tokens from cookie (source of truth) with localStorage fallback.
 *
 * If the cookie exists, syncs to localStorage. If cookie is gone but
 * localStorage has tokens, attempts to restore the cookie once. If that
 * fails, clears localStorage to avoid stale pseudo-login loops.
 */
export function loadStoredTokens(storageKey?: string): StoredTokens | null {
  if (typeof window === 'undefined') return null;

  const key = storageKey ?? DEFAULT_STORAGE_KEY;

  // Cookie is the cross-subdomain source of truth.
  const fromCookie = loadTokensFromCookie();
  if (fromCookie) {
    // Sync into localStorage so future loads are fast.
    persistTokens(fromCookie.accessToken, fromCookie.refreshToken, { storageKey: key });
    return fromCookie;
  }

  // Backward-compat: if old localStorage tokens exist, attempt to restore cookie once.
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.accessToken && parsed?.refreshToken) {
        const fromStorage = parsed as StoredTokens;
        persistTokens(fromStorage.accessToken, fromStorage.refreshToken, { storageKey: key });
        const restoredCookie = loadTokensFromCookie();
        if (restoredCookie) return restoredCookie;

        // If cookie still cannot be restored, avoid local-only pseudo-login loops.
        localStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Persist tokens to both localStorage and the cross-subdomain fi_auth cookie.
 */
export function persistTokens(
  accessToken: string,
  refreshToken: string,
  options?: { storageKey?: string; cookieDomain?: string },
): void {
  const key = options?.storageKey ?? DEFAULT_STORAGE_KEY;
  const domain = options?.cookieDomain ?? DEFAULT_COOKIE_DOMAIN;

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify({ accessToken, refreshToken }));
    } catch { /* ignore */ }
  }

  if (typeof document !== 'undefined') {
    try {
      const value = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken });
      const isLocalDomain = domain === 'localhost' || domain === '127.0.0.1';
      const domainPart = isLocalDomain ? '' : `domain=${domain};`;
      const securePart = isLocalDomain ? '' : ' secure;';
      document.cookie = `fi_auth=${encodeURIComponent(value)}; ${domainPart} path=/; max-age=${60 * 60 * 24 * 30};${securePart} samesite=lax`;
    } catch { /* ignore */ }
  }
}

/**
 * Clear tokens from both localStorage and the cross-subdomain fi_auth cookie.
 */
export function clearTokens(
  options?: { storageKey?: string; cookieDomain?: string },
): void {
  const key = options?.storageKey ?? DEFAULT_STORAGE_KEY;
  const domain = options?.cookieDomain ?? DEFAULT_COOKIE_DOMAIN;

  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  }

  if (typeof document !== 'undefined') {
    try {
      const isLocalDomain = domain === 'localhost' || domain === '127.0.0.1';
      const domainPart = isLocalDomain ? '' : `domain=${domain};`;
      const securePart = isLocalDomain ? '' : ' secure;';
      document.cookie = `fi_auth=; ${domainPart} path=/; max-age=0;${securePart} samesite=lax`;
    } catch { /* ignore */ }
  }
}
