/**
 * Shared helpers for building OG meta tags across routes.
 */

const SITE_NAME = 'FlowIndex';
const DEFAULT_DESCRIPTION = 'High-performance blockchain explorer for the Flow Network';

function ogImageUrl(path: string): string {
  // In SSR, use the origin from the request; client-side, use window.location.origin.
  // For OG images, crawlers need an absolute URL, so we hardcode the production domain
  // and let the OG route handler work on any host.
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://flowindex.io';
  return `${base}/og/${path}`;
}

interface MetaInput {
  title: string;
  description: string;
  ogImagePath: string;
}

export function buildMeta({ title, description, ogImagePath }: MetaInput) {
  const fullTitle = `${title} | ${SITE_NAME}`;
  const imageUrl = ogImageUrl(ogImagePath);
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://flowindex.io';
  return [
    { title: fullTitle },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:url', content: base },
    { property: 'og:logo', content: `${base}/logo.png` },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: imageUrl },
  ];
}

export function defaultMeta() {
  return buildMeta({
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    ogImagePath: 'home',
  });
}
