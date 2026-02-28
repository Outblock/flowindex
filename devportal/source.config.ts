import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from 'fumadocs-mdx/config';
// import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  // Use the repository-level docs as the single source of truth.
  // This keeps the portal in sync with GitHub docs and avoids duplication.
  dir: '../docs',
  docs: {
    // Our repo docs are plain Markdown without required frontmatter.
    // Make the schema permissive so Fumadocs can derive titles from headings.
    schema: frontmatterSchema.partial(),
    // Exclude plans/ directory – contains implementation plans with code blocks
    // that use language identifiers unsupported by Shiki syntax highlighter.
    files: ['!./plans/**'],
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // Mermaid disabled temporarily while stabilizing Railway builds.
    remarkPlugins: [],
  },
});
