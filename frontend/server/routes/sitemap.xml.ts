/**
 * Dynamic sitemap.xml generated via Nitro server route.
 *
 * Includes:
 *   - Static pages (home, blocks, txs, tokens, nfts, accounts, contracts, stats, etc.)
 *   - All FT tokens (currently ~257)
 *   - All NFT collections (currently ~2600)
 *   - Top contracts (up to 1000)
 */

import { defineEventHandler, setResponseHeaders } from 'h3';

const SITE = 'https://flowindex.io';
// Nitro runs behind nginx on :8080; API routes are at /api/*
const API_BASE = (() => {
  const origin =
    (typeof process !== 'undefined' && process.env?.SSR_API_ORIGIN) ||
    'http://127.0.0.1:8080';
  return `${origin.replace(/\/+$/, '')}/api`;
})();

// Cache the sitemap in memory for 1 hour
let cached: { xml: string; ts: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

const STATIC_PAGES = [
  { path: '/', changefreq: 'always', priority: '1.0' },
  { path: '/blocks', changefreq: 'always', priority: '0.8' },
  { path: '/transactions', changefreq: 'always', priority: '0.8' },
  { path: '/txs', changefreq: 'always', priority: '0.8' },
  { path: '/tokens', changefreq: 'daily', priority: '0.8' },
  { path: '/nfts', changefreq: 'daily', priority: '0.8' },
  { path: '/accounts', changefreq: 'daily', priority: '0.7' },
  { path: '/contracts', changefreq: 'daily', priority: '0.7' },
  { path: '/stats', changefreq: 'daily', priority: '0.6' },
  { path: '/analytics', changefreq: 'daily', priority: '0.6' },
  { path: '/nodes', changefreq: 'daily', priority: '0.5' },
  { path: '/api-docs', changefreq: 'weekly', priority: '0.5' },
];

interface ApiResponse<T> {
  _meta: { count: number };
  data: T[];
}

async function fetchAll<T>(endpoint: string, limit = 500): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  // Safety cap at 10k items
  while (offset < 10000) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}?limit=${limit}&offset=${offset}`);
      if (!res.ok) break;
      const json = (await res.json()) as ApiResponse<T>;
      if (!json.data?.length) break;
      items.push(...json.data);
      if (items.length >= json._meta.count || json.data.length < limit) break;
      offset += limit;
    } catch {
      break;
    }
  }
  return items;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function urlEntry(loc: string, changefreq: string, priority: string, lastmod?: string): string {
  let entry = `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>`;
  if (lastmod) entry += `\n    <lastmod>${lastmod}</lastmod>`;
  entry += '\n  </url>';
  return entry;
}

async function buildSitemap(): Promise<string> {
  const urls: string[] = [];

  // Static pages
  for (const p of STATIC_PAGES) {
    urls.push(urlEntry(`${SITE}${p.path}`, p.changefreq, p.priority));
  }

  // FT tokens
  const tokens = await fetchAll<{ id: string; symbol?: string }>('/flow/ft');
  for (const t of tokens) {
    urls.push(urlEntry(`${SITE}/tokens/${encodeURIComponent(t.id)}`, 'daily', '0.6'));
  }

  // NFT collections
  const nfts = await fetchAll<{ id: string }>('/flow/nft');
  for (const n of nfts) {
    urls.push(urlEntry(`${SITE}/nfts/${encodeURIComponent(n.id)}`, 'daily', '0.6'));
  }

  // Contracts (top 1000)
  const contracts = await fetchAll<{ id: string }>('/flow/contract', 500);
  for (const c of contracts) {
    if (c.id) {
      urls.push(urlEntry(`${SITE}/contracts/${encodeURIComponent(c.id)}`, 'weekly', '0.5'));
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

export default defineEventHandler(async (event) => {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    setResponseHeaders(event, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    });
    return cached.xml;
  }

  try {
    const xml = await buildSitemap();
    cached = { xml, ts: Date.now() };
    setResponseHeaders(event, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    });
    return xml;
  } catch (err) {
    console.error('Sitemap generation failed:', err);
    // Return a minimal sitemap with just static pages
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${STATIC_PAGES.map((p) => urlEntry(`${SITE}${p.path}`, p.changefreq, p.priority)).join('\n')}
</urlset>`;
    setResponseHeaders(event, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    return fallback;
  }
});
