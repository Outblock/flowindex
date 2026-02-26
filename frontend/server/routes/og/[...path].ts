/**
 * Nitro catch-all server route for dynamic OG image generation.
 *
 * Routes:
 *   GET /og/home              → branded FlowIndex image
 *   GET /og/block/:height     → block detail image
 *   GET /og/tx/:id            → transaction detail image
 *   GET /og/account/:address  → account detail image
 *   GET /og/token/:name       → token detail image
 *   GET /og/nft/:type         → NFT collection image
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import {
  homeTemplate,
  blockTemplate,
  txTemplate,
  accountTemplate,
  tokenTemplate,
  nftTemplate,
} from '../../../app/lib/og/templates';

// Cache rendered PNGs in memory (bounded LRU-ish map)
const cache = new Map<string, { png: Buffer; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 200;

// Load Inter font at startup (fetched once from Google Fonts CDN)
let fontData: ArrayBuffer | null = null;
async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  const res = await fetch(
    'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf'
  );
  fontData = await res.arrayBuffer();
  return fontData;
}

function parseRoute(path: string): { type: string; param?: string } {
  // path comes in as e.g. "home", "block/12345", "tx/abc123"
  const segments = path.replace(/^\/+/, '').split('/');
  const type = segments[0] || 'home';
  const param = segments.slice(1).join('/') || undefined;
  return { type, param };
}

function selectTemplate(type: string, param?: string) {
  switch (type) {
    case 'block':
      return blockTemplate(param || '0');
    case 'tx':
    case 'transaction':
      return txTemplate(param || '???');
    case 'account':
      return accountTemplate(param || '0x???');
    case 'token':
      return tokenTemplate(decodeURIComponent(param || 'Token'));
    case 'nft':
      return nftTemplate(decodeURIComponent(param || 'NFT Collection'));
    case 'home':
    default:
      return homeTemplate();
  }
}

export default defineEventHandler(async (event) => {
  const path = (event.context.params as any)?.path || 'home';
  const cacheKey = path;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    setResponseHeaders(event, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
    });
    return cached.png;
  }

  try {
    const font = await loadFont();
    const { type, param } = parseRoute(path);
    const template = selectTemplate(type, param);

    const svg = await satori(template as any, {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Inter',
          data: font,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: font,
          weight: 600,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: font,
          weight: 700,
          style: 'normal',
        },
      ],
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Evict old entries if over limit
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(cacheKey, { png: Buffer.from(pngBuffer), ts: Date.now() });

    setResponseHeaders(event, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
    });
    return Buffer.from(pngBuffer);
  } catch (err) {
    console.error('OG image generation failed:', err);
    setResponseStatus(event, 500);
    return 'OG image generation failed';
  }
});
