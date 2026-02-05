// Reverse proxy for the FlowScan backend.
//
// This is mounted under `/api/*`. The portal also uses `/api/search` for Fumadocs,
// but Next will route the explicit `/api/search` handler first. Scalar "Try it"
// and spec loading use this route:
//   - /api/openapi.yaml
//   - /api/blocks?page=1
//
// Using a route handler (instead of next.config rewrites) keeps BACKEND_API_URL
// runtime-configurable and avoids edge/proxy quirks in some hosting setups.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path?: string[] }> };

function getBackendBaseUrl() {
  const raw = process.env.BACKEND_API_URL || 'http://localhost:8080';
  return raw.replace(/\/+$/, '');
}

async function proxy(req: Request, ctx: Context): Promise<Response> {
  const { path = [] } = await ctx.params;
  const backend = getBackendBaseUrl();

  const url = new URL(req.url);
  const joined = path.length ? `/${path.join('/')}` : '';
  const target = `${backend}${joined}${url.search}`;

  // Forward headers (minus hop-by-hop / host).
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Use ArrayBuffer so we can forward JSON / bytes without consuming the stream twice.
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  // Pass through status + headers; avoid broken encodings when Node fetch transparently decodes.
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete('content-encoding');
  outHeaders.delete('content-length');
  outHeaders.delete('transfer-encoding');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export function GET(req: Request, ctx: Context) {
  return proxy(req, ctx);
}
export function POST(req: Request, ctx: Context) {
  return proxy(req, ctx);
}
export function PUT(req: Request, ctx: Context) {
  return proxy(req, ctx);
}
export function PATCH(req: Request, ctx: Context) {
  return proxy(req, ctx);
}
export function DELETE(req: Request, ctx: Context) {
  return proxy(req, ctx);
}
export function OPTIONS(req: Request, ctx: Context) {
  return proxy(req, ctx);
}
