import { createOpenAPI } from 'fumadocs-openapi/server';

function getBackendBaseUrl() {
  const raw = process.env.BACKEND_API_URL || 'http://localhost:8080';
  return raw.replace(/\/+$/, '');
}

export const openapi = createOpenAPI({
  input: async () => {
    const backend = getBackendBaseUrl();
    const res = await fetch(`${backend}/openapi.json`);
    if (!res.ok) {
      throw new Error(`failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);
    }

    const doc = (await res.json()) as Record<string, unknown>;

    // The explorer frontend serves the API under `/api`, but the docs portal exposes a reverse
    // proxy under `/flowscan-api/*`. Override servers so the playground works on the docs domain.
    doc.servers = [{ url: '/flowscan-api', description: 'FlowScan API (docs proxy)' }];

    return {
      flowscan: doc as any,
    };
  },
});

