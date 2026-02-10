const API_URL = import.meta.env.VITE_API_URL || '/api';

function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function resolveApiBaseUrl(): Promise<string> {
  if (!import.meta.env.SSR) {
    return normalizeBaseUrl(API_URL);
  }

  // In SSR, VITE_API_URL is often relative (eg "/api"), which is invalid in Node.
  // Prefer an internal origin if provided (eg "http://127.0.0.1:8080"), otherwise
  // fall back to localhost (works for docker-compose + containerized deploys where
  // Nginx listens on :8080 and proxies /api to the backend).
  if (isAbsoluteHttpUrl(API_URL)) return normalizeBaseUrl(API_URL);

  // NOTE: Avoid importing any server-only TanStack modules from this file because
  // it is part of the client bundle too (and would pull in node:stream, etc).
  const internalOrigin =
    (typeof process !== 'undefined' && process.env && process.env.SSR_API_ORIGIN) ||
    'http://127.0.0.1:8080';

  return normalizeBaseUrl(new URL(API_URL, internalOrigin).toString());
}

const WS_BASE = (() => {
  // WebSocket is client-only. Keep this branch dead in SSR bundles.
  if (import.meta.env.SSR) return '';

  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  if (API_URL.startsWith('https://')) return API_URL.replace('https://', 'wss://');
  if (API_URL.startsWith('http://')) return API_URL.replace('http://', 'ws://');
  return window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.host}`;
})();

export const WS_URL = import.meta.env.SSR
  ? ''
  : (WS_BASE.endsWith('/ws') ? WS_BASE : `${WS_BASE}/ws`);
