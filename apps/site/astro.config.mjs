// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  // Placeholder origin used for canonical URLs and JSON-LD. Not deployed anywhere.
  site: "https://example.com",
  output: "static",
  integrations: [react()],
  build: {
    // Inline small CSS so the first paint doesn't wait on a stylesheet request.
    inlineStylesheets: "always",
  },
});
