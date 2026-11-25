# Why this exists, design decisions and trade-offs

## Why this exists

I built this to show the kind of work Owner.com's restaurant-website team does, at small scale:

- **Fast restaurant sites.** Owner's [Project Speed](https://building.owner.com/project-speed) post describes replacing their Next.js rendering stack with Astro on Cloudflare: markup by default, the ordering flow in a single React island, and cached HTML at the edge. They report menu-page LCP going from 5.4s to 0.7s at p75 and more than 4% higher per-restaurant revenue. This repo uses the same shape: static markup for everything and one hydrated island for the cart.
- **Menu quality at scale.** Owner describes automated systems that find and fix quality problems across roughly 10,000 merchant-written menus, with owners approving the changes an agent proposes. The checker here is a small version of that loop: rules detect problems, only provably safe fixes are applied automatically, and everything else (prices, duplicates, allergen tags, AI-written copy) is held for a person to approve.

## Design decisions and trade-offs

- **Astro over Next.js static export.** I had an earlier Next.js 16 prototype of an Owner-style site (a private `owner-clone` repo), but it was a mobile-first page over hardcoded data, so it didn't give much of a head start. Astro's model (markup by default, opt-in hydration per island) is exactly what this page type needs. It's also what Owner moved to, so the comparison is direct. Next.js static export would ship the React runtime and hydrate the whole page by default.
- **One island, delegated events.** I could have made every "Add" button its own island, but that would mean many hydration roots. Instead the menu stays static HTML, and one island owns all cart and modifier state, which mirrors Owner's "ordering flow in a single React island".
- **Island props are trimmed.** The cart island only gets ids, names, prices and modifier groups (no descriptions or photos), so the serialized props stay small. Zod stays out of the browser bundle: the island imports the zod-free `pricing` module. That took the island from about 94 KB to about 8 KB.
- **Integer cents and server-shaped pricing.** `priceCart()` is the same function a server checkout would call. The browser only ever sends ids and quantities.
- **What's safe to auto-fix?** Only things that can't mislead a guest or cost the restaurant money: casing and whitespace, and removing a modifier group that has no options. Prices, duplicates, dietary and allergen tags, and AI copy all need approval. This matches how Owner Agent asks owners to approve proposed menu changes.
- **Price outliers use a median ratio, not standard deviation.** Categories are small (3-10 items), and one typo like 18500 for 1850 would inflate a mean/SD threshold enough to hide itself. Categories with fewer than 3 items are skipped.
- **LLM output is untrusted input.** It's JSON mode plus zod validation, a whitelist of item ids, no auto-apply, and the prompt tells the model not to invent allergens or prices. As the committed sample shows, models still embellish, so the approval step matters.
- **The public site stays static.** The site is generated at build time from menu JSON. The editor's API owns the data (MongoDB) and hands the site a published JSON file, then rebuilds. A real version would revalidate only the affected pages at the edge instead of a full rebuild (as Owner's Apollo does) and add a server checkout.
- **Why a fixed command vocabulary instead of letting the model edit the page.** Owner Agent proposes changes that owners approve. For that to be safe, every proposal has to be something a person can read in one line and the system can validate and undo. Commands with id-locked targets give that; generated HTML or JSON patches don't. It also keeps the model's job small, which keeps calls cheap.
- **Same stack as Owner.** TypeScript, React, Next.js, Node and MongoDB (the stack Owner lists in its engineering job posts), with Astro for the public pages as in Project Speed.

## Not built (yet)

A server-side checkout endpoint; per-restaurant edge caching and revalidation with Workers; sign-in and multi-user roles for the editor (outside demo mode it has no auth, so it's for local use only); photo-quality checks (resolution, blur); per-location menus and hours exceptions; running the checker across many menus in batch; adding new items or modifier groups by voice; per-page revalidation instead of a full rebuild on publish.

The two live apps run on free tiers: the static site on Cloudflare Pages, and the editor on Vercel Hobby + Atlas M0 in demo mode (sandboxes, rate limits, $0.50/day spend cap).
