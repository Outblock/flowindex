import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../../.."),
  transpilePackages: ["@flowindex/auth-core", "@flowindex/flow-ui", "@flowindex/flow-passkey"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://localhost:8084/api/v1/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:8084/health",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
