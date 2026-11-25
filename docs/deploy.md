# Deploying the demo

Three pieces, all on free tiers:

| Piece | Host | Status |
|---|---|---|
| Public restaurant site (Astro, static) | Cloudflare Pages, project `restaurant-site-poc` | **Live: https://restaurant-site-poc.pages.dev** |
| Editor + API (Next.js admin with the API in route handlers) | Vercel (Hobby), project `restaurant-site-poc-editor` | **Live: https://restaurant-site-poc-editor.vercel.app** |
| Database | MongoDB Atlas M0 (free), cluster `rsp-demo`, AWS us-east-1 | Live |

The admin serves the API itself (`apps/admin/app/api/[...path]/route.ts`). That route uses the same framework-free router as the local Express server (`apps/api/src/router.ts`), so there is no separate API deployment. Express stays the local option (`npm run dev:api`), mainly because it can re-run the Astro build when you publish.

## 1. Static site → Cloudflare Pages (done)

```bash
npx wrangler whoami                     # uses CLOUDFLARE_API_TOKEN or `npx wrangler login`
npx wrangler pages project create restaurant-site-poc --production-branch main   # once
npm run deploy:pages                    # builds with SITE_URL=https://restaurant-site-poc.pages.dev, then uploads apps/site/dist
```

`SITE_URL` sets canonical URLs, Open Graph tags and JSON-LD. `apps/site/public/_headers` gives hashed assets a one-year immutable cache and adds `noindex` to `/admin/*`.

Check it:

```bash
curl -sI https://restaurant-site-poc.pages.dev/menu/ | head -1                  # HTTP/2 200
curl -s https://restaurant-site-poc.pages.dev/menu/ | grep -o '"@type":"Menu"'   # JSON-LD present
```

## 2. Database → MongoDB Atlas M0

Install the Atlas CLI (`brew install mongodb-atlas-cli`, or the tarball from mongodb.com), then:

```bash
atlas auth login                                        # browser sign-in (the one manual step)
# A brand-new Atlas account must finish the web onboarding (org + project) first, or the CLI gets HTTP 401.
atlas clusters create rsp-demo --provider AWS --region US_EAST_1 --tier M0
atlas dbusers create readWriteAnyDatabase --username rsp-app --password '<generate a long random one>'
atlas accessLists create 0.0.0.0/0 --type cidrBlock --comment "Vercel functions have no fixed IPs"
atlas clusters connectionStrings describe rsp-demo     # → mongodb+srv://rsp-demo.xxxxx.mongodb.net
```

The connection string with the user filled in becomes `MONGO_URL`:
`mongodb+srv://rsp-app:<password>@rsp-demo.xxxxx.mongodb.net/?retryWrites=true&w=majority`.

Nothing needs creating by hand. On first request the app creates its collections and indexes, including the TTL indexes that delete idle demo sandboxes, old rate-limit windows and cached model answers, and it seeds the sample restaurant.

## 3. Editor + API → Vercel

```bash
npx vercel login
npx vercel project create restaurant-site-poc-editor
# Root Directory = apps/admin, but install from the repo root so the npm workspaces resolve
# (installing inside apps/admin alone misses TypeScript and the workspace packages).
npx vercel project update restaurant-site-poc-editor --root-directory apps/admin --framework nextjs \
  --node-version 24.x --install-command "cd ../.. && npm ci"
npx vercel link --yes --project restaurant-site-poc-editor   # run from the repo root
```

Set the environment variables (production). Values marked *secret* must only go into Vercel and never into the repo:

