#!/usr/bin/env bash
# Measures the production build locally with Lighthouse (mobile + desktop presets).
# Needs Chrome/Chromium installed. Usage: npm run build && ./scripts/lighthouse.sh
# BASE_URL=https://restaurant-site-poc.pages.dev ./scripts/lighthouse.sh measures a deployed site instead.
set -euo pipefail
PORT=${PORT:-4321}
if [ -z "${BASE_URL:-}" ]; then
  npx astro preview --root apps/site --port "$PORT" >/dev/null 2>&1 &
  PREVIEW=$!
  trap 'kill $PREVIEW' EXIT
  sleep 3
fi
BASE=${BASE_URL:-http://localhost:$PORT}
rm -rf .lighthouse-tmp && mkdir -p .lighthouse-tmp
for page in "" menu; do
  name=${page:-home}
  npx -y lighthouse@13 "$BASE/$page" --quiet --chrome-flags="--headless=new" \
    --output=json --output-path=".lighthouse-tmp/$name-mobile.json"
  npx -y lighthouse@13 "$BASE/$page" --preset=desktop --quiet --chrome-flags="--headless=new" \
    --output=json --output-path=".lighthouse-tmp/$name-desktop.json"
done
node -e '
const fs = require("fs");
for (const f of fs.readdirSync(".lighthouse-tmp")) {
  const d = JSON.parse(fs.readFileSync(".lighthouse-tmp/" + f));
  const a = d.audits, c = d.categories;
  console.log(f.padEnd(20), "perf", Math.round(c.performance.score * 100), "a11y", Math.round(c.accessibility.score * 100),
    "bp", Math.round(c["best-practices"].score * 100), "seo", Math.round(c.seo.score * 100),
    "LCP", a["largest-contentful-paint"].displayValue, "TBT", a["total-blocking-time"].displayValue, "CLS", a["cumulative-layout-shift"].displayValue);
}'
