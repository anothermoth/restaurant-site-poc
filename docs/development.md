# Running, testing and recording

## Run it locally

Requires Node 22+ (CI uses Node 24 from `.nvmrc`).

```bash
npm ci
npm run dev            # http://localhost:4321  (/, /menu, /admin/report)
npm test               # Vitest: schema, pricing, rules, auto-fix, LLM pass (mocked), JSON-LD, cart reducer, Cart island
npm run typecheck      # tsc for packages, astro check for the site
npm run lint
npm run build          # static site in apps/site/dist
npm run check-menu -- data/sample-restaurant.menu.json --json report.json --fix fixed.json

# optional LLM pass; any OpenAI-compatible endpoint works (see .env.example)
OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_MODEL=gpt-4o-mini \
  npm run check-menu -- data/sample-restaurant.menu.json --llm --json data/menu-report.llm.json
```

**The editor** needs MongoDB on `localhost:27017`. Docker isn't required; any local `mongod` works (for example the tarball from mongodb.com: `mongod --dbpath ./mongo-data`). The API test suite also uses it (each run gets its own throwaway database); set `MONGO_URL` to point elsewhere.

```bash
# Simplest: the admin serves the API itself (as on Vercel). http://localhost:3000
npm run dev:admin                        # optional: XAI_API_KEY=... for the AI fallback
npm run dev:admin:demo                   # the same, in public-demo mode (sandboxes, limits, preview-only publish)

# Full local loop with an Astro rebuild on publish:
PUBLISH_BUILD=1 npm run dev:api          # terminal 1: Express API on :4000
API_URL=http://localhost:4000 npm run dev:admin   # terminal 2: admin, proxying /api to Express
npm run preview -w @restaurant-site-poc/site      # terminal 3: the static site on :4321
```

Without an API key the editor runs on the parser alone and tells you when it didn't understand. `ADMIN_TOKEN=… npm run demo:record -- [editorUrl] [siteUrl]` re-records the demo video and editor screenshots (defaults to the live demo; built-in phrases only, so no AI calls; needs Chrome), then `bash scripts/demo-media.sh` makes `demo.mp4` and `demo.gif`. `node scripts/readme-shots.mjs` retakes the site and live-editor screenshots. All settings are listed in [`.env.example`](../.env.example).

**Two-minute demo script**

1. Open http://localhost:3000. You're editing a draft; the public site is unchanged until you publish.
2. Hold **Hold to talk** and say "Change the price of the margarita to $16.50". The price is highlighted in the preview, and the card shows $15.00 → $16.50 with "Prices and allergy info always wait for your OK". Approve.
3. Type "86 the burrata". It's hidden in the preview (dimmed, flagged). Approve.
4. Type "knock a dollar off the smash burger". The parser misses it, so the AI fallback answers in under a second; the card says "AI helper · 1 credit" and the top bar drops to 99 credits left. Approve.
5. Type "hide the caesar salad". There are two Caesar salads, so it asks which one. Pick one, then Discard it.
6. In ⋯ → Recent changes, undo the burrata change. Then press **Publish**, open the published site (or, in demo mode, your published preview) and see $16.50 on the menu.

CI (GitHub Actions) runs install → typecheck → lint → test (with a MongoDB service container for the API tests) → `check-menu` (deterministic only) → build the site → build the admin, and uploads the built site as an artifact. CI never calls an LLM (model calls are mocked in tests). CI doesn't deploy: the Cloudflare Pages deploy is a manual `npm run deploy:pages`.

**Usage stats (internal).** The editor sends cookieless page views to Vercel Web Analytics (internal pages excluded), the public site uses Cloudflare Web Analytics (turned on in the Pages project, no code), and `/admin/sessions` (needs `ADMIN_TOKEN`) lists demo sandboxes from a non-expiring `visits` summary (counts and times only; no IPs or cookies) plus the day-long event log.
