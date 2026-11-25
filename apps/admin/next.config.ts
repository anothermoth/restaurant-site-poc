import { resolve } from "node:path";
import type { NextConfig } from "next";

/**
 * Two ways to run the API:
 * - default: in-process Next.js route handlers (app/api/[...path]) — how it runs on Vercel;
 * - API_URL set: proxy /api to a separate Express server (local dev, Astro rebuild on publish).
 */
const API_URL = process.env.API_URL;

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@restaurant-site-poc/menu-schema", "@restaurant-site-poc/menu-checker", "@restaurant-site-poc/command-engine", "@restaurant-site-poc/api"],
  serverExternalPackages: ["mongodb"],
  turbopack: { root: resolve(import.meta.dirname, "../..") },
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  async rewrites() {
    // beforeFiles so the proxy wins over the in-process route handler.
    return API_URL ? { beforeFiles: [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }], afterFiles: [], fallback: [] } : [];
  },
};

export default config;
