# restaurant-site-poc

[![CI](https://github.com/anothermoth/restaurant-site-poc/actions/workflows/ci.yml/badge.svg)](https://github.com/anothermoth/restaurant-site-poc/actions/workflows/ci.yml)

A fast, static restaurant website generated from menu JSON, a **menu-quality checker**, and a **voice-driven, owner-approved site editor**: say or type "86 the burrata" or "the margherita is now $16.50", check the change, approve, publish. Built as a small-scale version of the work Owner.com's restaurant-website team describes ([why](docs/design-decisions.md#why-this-exists)).

**Live demo**
- **Editor:** https://restaurant-site-poc-editor.vercel.app: your own private copy of the menu with 25 AI credits; built-in phrases are free, and nothing you do changes the real site.
- **Restaurant site:** https://restaurant-site-poc.pages.dev

![Voice editor demo](docs/demo.gif)

*Demo, 59 s ([MP4](docs/demo.mp4)), recorded against the live demo with built-in phrases only (no AI calls): a spoken price change → approve → pick the burrata from the menu and type "86 it" → a clarifying question for an ambiguous name → discard → undo → publish to the visitor's private preview → out of credits: AI paused, built-in phrases still work → the public site. The speech is simulated (fixed transcripts fed to the browser's speech-recognition API); everything after the transcript is the real stack.*

> **Sample data.** "Ember & Elm Kitchen" is fictional: the address, phone and menu are made up, and checkout is disabled. The photos are real Pexels photography ([CREDITS.md](CREDITS.md); not covered by the MIT license). The menu has problems seeded on purpose for the checker to find, including a $185 Truffle Pie and a duplicate, hidden "caesar salad".

## Stack

TypeScript end to end in an npm-workspaces monorepo: **Astro** with one **React** island (public site), **Next.js** App Router (editor), a framework-free **Node** API router that runs under **Express** locally and as a Next.js route handler on Vercel, **MongoDB** (Atlas M0 in the demo), **zod** at every boundary, Vitest and GitHub Actions. Hosted on free tiers: Cloudflare Pages and Vercel.

## Highlights

- **Fast by construction.** Pages are static HTML; the home page ships no JavaScript, and the cart is a single React island of about 8 KB of app code plus React, loaded at idle. The live site scores 100 in all four Lighthouse categories on `/` and `/menu`, mobile and desktop, with JSON-LD for the restaurant and full menu. → [Performance](docs/performance.md), [Architecture](docs/architecture.md)
- **Menu quality with a human in the loop.** Eight deterministic rules (price outliers, duplicates, empty modifier groups, missing allergen tags…), auto-fixes only where they can't mislead a guest (casing, empty groups), and an optional LLM pass whose suggestions are never auto-applied. → [Menu checker](docs/menu-checker.md)
- **An editor a busy owner can use.** One question, a live preview, and a fixed, zod-validated command vocabulary: a deterministic parser handles common phrasings for free, an LLM is only a fallback, every change is a reversible op list, and prices and allergen tags always wait for approval. → [Editor](docs/editor.md)
- **Costs measured, not guessed.** About $0.0007 per model call, a MongoDB utterance cache, per-visitor credits and sandboxes, rate limits and a $0.50/day spend cap on the public demo. → [Credits and the public demo](docs/editor.md#credits-and-the-public-demo)
- **Tested.** 153 tests, including the API against a real MongoDB; CI runs typecheck, lint, tests, the menu checker and both builds. → [Development](docs/development.md)

## Run it

Requires Node 22+. The editor also needs a local MongoDB on `localhost:27017` (any `mongod`; Docker isn't required).

```bash
npm ci
npm run dev          # the site: http://localhost:4321 (/, /menu, /admin/report)
npm run dev:admin    # the editor (serves its own API): http://localhost:3000; optional XAI_API_KEY for the AI fallback
npm test             # Vitest
npm run check-menu -- data/sample-restaurant.menu.json
```

Full setup, the Express + Astro-rebuild loop, the demo script and how the media are recorded: [docs/development.md](docs/development.md). Deploying: [docs/deploy.md](docs/deploy.md).

## More

- [Architecture: schema and site generator](docs/architecture.md)
- [Menu checker](docs/menu-checker.md)
- [Voice site editor, credits and the public demo](docs/editor.md)
- [Performance](docs/performance.md)
- [Design decisions, trade-offs and what's not built](docs/design-decisions.md)
- Design iterations with before/after screenshots: [`docs/redesign/`](docs/redesign/), [`redesign-v2/`](docs/redesign-v2/) (editor), [`redesign-v3/`](docs/redesign-v3/) (menu), [`redesign-v4/`](docs/redesign-v4/) (home)

## How this was built

I built this with AI-assisted pair programming and reviewed it myself: I directed the design and reviewed the code, tests and output, and an AI coding assistant did much of the typing. All performance numbers were measured, not estimated.

## License

MIT
