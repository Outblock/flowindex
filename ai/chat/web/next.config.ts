import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
