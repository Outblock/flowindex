// NOTE: We import from the generated output directly so webpack builds don't need
// custom scheme resolution for `fumadocs-mdx:collections/*`.
import { docs } from '../.source/server';
import { type InferPageType, loader, multiple } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { openapiSource, openapiPlugin } from 'fumadocs-openapi/server';
import { openapi } from '@/lib/openapi';

// See https://fumadocs.dev/docs/headless/source-api for more info
const apiSource = await openapiSource(openapi, {
  baseDir: 'api',
  groupBy: 'tag',
});

export const source = loader(
  multiple({
    docs: docs.toFumadocsSource(),
    api: apiSource,
  }),
  {
    baseUrl: '/docs',
    plugins: [lucideIconsPlugin(), openapiPlugin()],
  },
);

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}

export async function getLLMText(page: InferPageType<typeof source>) {
  if (typeof page.data.getText !== 'function') {
    return `# ${page.data.title ?? 'Untitled'}

${page.data.description ?? ''}`.trim();
  }

  const processed = await page.data.getText('processed');

  return `# ${page.data.title}

${processed}`;
}
