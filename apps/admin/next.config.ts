import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@restaurant-site-poc/menu-schema"],
  // The browser talks to the Express API through this origin, so no CORS setup is needed.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default config;
