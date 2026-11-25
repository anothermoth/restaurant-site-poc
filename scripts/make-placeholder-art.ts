/**
 * Generates lightweight SVG placeholder "photos" for the fictional sample menu,
 * so the demo has no stock-photo licensing questions and stays tiny over the wire.
 * Usage: npx tsx scripts/make-placeholder-art.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { allItems, parseMenu } from "@restaurant-site-poc/menu-schema";

const menu = parseMenu(JSON.parse(readFileSync("data/sample-restaurant.menu.json", "utf8")));
const out = "apps/site/public/img";
mkdirSync(out, { recursive: true });

const PALETTES: Record<string, [string, string, string]> = {
  starters: ["#f6d7a7", "#e0a458", "#8c4a1f"],
  pizza: ["#f9d9c4", "#d9562b", "#7a2414"],
  burgers: ["#f4e1b5", "#c98a3b", "#5a3414"],
  salads: ["#dff0d2", "#7fb069", "#2f5d27"],
  desserts: ["#f3e1e7", "#c97b8f", "#5d2a3a"],
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function plate(id: string, label: string, [bg, mid, dark]: [string, string, string]) {
  // deterministic "garnish" positions from the id
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dots = Array.from({ length: 7 }, (_, i) => {
    const a = ((h >> i) % 360) * (Math.PI / 180) + i;
    const r = 40 + ((h >> (i + 3)) % 45);
    return `<circle cx="${(240 + Math.cos(a) * r).toFixed(0)}" cy="${(170 + Math.sin(a) * r * 0.7).toFixed(0)}" r="${8 + (i % 3) * 3}" fill="${i % 2 ? dark : mid}" opacity=".85"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" width="480" height="360" role="img" aria-label="${esc(label)}">
<rect width="480" height="360" fill="${bg}"/>
<ellipse cx="240" cy="180" rx="170" ry="120" fill="#fff" opacity=".9"/>
<ellipse cx="240" cy="175" rx="120" ry="82" fill="${mid}" opacity=".55"/>${dots}
<text x="240" y="338" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle" fill="${dark}" opacity=".7">illustration: ${esc(label)}</text>
</svg>`;
}

for (const { item, category } of allItems(menu)) {
  if (!item.photo) continue;
  writeFileSync(`${out}/${item.id}.svg`, plate(item.id, item.name, PALETTES[category.id] ?? PALETTES.starters!));
}

writeFileSync(
  `${out}/hero.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200" height="600" role="img" aria-label="Wood-fired oven illustration">
<defs><radialGradient id="g" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#ffb347"/><stop offset=".45" stop-color="#d9562b"/><stop offset="1" stop-color="#2a0f08"/></radialGradient></defs>
<rect width="1200" height="600" fill="#2a0f08"/>
<path d="M200 600 V330 Q600 20 1000 330 V600 Z" fill="#5a2a1a"/>
<path d="M380 600 V420 Q600 230 820 420 V600 Z" fill="url(#g)"/>
<ellipse cx="600" cy="560" rx="150" ry="22" fill="#f6d7a7"/>
<ellipse cx="600" cy="552" rx="120" ry="14" fill="#d9562b"/>
</svg>`,
);
console.log("placeholder art written to", out);
