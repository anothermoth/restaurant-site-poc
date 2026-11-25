// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  // Origin for canonical URLs, Open Graph and JSON-LD. Set SITE_URL when deploying
  // (e.g. the Cloudflare Pages URL); the placeholder is used for local builds.
  site: process.env.SITE_URL ?? "https://example.com",
  output: "static",
  integrations: [react()],
  build: {
    // Inline small CSS so the first paint doesn't wait on a stylesheet request.
    inlineStylesheets: "always",
  },
});