| Variable | Value | Notes |
|---|---|---|
| `MONGO_URL` | Atlas connection string | *secret* |
| `MONGO_DB` | `rsp_public_demo` | |
| `XAI_API_KEY` | an xAI API key | *secret*. Optional: without it the editor runs on the built-in phrases only. Use a dedicated key so it can be revoked on its own. |
| `DEMO_MODE` | `1` | sandboxes, rate limits, spend cap, preview-only publish |
| `ADMIN_TOKEN` | long random string | *secret*. Unlocks `/dev` and `/api/admin/*` |
| `LLM_DAILY_CAP_USD` | `0.50` | global stop for model calls per UTC day |
| `CREDITS_DEFAULT` | `100` (or lower, e.g. `25`, for a public demo) | credits per visitor sandbox |
| `LLM_RATE_PER_SESSION_HOUR` | `20` | |
| `LLM_RATE_PER_IP_HOUR` | `60` | |
| `SANDBOX_IDLE_MINUTES` | `60` | |
| `PUBLIC_SITE_URL` | `https://restaurant-site-poc.pages.dev` | |

```bash
for v in MONGO_URL XAI_API_KEY ADMIN_TOKEN; do npx vercel env add $v production --sensitive; done   # prompts for each value
printf '1' | npx vercel env add DEMO_MODE production
printf 'rsp_public_demo' | npx vercel env add MONGO_DB production
printf '0.50' | npx vercel env add LLM_DAILY_CAP_USD production
printf '25' | npx vercel env add CREDITS_DEFAULT production
printf 'https://restaurant-site-poc.pages.dev' | npx vercel env add PUBLIC_SITE_URL production
npx vercel deploy --prod
```

Smoke test, with `$URL` set to the deployment URL:

```bash
curl -s $URL/api/health                                  # {"ok":true,"demo":true}
curl -s -c /tmp/j -b /tmp/j $URL/api/sites/ember-and-elm | head -c 200
curl -s -c /tmp/j -b /tmp/j -H 'content-type: application/json' \
  -d '{"utterance":"86 the burrata"}' $URL/api/sites/ember-and-elm/commands | head -c 200
curl -s -H "x-admin-token: $ADMIN_TOKEN" $URL/api/admin/margin | head -c 300
```

## What demo mode changes

- **Sandbox per visitor.** An HttpOnly session cookie maps each visitor to a private copy of the menu (`ember-and-elm~<hash>`). Every request pushes the copy's `expiresAt` back by `SANDBOX_IDLE_MINUTES`, and a TTL index deletes it after that much inactivity. The real site record is never edited.
- **Publish is preview-only.** It updates the sandbox's published version, which `/published` renders. A serverless function can't run an Astro build per visitor, so `/published` renders the same menu data, after the same safe auto-fixes, with the admin's React preview components. It is a faithful preview of the content, not the Astro page itself; the README says so too.
- **Cost guards in front of every paid model call** (cache hits skip them): global daily spend cap → per-session and per-IP hourly limits → take 1 credit. If any of them blocks the call, the model isn't called, no credit is used, and built-in phrases keep working. Spend is recorded from the provider's reported token usage after each call, so concurrent calls can overshoot the cap by a few tenths of a cent at most.
- **Admin routes** (`/api/admin/*`, `/dev`) need `ADMIN_TOKEN`; without one they're closed.

## Production (non-demo) publish to the static site

Outside demo mode, publishing on a host where you can't run a build in-process works like this:

1. Connect the Cloudflare Pages project to the GitHub repo. Deploy hooks only exist for Git-connected projects, and this demo's project was created by direct upload. Set the build command to `npm run build -w @restaurant-site-poc/site`, the output to `apps/site/dist`, and the env vars `SITE_URL` and `MENU_URL=https://<admin>/api/sites/ember-and-elm/published.json`.
2. Create a deploy hook in Pages settings and set it as `PUBLISH_HOOK_URL` on Vercel.
3. Publish now calls the hook. The Pages build fetches the published menu from `MENU_URL` and rebuilds the static site.

Locally, `PUBLISH_BUILD=1 npm run dev:api` does the same thing in-process: it writes the JSON and runs the Astro build.

## Free public demo: cost exposure

Model calls are the only metered cost, and the daily cap bounds them: about $0.0003–0.0008 per call, so $0.50/day is roughly 600–1,800 AI requests. Cloudflare Pages, Vercel Hobby and Atlas M0 are free at this scale. Vercel's Hobby plan is for non-commercial use.
