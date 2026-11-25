# Performance

**Live site (Cloudflare Pages, real photos).** Lighthouse 13.6.0 on Chrome 156 (headless) against https://restaurant-site-poc.pages.dev over the real network, from the build machine, Nov 24, 2026, 10:16 PM CST. Mobile uses Lighthouse's default simulated throttling (slow 4G, 4x CPU slowdown). Raw: [`docs/lighthouse-live.json`](lighthouse-live.json) (it also keeps the earlier runs).

| Page | Mode | Performance | Accessibility | Best Practices | SEO | LCP | FCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | mobile | 100 | 100 | 100 | 100 | 1.4 s | 0.9 s | 0 ms | 0 | 331 KiB |
| `/` | desktop | 100 | 100 | 100 | 100 | 0.4 s | 0.3 s | 0 ms | 0 | 318 KiB |
| `/menu` | mobile | 100 | 100 | 100 | 100 | 1.2 s | 1.0 s | 0 ms | 0 | 330 KiB |
| `/menu` | desktop | 100 | 100 | 100 | 100 | 0.4 s | 0.3 s | 0 ms | 0 | 271 KiB |

LCP is the hero photo on `/`. Almost all of the transfer is responsive AVIF images and two woff2 fonts. The home page ships no JavaScript; on `/menu` the cart island is about 8 KB of app code plus React's runtime, loaded at idle. It's one lab run from one location, not field data: Owner's 5.4s → 0.7s numbers are p75 field data across real traffic, so these aren't comparable to that; they only show the architecture starts fast.

**Earlier baseline (localhost, SVG placeholders).** Before the real photos, the same audit against `astro preview` on localhost (raw: [`docs/lighthouse-summary.json`](lighthouse-summary.json)) also scored 100 across the board, with mobile LCP 0.9 s for `/` and 0.7 s for `/menu` and 9 KiB / 96 KiB transferred. Reproduce locally with `npm run build && npm run lighthouse`, or against any URL with `BASE_URL=… bash scripts/lighthouse.sh` (needs Chrome).
