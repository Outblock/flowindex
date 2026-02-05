import { createMDX } from 'fumadocs-mdx/next';
import path from 'path';
import { fileURLToPath } from 'url';

const withMDX = createMDX();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  reactStrictMode: true,
  // Railway build containers can report very high CPU counts, which makes Next spawn
  // dozens of static-analysis workers. That often stalls/ooms during `next build`.
  // Keep it conservative for predictable CI builds.
  experimental: {
    cpus: 8,
  },
  // Avoid Next guessing a workspace root outside the repo (monorepo-style lockfile detection),
  // which bloats the standalone output and can break Docker builds.
  outputFileTracingRoot: repoRoot,
  async rewrites() {
    return [
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/docs/:path*',
      },
    ];
  },
};

export default withMDX(config);
