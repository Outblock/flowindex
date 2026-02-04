import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    const backend =
      (process.env.BACKEND_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

    return [
      // Proxy FlowScan backend under a dedicated prefix to avoid colliding with the portal's
      // own /api routes (e.g. /api/search used by Fumadocs).
      {
        source: '/flowscan-api/:path*',
        destination: `${backend}/:path*`,
      },
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/docs/:path*',
      },
    ];
  },
};

export default withMDX(config);
